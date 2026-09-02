"""Guards the stop-distance sizing conversion used by TradeManager."""

import unittest
from pathlib import Path
import sys

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from position_size import compute_order_quantity  # noqa: E402


class PositionSizeTests(unittest.TestCase):
    def test_ada_sizes_from_stop_distance_not_price(self):
        qty, notional, sl_distance, risk_usd = compute_order_quantity(
            price=0.1925,
            sl_price=0.1887,
            effective_capital=251.0,
            risk_per_trade=0.04,
            max_notional=251.0,
        )
        self.assertAlmostEqual(risk_usd, 10.04)
        self.assertAlmostEqual(sl_distance, 0.0038)
        # Old bug: qty = risk_usd / price = 52.16, notional = $10.04
        self.assertGreater(qty, 1000)
        self.assertAlmostEqual(notional, 251.0)
        self.assertAlmostEqual(qty, 251.0 / 0.1925)

    def test_xrp_sizes_from_stop_distance_not_price(self):
        qty, notional, sl_distance, risk_usd = compute_order_quantity(
            price=1.3563,
            sl_price=1.3292,
            effective_capital=241.0,
            risk_per_trade=0.04,
            max_notional=241.0,
        )
        self.assertAlmostEqual(risk_usd, 9.64)
        self.assertAlmostEqual(sl_distance, 0.0271)
        self.assertGreater(qty, 100)
        self.assertAlmostEqual(notional, 241.0)
        self.assertAlmostEqual(qty, 241.0 / 1.3563)

    def test_old_price_divisor_is_rejected(self):
        qty, notional, _, risk_usd = compute_order_quantity(
            price=0.1925,
            sl_price=0.1887,
            effective_capital=251.0,
            risk_per_trade=0.04,
            max_notional=251.0,
        )
        buggy_qty = risk_usd / 0.1925
        self.assertNotAlmostEqual(qty, buggy_qty)
        self.assertNotAlmostEqual(notional, risk_usd)


if __name__ == "__main__":
    unittest.main()
