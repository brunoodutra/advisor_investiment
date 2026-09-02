import os
from datetime import datetime, timezone

from .config import Config
from .json_store import load_json, save_json, update_json


class StateManager:
    @property
    def default_config(self):
        return Config.get_default_bot_config()

    def __init__(self, filename="active_trades.json", history_filename="order_history.json", config_filename="bot_config.json"):
        self.filepath = os.path.join(Config.DATA_DIR, filename)
        self.history_filepath = os.path.join(Config.DATA_DIR, history_filename)
        self.config_filepath = os.path.join(Config.DATA_DIR, config_filename)
        self._ensure_files()

    def _ensure_files(self):
        if not os.path.exists(self.filepath):
            save_json(self.filepath, [])
        if not os.path.exists(self.history_filepath):
            save_json(self.history_filepath, [])
        if not os.path.exists(self.config_filepath):
            save_json(self.config_filepath, self.default_config)

    def load_config(self):
        default = self.default_config
        cfg = load_json(self.config_filepath, default)
        if not isinstance(cfg, dict):
            return default
        merged = default.copy()
        merged.update(cfg)
        if not merged.get("last_signal_keys"):
            merged["last_signal_keys"] = {}
        return merged

    def save_config(self, config):
        current = self.load_config()
        if isinstance(config, dict):
            current.update(config)
        current["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_json(self.config_filepath, current)
        return current

    def patch_config(self, updates):
        if not isinstance(updates, dict):
            return self.load_config()
        return self.save_config(updates)

    def is_bot_active(self):
        cfg = self.load_config()
        return str(cfg.get("status", "running")).lower() == "running"

    def get_risk_profile(self):
        cfg = self.load_config()
        profile = str(cfg.get("risk_profile") or Config.RISK_PROFILE or "moderate").lower()
        if profile not in ("conservative", "moderate", "aggressive"):
            return "moderate"
        return profile

    def get_last_signal_key(self, symbol):
        keys = self.load_config().get("last_signal_keys") or {}
        return keys.get(str(symbol).upper())

    def set_last_signal_key(self, symbol, signal_key):
        cfg = self.load_config()
        keys = dict(cfg.get("last_signal_keys") or {})
        keys[str(symbol).upper()] = signal_key
        self.patch_config({"last_signal_keys": keys})

    def get_crypto_limit(self, symbol):
        cfg = self.load_config()
        allocations = cfg.get("max_allocation_per_crypto", {}) or {}
        default_limit = float(cfg.get("default_crypto_limit", 100.0))

        sym = str(symbol).upper()
        if sym in allocations:
            try:
                return float(allocations[sym])
            except (ValueError, TypeError):
                pass

        if not sym.endswith("USDT") and f"{sym}USDT" in allocations:
            try:
                return float(allocations[f"{sym}USDT"])
            except (ValueError, TypeError):
                pass
        elif sym.endswith("USDT") and sym[:-4] in allocations:
            try:
                return float(allocations[sym[:-4]])
            except (ValueError, TypeError):
                pass

        return default_limit

    def load_state(self):
        return load_json(self.filepath, [])

    def save_state(self, state):
        save_json(self.filepath, state if isinstance(state, list) else [])

    def load_history(self):
        return load_json(self.history_filepath, [])

    def save_history(self, history):
        save_json(self.history_filepath, history if isinstance(history, list) else [])

    def record_event(self, event_type, symbol=None, details=None, trade=None, status=None):
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            "symbol": symbol,
            "status": status,
            "details": details or {},
        }
        if trade:
            event["trade"] = {
                "symbol": trade.get("symbol"),
                "entry_order_id": trade.get("entry_order_id"),
                "side": trade.get("side"),
                "quantity": trade.get("quantity"),
                "entry_price": trade.get("entry_price"),
                "exit_price": trade.get("exit_price"),
                "position_value_usd": trade.get("position_value_usd"),
                "pnl_usd": trade.get("pnl_usd"),
                "pnl_percent": trade.get("pnl_percent"),
                "status": trade.get("status"),
                "stop_loss_order_id": trade.get("stop_loss_order_id"),
                "take_profit_order_id": trade.get("take_profit_order_id"),
                "stop_loss_price": trade.get("stop_loss_price"),
                "take_profit_price": trade.get("take_profit_price"),
                "oco_order_id": trade.get("oco_order_id"),
                "signal_key": trade.get("signal_key"),
            }
        with update_json(self.history_filepath, []) as history:
            history.append(event)

    def get_active_trade(self, symbol):
        trades = self.load_state()
        for trade in trades:
            if trade.get("symbol") == symbol and trade.get("status") in ["OPEN", "PENDING", "PARTIALLY_FILLED"]:
                return trade
        return None

    def update_trade(self, trade_data):
        trade_id = trade_data.get("entry_order_id")
        symbol = trade_data.get("symbol")
        with update_json(self.filepath, []) as trades:
            updated = False
            for i, trade in enumerate(trades):
                if (trade_id and trade.get("entry_order_id") == trade_id) or (
                    not trade_id
                    and trade.get("symbol") == symbol
                    and trade.get("status") in ["OPEN", "PENDING", "PARTIALLY_FILLED"]
                ):
                    trades[i] = trade_data
                    updated = True
                    break
            if not updated:
                trades.append(trade_data)

    def close_trade(self, symbol, exit_price=None, exit_time=None, pnl_usd=None, pnl_percent=None):
        with update_json(self.filepath, []) as trades:
            for trade in trades:
                if trade.get("symbol") == symbol and trade.get("status") in ["OPEN", "PENDING", "PARTIALLY_FILLED"]:
                    trade["status"] = "CLOSED"
                    if exit_price is not None:
                        trade["exit_price"] = exit_price
                    if exit_time:
                        trade["exit_time"] = exit_time
                    if pnl_usd is not None:
                        trade["pnl_usd"] = pnl_usd
                    if pnl_percent is not None:
                        trade["pnl_percent"] = pnl_percent
