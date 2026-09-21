import unittest
from pathlib import Path
import sys
from unittest.mock import MagicMock

TRADE_BOT = Path(__file__).resolve().parents[1]
if str(TRADE_BOT) not in sys.path:
    sys.path.insert(0, str(TRADE_BOT))

from src.trade_manager import TradeManager  # noqa: E402


class FakeState:
    def __init__(self, trade=None, cfg=None, last_key=None):
        self.trade = trade
        self.cfg = {
            "status": "running",
            "confidence_threshold": 0.5,
            "exit_policy": "protection",
            "confirm_reversal_signals": 2,
            **(cfg or {}),
        }
        self.last_key = last_key
        self.events = []
        self.closed = []

    def load_config(self):
        return dict(self.cfg)

    def is_bot_active(self):
        return str(self.cfg.get("status", "running")).lower() == "running"

    def get_active_trade(self, symbol):
        if self.trade and self.trade.get("symbol") == symbol:
            if self.trade.get("status") in ("OPEN", "PENDING", "PARTIALLY_FILLED"):
                return self.trade
        return None

    def get_last_signal_key(self, symbol):
        return self.last_key

    def set_last_signal_key(self, symbol, signal_key):
        self.last_key = signal_key

    def update_trade(self, trade):
        self.trade = trade

    def record_event(self, event_type, symbol=None, details=None, trade=None, status=None):
        self.events.append({"event_type": event_type, "symbol": symbol, "details": details or {}, "status": status})

    def close_trade(self, symbol, **kwargs):
        if self.trade:
            self.trade["status"] = "CLOSED"
        self.closed.append(symbol)


def _signal(rec="Sell", key="2026-09-18|20:00:00|Sell", pct=0.8):
    return {
        "recommendation": rec,
        "signal_key": key,
        "percentage": pct,
        "price": 100.0,
    }


def _long_trade():
    return {
        "symbol": "ETHUSDT",
        "side": "buy",
        "status": "OPEN",
        "quantity": 1,
        "entry_price": 100,
        "stop_loss_price": 95,
        "take_profit_price": 110,
    }


class ExitPolicyTests(unittest.TestCase):
    def _manager(self, policy="protection", market="futures", trade=None, last_key="buy-1"):
        exchange = MagicMock()
        exchange.market_type = market
        exchange.is_paper = True
        state = FakeState(trade=trade if trade is not None else _long_trade(), cfg={"exit_policy": policy}, last_key=last_key)
        manager = TradeManager(exchange, state)
        manager.close_position_market = MagicMock()
        manager.open_position = MagicMock()
        return manager, state

    def test_protection_ignores_first_sell(self):
        manager, state = self._manager("protection")
        manager.process_signal("ETHUSDT", _signal())
        manager.close_position_market.assert_not_called()
        manager.open_position.assert_not_called()
        self.assertEqual(state.trade["status"], "OPEN")
        self.assertEqual(state.events[-1]["event_type"], "REVERSAL_IGNORED")

    def test_reversal_closes_on_first_sell(self):
        manager, state = self._manager("reversal")
        manager.process_signal("ETHUSDT", _signal())
        manager.close_position_market.assert_called_once()
        self.assertEqual(state.events[-1]["event_type"], "REVERSAL_SIGNAL")

    def test_confirm_holds_first_sell_and_closes_second(self):
        manager, state = self._manager("confirm")
        manager.process_signal("ETHUSDT", _signal(key="c1|Sell"))
        manager.close_position_market.assert_not_called()
        self.assertEqual(state.trade["opposite_signal_streak"], 1)

        manager.process_signal("ETHUSDT", _signal(key="c2|Sell"))
        manager.close_position_market.assert_called_once()
        self.assertEqual(state.events[-1]["event_type"], "REVERSAL_SIGNAL")

    def test_same_sell_candle_does_not_count_twice(self):
        manager, state = self._manager("confirm")
        signal = _signal(key="same|Sell")
        manager.process_signal("ETHUSDT", signal)
        manager.process_signal("ETHUSDT", signal)
        manager.close_position_market.assert_not_called()
        self.assertEqual(state.trade["opposite_signal_streak"], 1)

    def test_spot_protection_does_not_close_on_sell(self):
        manager, state = self._manager("protection", market="spot")
        manager.process_signal("ETHUSDT", _signal())
        manager.close_position_market.assert_not_called()
        self.assertEqual(state.events[-1]["event_type"], "REVERSAL_IGNORED")

    def test_runner_ignores_sell_before_target(self):
        manager, state = self._manager("target_then_sell")
        manager._ticker_last = MagicMock(return_value=105)
        manager.process_signal("ETHUSDT", _signal())
        manager.close_position_market.assert_not_called()
        self.assertFalse(state.trade.get("target_reached"))
        self.assertEqual(state.events[-1]["event_type"], "REVERSAL_IGNORED")

    def test_runner_sells_on_signal_above_target(self):
        manager, state = self._manager("target_then_sell")
        state.trade["target_reached"] = True
        manager._ticker_last = MagicMock(return_value=112)
        manager.process_signal("ETHUSDT", _signal())
        manager.close_position_market.assert_called_once()
        self.assertEqual(manager.close_position_market.call_args[1]["reason"], "RUNNER_SELL")

    def test_runner_giveback_below_target(self):
        manager, state = self._manager("target_then_sell")
        state.trade["target_reached"] = True
        closed = manager._manage_runner_price_exit(state.trade, 109)
        self.assertTrue(closed)
        manager.close_position_market.assert_called_once()
        self.assertEqual(manager.close_position_market.call_args[1]["reason"], "TARGET_GIVEBACK")

    def test_runner_holds_while_running_up(self):
        manager, state = self._manager("target_then_sell")
        closed = manager._manage_runner_price_exit(state.trade, 112)
        self.assertFalse(closed)
        self.assertTrue(state.trade.get("target_reached"))
        manager.close_position_market.assert_not_called()
        closed = manager._manage_runner_price_exit(state.trade, 118)
        self.assertFalse(closed)
        manager.close_position_market.assert_not_called()


if __name__ == "__main__":
    unittest.main()
