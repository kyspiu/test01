import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from olx_deal_notifier import (
    check_once,
    market_price,
    matches_keywords,
    parse_listings,
    parse_price,
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


if __name__ == "__main__":
    unittest.main()
