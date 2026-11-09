#!/usr/bin/env python3
"""Conservative OLX public-search monitor with Telegram notifications."""

from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import logging
import os
from pathlib import Path
import re
import statistics
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen


LOG = logging.getLogger("olx_notifier")
DEFAULT_CONFIG = Path(__file__).with_name("config.json")
OLX_HOST = "www.olx.pl"
USER_AGENT = "OLXDealNotifier/1.0 (personal conservative search monitor)"
PRICE_PATTERN = re.compile(r"(\d[\d\s\u00a0\u202f]*(?:[,.]\d{1,2})?)\s*(?:zł|pln)\b", re.I)
CHALLENGE_MARKERS = (
    "captcha",
    "verify you are human",
    "access denied",
    "unusual traffic",
    "zbyt wiele żądań",
)


class OlxAccessError(RuntimeError):
    """Raised when OLX blocks access or its public page cannot be parsed."""


class Node:
    def __init__(self, tag: str, attrs: dict[str, str | None] | None = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list[Node | str] = []

    def text(self) -> str:
        return " ".join(
            part.text() if isinstance(part, Node) else part
            for part in self.children
        )


class ListingParser(HTMLParser):
    VOID_TAGS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in self.VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.stack[-1].children.append(Node(tag, dict(attrs)))

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.stack[-1].children.append(data)


def descendants(node: Node):
    for child in node.children:
        if isinstance(child, Node):
            yield child
            yield from descendants(child)


def parse_price(text: str) -> int | None:
    match = PRICE_PATTERN.search(text.replace("\u00a0", " "))
    if not match:
        return None
    amount = match.group(1).replace(" ", "").replace("\u202f", "").replace(",", ".")
    try:
        return round(float(amount))
    except ValueError:
        return None


def canonical_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def parse_listings(document: str, base_url: str) -> list[dict[str, str | int]]:
    parser = ListingParser()
    parser.feed(document)
    cards = [
        node for node in descendants(parser.root)
        if node.attrs.get("data-testid") == "l-card"
    ]
    listings = []
    for card in cards:
        nodes = list(descendants(card))
        title_node = next(
            (node for node in nodes if node.attrs.get("data-testid") == "ad-title"),
            None,
        )
        if title_node is None:
            title_node = next(
                (node for node in nodes if node.tag in {"h4", "h5", "h6"}),
                None,
            )
        price_node = next(
            (node for node in nodes if node.attrs.get("data-testid") == "ad-price"),
            None,
        )
        link_node = next(
            (
                node for node in nodes
                if node.tag == "a"
                and (node.attrs.get("href") or "").startswith(("/d/oferta/", "https://www.olx.pl/d/oferta/"))
            ),
            None,
        )
        if not title_node or not price_node or not link_node:
            continue
        title = " ".join(html.unescape(title_node.text()).split())
        price = parse_price(price_node.text())
        href = link_node.attrs.get("href")
        if not title or price is None or not href:
            continue
        listing_url = canonical_url(urljoin(base_url, href))
        if urlsplit(listing_url).hostname != OLX_HOST:
            continue
        listings.append({"title": title, "price": price, "url": listing_url})
    return listings


def load_config(path: Path) -> dict:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"Brak pliku konfiguracji: {path}. Skopiuj config.example.json.") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Niepoprawny JSON w {path}: {error}") from error

    if not isinstance(config, dict):
        raise ValueError("Główna wartość konfiguracji musi być obiektem JSON.")
    search_url = config.get("search_url", "")
    if not isinstance(search_url, str):
        raise ValueError("search_url musi być tekstowym adresem OLX.")
    parsed_url = urlsplit(search_url)
    if parsed_url.scheme != "https" or parsed_url.hostname != OLX_HOST:
        raise ValueError(f"search_url musi być adresem HTTPS z domeny {OLX_HOST}.")
    if not config.get("include_keywords"):
        raise ValueError("Dodaj co najmniej jedno hasło do include_keywords.")
    if not isinstance(config.get("include_keywords"), list) or not all(
        isinstance(word, str) and word.strip() for word in config["include_keywords"]
    ):
        raise ValueError("include_keywords musi być listą niepustych tekstów.")
    exclude_keywords = config.get("exclude_keywords", [])
    if not isinstance(exclude_keywords, list) or not all(
        isinstance(word, str) and word.strip() for word in exclude_keywords
    ):
        raise ValueError("exclude_keywords musi być listą niepustych tekstów.")
    interval = config.get("poll_interval_seconds", 900)
    if not isinstance(interval, int) or interval < 600:
        raise ValueError("poll_interval_seconds musi wynosić co najmniej 600 sekund.")
    discount = config.get("minimum_discount_percent", 20)
    if not isinstance(discount, (int, float)) or not 1 <= discount <= 90:
        raise ValueError("minimum_discount_percent musi być z zakresu 1–90.")
    market_price = config.get("market_price_pln")
    if market_price is not None and (not isinstance(market_price, (int, float)) or market_price <= 0):
        raise ValueError("market_price_pln musi być dodatnią liczbą albo null.")
    sample_size = config.get("minimum_market_samples", 5)
    if not isinstance(sample_size, int) or sample_size < 3:
        raise ValueError("minimum_market_samples musi wynosić co najmniej 3.")
    return config


def fetch_search_page(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    try:
        with urlopen(request, timeout=20) as response:
            document = response.read(3_000_000).decode("utf-8", errors="replace")
    except HTTPError as error:
        if error.code in {403, 429, 503}:
            raise OlxAccessError(
                f"OLX odpowiedział HTTP {error.code}; zatrzymuję skrypt bez ponowień."
            ) from error
        raise OlxAccessError(f"OLX odpowiedział HTTP {error.code}.") from error
    except (TimeoutError, URLError) as error:
        raise OlxAccessError(f"Nie udało się pobrać wyników OLX: {error}") from error

    lowered = document.casefold()
    if any(marker in lowered for marker in CHALLENGE_MARKERS):
        raise OlxAccessError(
            "Strona OLX zawiera komunikat ochronny lub CAPTCHA; zatrzymuję skrypt."
        )
    return document


def matches_keywords(listing: dict, include: list[str], exclude: list[str]) -> bool:
    title = str(listing["title"]).casefold()
    return all(word.casefold() in title for word in include) and not any(
        word.casefold() in title for word in exclude
    )


def market_price(config: dict, listings: list[dict]) -> int | None:
    pinned_price = config.get("market_price_pln")
    if pinned_price is not None:
        return int(pinned_price)
    relevant = [
        int(item["price"])
        for item in listings
        if matches_keywords(item, config["include_keywords"], config.get("exclude_keywords", []))
    ]
    if len(relevant) < config.get("minimum_market_samples", 5):
        return None
    return round(statistics.median(relevant))


def load_sent(path: Path) -> set[str]:
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return set()
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError(f"Nie można odczytać rejestru wysłanych ofert {path}: {error}") from error
    if not isinstance(content, list) or not all(isinstance(item, str) for item in content):
        raise RuntimeError(f"Rejestr wysłanych ofert {path} ma niepoprawny format.")
    return set(content)


def save_sent(path: Path, sent: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(sorted(sent), ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def send_telegram(token: str, chat_id: str, message: str) -> None:
    import urllib.parse

    payload = urllib.parse.urlencode({"chat_id": chat_id, "text": message}).encode("utf-8")
    request = Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read(100_000).decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Nie udało się wysłać wiadomości do Telegrama: {error}") from error
    if not result.get("ok"):
        raise RuntimeError(f"Telegram odrzucił wiadomość: {result.get('description', 'nieznany błąd')}")


def check_once(config: dict, sent_path: Path, token: str, chat_id: str) -> int:
    page = fetch_search_page(config["search_url"])
    listings = parse_listings(page, config["search_url"])
    if not listings:
        raise OlxAccessError(
            "Nie rozpoznano ogłoszeń na stronie wyników OLX; układ strony mógł się zmienić."
        )

    candidates = [
        item for item in listings
        if matches_keywords(item, config["include_keywords"], config.get("exclude_keywords", []))
    ]
    benchmark = market_price(config, listings)
    if benchmark is None:
        LOG.warning(
            "Za mało pasujących ofert do wiarygodnej mediany (%d wymaganych); "
            "ustaw market_price_pln albo dopasuj wyszukiwanie.",
            config.get("minimum_market_samples", 5),
        )
        return 0

    maximum_price = benchmark * (1 - config.get("minimum_discount_percent", 20) / 100)
    sent = load_sent(sent_path)
    new_count = 0
    for item in candidates:
        url = str(item["url"])
        if int(item["price"]) > maximum_price or url in sent:
            continue
        discount = round((1 - int(item["price"]) / benchmark) * 100)
        message = (
            f"Okazja OLX: {item['title']}\n"
            f"Cena: {item['price']} zł | mediana: {benchmark} zł | "
            f"poniżej mediany o {discount}%\n{url}"
        )
        send_telegram(token, chat_id, message)
        sent.add(url)
        save_sent(sent_path, sent)
        new_count += 1
        LOG.info("Wysłano: %s (%s zł)", item["title"], item["price"])
    LOG.info(
        "Sprawdzono %d ofert; pasujących %d; mediana %d zł; wysłano nowych %d.",
        len(listings), len(candidates), benchmark, new_count,
    )
    return new_count


def main() -> int:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    argument_parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    argument_parser.add_argument("--once", action="store_true", help="sprawdź raz i zakończ")
    args = argument_parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        config = load_config(args.config)
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        if not token or not chat_id:
            raise ValueError("Ustaw zmienne TELEGRAM_BOT_TOKEN i TELEGRAM_CHAT_ID.")
        sent_path = Path(config.get("state_file", "olx-notifier-sent.json"))
        if not sent_path.is_absolute():
            sent_path = Path.cwd() / sent_path
        if sent_path.resolve() == args.config.resolve():
            raise ValueError("state_file nie może wskazywać na plik konfiguracji.")

        while True:
            try:
                check_once(config, sent_path, token, chat_id)
            except (OlxAccessError, RuntimeError) as error:
                LOG.error("%s", error)
                return 1
            if args.once:
                return 0
            time.sleep(config.get("poll_interval_seconds", 900))
    except (ValueError, OSError) as error:
        LOG.error("%s", error)
        return 2


if __name__ == "__main__":
    sys.exit(main())
