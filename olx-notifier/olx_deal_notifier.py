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
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen


LOG = logging.getLogger("olx_notifier")
DEFAULT_CONFIG = Path(__file__).with_name("config.json")
OLX_HOST = "www.olx.pl"
USER_AGENT = "OLXDealNotifier/1.0 (personal conservative search monitor)"
SEARCH_REQUEST_SPACING_SECONDS = 5
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
    search_url = config.get("search_url")
    if search_url is not None:
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


def load_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"sent": [], "searches": [], "telegram_update_offset": None}
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError(f"Nie można odczytać pliku stanu {path}: {error}") from error

    if isinstance(data, list):
        state = {"sent": data, "searches": [], "telegram_update_offset": None}
    elif isinstance(data, dict):
        state = {
            "sent": data.get("sent", []),
            "searches": data.get("searches", []),
            "telegram_update_offset": data.get("telegram_update_offset"),
        }
    else:
        raise RuntimeError(f"Plik stanu {path} ma niepoprawny format.")

    if not isinstance(state["sent"], list) or not all(
        isinstance(item, str) for item in state["sent"]
    ):
        raise RuntimeError(f"Lista wysłanych ogłoszeń w {path} ma niepoprawny format.")
    if not isinstance(state["searches"], list) or not all(
        isinstance(item, dict)
        and isinstance(item.get("query"), str)
        and bool(item["query"].strip())
        and isinstance(item.get("discount_percent"), int)
        and 1 <= item["discount_percent"] <= 90
        for item in state["searches"]
    ):
        raise RuntimeError(f"Lista wyszukiwań w {path} ma niepoprawny format.")
    if len(state["searches"]) > 10:
        raise RuntimeError(f"Plik stanu {path} przekracza limit 10 wyszukiwań.")
    offset = state["telegram_update_offset"]
    if offset is not None and (not isinstance(offset, int) or offset < 0):
        raise RuntimeError(f"Offset Telegrama w {path} ma niepoprawny format.")
    return state


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


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


def query_keywords(query: str) -> list[str]:
    words = re.findall(r"[^\W\d_]+|\d+", query.casefold(), flags=re.UNICODE)
    return words


def search_url_for_query(query: str) -> str:
    slug = quote(re.sub(r"\s+", "-", query.strip().casefold()), safe="-")
    return f"https://{OLX_HOST}/oferty/q-{slug}/"


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
    if not isinstance(result, dict):
        raise RuntimeError("Telegram zwrócił niepoprawną odpowiedź dla sendMessage.")
    if not result.get("ok"):
        raise RuntimeError(f"Telegram odrzucił wiadomość: {result.get('description', 'nieznany błąd')}")


def get_telegram_updates(token: str, offset: int | None) -> list[dict]:
    query = "timeout=20&allowed_updates=%5B%22message%22%5D"
    if offset is not None:
        query += f"&offset={offset}"
    request = Request(f"https://api.telegram.org/bot{token}/getUpdates?{query}")
    try:
        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read(1_000_000).decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"Nie udało się pobrać poleceń Telegrama (HTTP {error.code}).") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Nie udało się pobrać poleceń Telegrama: {error}") from error
    if not isinstance(result, dict):
        raise RuntimeError("Telegram zwrócił niepoprawną odpowiedź dla getUpdates.")
    if not result.get("ok"):
        description = result.get("description", "nieznany błąd")
        if result.get("error_code") == 409:
            description += " Wyłącz webhook bota, aby używać getUpdates."
        raise RuntimeError(f"Telegram odrzucił getUpdates: {description}")
    updates = result.get("result")
    if not isinstance(updates, list):
        raise RuntimeError("Telegram zwrócił niepoprawną listę aktualizacji.")
    return updates


def parse_search_command(text: str) -> tuple[str, int] | None:
    match = re.fullmatch(
        r"/szukaj(?:@\w+)?\s+(.+?)\s+(\d{1,2})%\s*(.*?)\s*",
        text.strip(),
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    query, discount_text, suffix = match.groups()
    if suffix.casefold() not in {
        "", "ceny rynkowej", "taniej", "taniej od ceny rynkowej",
    }:
        return None
    discount = int(discount_text)
    if not query.strip() or len(query) > 100 or not query_keywords(query) or not 1 <= discount <= 90:
        return None
    return query.strip(), discount


def process_telegram_update(
    update: dict,
    state: dict,
    state_path: Path,
    token: str,
    allowed_chat_id: str,
) -> bool:
    update_id = update.get("update_id")
    message = update.get("message")
    if not isinstance(update_id, int) or not isinstance(message, dict):
        return False
    chat = message.get("chat")
    if not isinstance(chat, dict) or str(chat.get("id")) != allowed_chat_id:
        state["telegram_update_offset"] = update_id + 1
        save_state(state_path, state)
        return False

    text = message.get("text", "")
    if not isinstance(text, str):
        state["telegram_update_offset"] = update_id + 1
        save_state(state_path, state)
        return False
    command_match = re.match(r"^/([a-z]+)(?:@\w+)?(?:\s+(.*))?$", text.strip(), re.I)
    changed = False
    reply = None
    if command_match:
        command = command_match.group(1).casefold()
        argument = (command_match.group(2) or "").strip()
        if command in {"start", "pomoc", "help"}:
            reply = (
                "Polecenia:\n"
                "/szukaj <przedmiot> <procent>% ceny rynkowej - dodaj lub zmień alert\n"
                "/moje - pokaż zapisane wyszukiwania\n"
                "/usun <numer> - usuń wyszukiwanie\n"
                "Przykład: /szukaj RTX 3060 Ti 50% ceny rynkowej",
            )
        elif command == "szukaj":
            parsed = parse_search_command(text.strip())
            if parsed is None:
                reply = (
                    "Nie rozpoznaję polecenia. Użyj: /szukaj <przedmiot> <1-90>% ceny rynkowej\n"
                    "Przykład: /szukaj RTX 3060 Ti 50% ceny rynkowej"
                )
            else:
                query, discount = parsed
                searches = state["searches"]
                existing = next(
                    (item for item in searches if item["query"].casefold() == query.casefold()),
                    None,
                )
                if existing:
                    existing["discount_percent"] = discount
                    reply = f"Zmieniono alert: {query}, oferta co najmniej {discount}% poniżej mediany."
                    changed = True
                elif len(searches) >= 10:
                    reply = "Limit to 10 aktywnych wyszukiwań. Usuń jedno poleceniem /usun <numer>."
                else:
                    searches.append({"query": query, "discount_percent": discount})
                    reply = f"Dodano alert: {query}, oferta co najmniej {discount}% poniżej mediany."
                    changed = True
        elif command == "moje":
            searches = state["searches"]
            if searches:
                reply = "Aktywne wyszukiwania:\n" + "\n".join(
                    f"{index}. {item['query']} - {item['discount_percent']}% poniżej mediany"
                    for index, item in enumerate(searches, start=1)
                )
            else:
                reply = "Brak zapisanych wyszukiwań. Dodaj je przez /szukaj."
        elif command == "usun":
            if not argument.isdigit() or not 1 <= int(argument) <= len(state["searches"]):
                reply = "Podaj numer z /moje, np. /usun 1."
            else:
                removed = state["searches"].pop(int(argument) - 1)
                reply = f"Usunięto wyszukiwanie: {removed['query']}."
                changed = True
        else:
            reply = "Nieznane polecenie. Wyślij /pomoc, aby zobaczyć listę."

    state["telegram_update_offset"] = update_id + 1
    save_state(state_path, state)
    if reply is not None:
        send_telegram(token, allowed_chat_id, reply)
    return changed


def check_once(
    config: dict,
    sent_path: Path,
    token: str,
    chat_id: str,
    search_key: str = "config",
) -> int:
    page = fetch_search_page(config["search_url"])
    listings = parse_listings(page, config["search_url"])
    if not listings:
        page_text = page.casefold()
        if any(phrase in page_text for phrase in ("brak wyników", "nie znaleźliśmy", "nie znaleziono")):
            LOG.info("Brak wyników dla wyszukiwania: %s", config["search_url"])
            return 0
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
    state = load_state(sent_path)
    sent = set(state["sent"])
    new_count = 0
    for item in candidates:
        url = str(item["url"])
        sent_key = f"{search_key}|{url}"
        if int(item["price"]) > maximum_price or sent_key in sent or url in sent:
            continue
        discount = round((1 - int(item["price"]) / benchmark) * 100)
        message = (
            f"Okazja OLX: {item['title']}\n"
            f"Cena: {item['price']} zł | mediana: {benchmark} zł | "
            f"poniżej mediany o {discount}%\n{url}"
        )
        send_telegram(token, chat_id, message)
        sent.add(sent_key)
        state["sent"] = sorted(sent)
        save_state(sent_path, state)
        new_count += 1
        LOG.info("Wysłano: %s (%s zł)", item["title"], item["price"])
    LOG.info(
        "Sprawdzono %d ofert; pasujących %d; mediana %d zł; wysłano nowych %d.",
        len(listings), len(candidates), benchmark, new_count,
    )
    return new_count


def configured_searches(config: dict, state: dict):
    if config.get("search_url"):
        yield "config", config
    for search in state["searches"]:
        query = search["query"]
        yield f"telegram:{query.casefold()}", {
            **config,
            "search_url": search_url_for_query(query),
            "include_keywords": query_keywords(query),
            "exclude_keywords": [],
            "market_price_pln": None,
            "minimum_discount_percent": search["discount_percent"],
        }


def check_configured_searches(
    config: dict,
    state: dict,
    sent_path: Path,
    token: str,
    chat_id: str,
) -> None:
    for index, (search_key, search_config) in enumerate(configured_searches(config, state)):
        if index:
            time.sleep(SEARCH_REQUEST_SPACING_SECONDS)
        check_once(search_config, sent_path, token, chat_id, search_key)


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
        if not isinstance(config.get("state_file", "olx-notifier-sent.json"), str):
            raise ValueError("state_file musi być tekstową ścieżką.")
        sent_path = Path(config.get("state_file", "olx-notifier-sent.json"))
        if not sent_path.is_absolute():
            sent_path = Path.cwd() / sent_path
        if sent_path.resolve() == args.config.resolve():
            raise ValueError("state_file nie może wskazywać na plik konfiguracji.")

        if args.once:
            state = load_state(sent_path)
            check_configured_searches(config, state, sent_path, token, chat_id)
            return 0

        next_search_at = 0.0
        while True:
            try:
                if time.monotonic() >= next_search_at:
                    state = load_state(sent_path)
                    check_configured_searches(config, state, sent_path, token, chat_id)
                    next_search_at = time.monotonic() + config.get("poll_interval_seconds", 900)

                state = load_state(sent_path)
                updates = get_telegram_updates(token, state["telegram_update_offset"])
                search_settings_changed = False
                for update in updates:
                    search_settings_changed |= process_telegram_update(
                        update, state, sent_path, token, chat_id
                    )
                    state = load_state(sent_path)
                if search_settings_changed:
                    next_search_at = time.monotonic()
            except (OlxAccessError, RuntimeError) as error:
                LOG.error("%s", error)
                return 1
    except (ValueError, OSError) as error:
        LOG.error("%s", error)
        return 2


if __name__ == "__main__":
    sys.exit(main())
