import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from olx_deal_notifier import (
    check_once,
    load_state,
    market_price,
    matches_keywords,
    parse_search_command,
    parse_listings,
    parse_price,
    process_telegram_update,
    query_keywords,
    search_url_for_query,
)


class OlxNotifierTests(unittest.TestCase):
    def test_parse_public_search_cards(self):
        page = """
        <div data-testid="l-card">
          <a href="/d/oferta/karta-rtx-3060-CID99-IDabc.html?tracking=1">
            <h6 data-testid="ad-title">Karta RTX 3060</h6>
          </a>
          <p data-testid="ad-price">1 200 zł</p>
        </div>
        """
        items = parse_listings(page, "https://www.olx.pl/oferty/q-rtx-3060/")
        self.assertEqual(items, [{
            "title": "Karta RTX 3060",
            "price": 1200,
            "url": "https://www.olx.pl/d/oferta/karta-rtx-3060-CID99-IDabc.html",
        }])

    def test_price_parsing_skips_non_zloty_prices(self):
        self.assertEqual(parse_price("1\u202f299,99 zł"), 1300)
        self.assertIsNone(parse_price("Do negocjacji"))
        self.assertIsNone(parse_price("300 EUR"))

    def test_keyword_filter_and_median_market_estimate(self):
        config = {
            "include_keywords": ["rtx 3060", "karta"],
            "exclude_keywords": ["uszkodzona"],
            "minimum_market_samples": 3,
        }
        offers = [
            {"title": f"Karta RTX 3060 {index}", "price": price}
            for index, price in enumerate([1000, 1200, 1400])
        ]
        offers.append({"title": "Uszkodzona karta RTX 3060", "price": 10})
        self.assertFalse(matches_keywords(offers[-1], config["include_keywords"], config["exclude_keywords"]))
        self.assertEqual(market_price(config, offers), 1200)

    def test_median_needs_minimum_sample_count(self):
        config = {"include_keywords": ["rtx"], "minimum_market_samples": 5}
        offers = [{"title": "RTX card", "price": 1000}] * 4
        self.assertIsNone(market_price(config, offers))
        config["market_price_pln"] = 1500
        self.assertEqual(market_price(config, offers), 1500)

    def test_sent_offers_are_not_sent_again(self):
        page = """
        <div data-testid="l-card"><a href="/d/oferta/karta-rtx-CID99-IDabc.html">
          <h6 data-testid="ad-title">Karta RTX 3060</h6></a>
          <p data-testid="ad-price">700 zł</p></div>
        """
        config = {
            "search_url": "https://www.olx.pl/oferty/q-rtx/",
            "include_keywords": ["rtx", "karta"],
            "market_price_pln": 1000,
            "minimum_discount_percent": 20,
        }
        with TemporaryDirectory() as directory:
            sent_file = Path(directory) / "sent.json"
            with patch("olx_deal_notifier.fetch_search_page", return_value=page):
                with patch("olx_deal_notifier.send_telegram") as send:
                    self.assertEqual(check_once(config, sent_file, "token", "chat"), 1)
                    self.assertEqual(check_once(config, sent_file, "token", "chat"), 0)
                    self.assertEqual(send.call_count, 1)

    def test_search_command_parsing(self):
        self.assertEqual(
            parse_search_command("/szukaj RTX3060 TI 50% ceny rynkowej"),
            ("RTX3060 TI", 50),
        )
        self.assertEqual(
            parse_search_command("/szukaj RTX 3060 Ti 25%"),
            ("RTX 3060 Ti", 25),
        )
        self.assertIsNone(parse_search_command("/szukaj RTX 3060 0% ceny rynkowej"))
        self.assertIsNone(parse_search_command("/szukaj RTX 3060 50% coś innego"))
        self.assertEqual(query_keywords("RTX3060 Ti"), ["rtx", "3060", "ti"])
        self.assertTrue(
            matches_keywords(
                {"title": "Karta RTX 3060 Ti"},
                query_keywords("RTX3060 Ti"),
                [],
            )
        )
        self.assertEqual(
            search_url_for_query("RTX 3060 Ti"),
            "https://www.olx.pl/oferty/q-rtx-3060-ti/",
        )

    def test_telegram_command_persists_search_only_for_allowed_chat(self):
        update = {
            "update_id": 37,
            "message": {
                "chat": {"id": 1234},
                "text": "/szukaj RTX3060 TI 50% ceny rynkowej",
            },
        }
        with TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state = {"sent": [], "searches": [], "telegram_update_offset": None}
            with patch("olx_deal_notifier.send_telegram") as send:
                process_telegram_update(update, state, state_path, "token", "1234")
                self.assertEqual(state["telegram_update_offset"], 38)
                self.assertEqual(state["searches"], [{"query": "RTX3060 TI", "discount_percent": 50}])
                self.assertEqual(load_state(state_path)["searches"], state["searches"])
                self.assertIn("Dodano alert", send.call_args.args[2])

                unauthorized = {
                    "update_id": 38,
                    "message": {"chat": {"id": 9999}, "text": "/szukaj laptop 30%"},
                }
                process_telegram_update(unauthorized, state, state_path, "token", "1234")
                self.assertEqual(len(state["searches"]), 1)
                self.assertEqual(send.call_count, 1)

    def test_telegram_commands_list_update_and_remove_search(self):
        def update(update_id, text):
            return {"update_id": update_id, "message": {"chat": {"id": 1234}, "text": text}}

        with TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state = {
                "sent": [],
                "searches": [{"query": "RTX 3060 Ti", "discount_percent": 20}],
                "telegram_update_offset": None,
            }
            with patch("olx_deal_notifier.send_telegram") as send:
                process_telegram_update(
                    update(1, "/szukaj rtx 3060 ti 50% ceny rynkowej"),
                    state, state_path, "token", "1234",
                )
                self.assertEqual(state["searches"][0]["discount_percent"], 50)
                process_telegram_update(update(2, "/moje"), state, state_path, "token", "1234")
                self.assertIn("1. RTX 3060 Ti - 50%", send.call_args.args[2])
                process_telegram_update(update(3, "/usun 1"), state, state_path, "token", "1234")
                self.assertEqual(state["searches"], [])

    def test_load_state_migrates_legacy_deduplication_list(self):
        with TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state_path.write_text('["https://www.olx.pl/d/oferta/id"]', encoding="utf-8")
            self.assertEqual(
                load_state(state_path),
                {
                    "sent": ["https://www.olx.pl/d/oferta/id"],
                    "searches": [],
                    "telegram_update_offset": None,
                },
            )


if __name__ == "__main__":
    unittest.main()
