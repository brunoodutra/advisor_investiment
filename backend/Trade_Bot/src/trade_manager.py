import logging
from datetime import datetime, timezone

from .command_queue import claim_pending_commands, finish_command
from .config import Config
from .position_size import compute_order_quantity


class TradeManager:
    def __init__(self, exchange, state_manager):
        self.exchange = exchange
        self.state = state_manager
        self.logger = logging.getLogger("TradeBot.TradeManager")

    def _is_paper_order_id(self, order_id):
        return isinstance(order_id, str) and order_id.startswith("paper_")

    def _has_stale_paper_state(self, trade):
        return any(
            self._is_paper_order_id(trade.get(key))
            for key in ("entry_order_id", "stop_loss_order_id", "take_profit_order_id")
        )

    def _has_real_order_ids(self, trade):
        for key in ("entry_order_id", "stop_loss_order_id", "take_profit_order_id", "oco_order_id"):
            order_id = trade.get(key)
            if order_id and not self._is_paper_order_id(order_id):
                return True
        return False

    def _to_float(self, value, default=0.0):
        try:
            if value is None or value == "":
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    def _resolve_order_fill_price(self, order, trade, fallback=None):
        candidates = [
            (order or {}).get("average"),
            (order or {}).get("price"),
            (order or {}).get("last"),
            (order or {}).get("stopPrice"),
            fallback,
            trade.get("entry_price"),
            trade.get("signal_data", {}).get("price"),
        ]
        for value in candidates:
            price = self._to_float(value, default=None)
            if price:
                return price
        return 0.0

    def _compute_pnl(self, trade, exit_price):
        entry = self._to_float(trade.get("entry_price"))
        quantity = self._to_float(trade.get("quantity"))
        position_value = self._to_float(trade.get("position_value_usd"))
        exit_price = self._to_float(exit_price)
        pnl_usd = 0.0
        if entry and quantity and exit_price:
            if trade.get("side") == "buy":
                pnl_usd = (exit_price - entry) * quantity
            else:
                pnl_usd = (entry - exit_price) * quantity
        pnl_percent = (pnl_usd / position_value * 100) if position_value > 0 else 0.0
        return pnl_usd, pnl_percent

    def _protection_levels(self, side, entry_price, signal_data=None):
        entry_price = self._to_float(entry_price)
        signal_gains = (signal_data or {}).get("signal_gains") or {}
        try:
            sl_price = self._to_float(signal_gains.get("StopLoss"))
            tp_price = self._to_float(signal_gains.get("Target"))
        except Exception:
            sl_price = 0.0
            tp_price = 0.0

        if side == "buy":
            if sl_price <= 0 or sl_price >= entry_price:
                sl_price = entry_price * 0.98
            if tp_price <= 0 or tp_price <= entry_price:
                tp_price = entry_price * 1.04
        else:
            if sl_price <= 0 or sl_price <= entry_price:
                sl_price = entry_price * 1.02
            if tp_price <= 0 or tp_price >= entry_price:
                tp_price = entry_price * 0.96
        return sl_price, tp_price

    def _settle_paper_close(self, trade, pnl_usd):
        if not getattr(self.exchange, "is_paper", False):
            return
        margin = self._to_float(trade.get("margin_used_usd"))
        if getattr(self.exchange, "market_type", "") == "spot":
            quantity = self._to_float(trade.get("quantity"))
            exit_price = self._to_float(trade.get("exit_price"))
            if trade.get("side") == "buy":
                self.exchange.adjust_paper_balance(quantity * exit_price)
            return
        self.exchange.adjust_paper_balance(margin + pnl_usd)

    def _settle_paper_open(self, trade):
        if not getattr(self.exchange, "is_paper", False):
            return
        if getattr(self.exchange, "market_type", "") == "spot":
            if trade.get("side") == "buy":
                cost = self._to_float(trade.get("quantity")) * self._to_float(trade.get("entry_price"))
                self.exchange.adjust_paper_balance(-cost)
            return
        self.exchange.adjust_paper_balance(-self._to_float(trade.get("margin_used_usd")))

    def sync_state(self, symbol):
        trade = self.state.get_active_trade(symbol)
        if not trade:
            return

        if getattr(self.exchange, "is_paper", False) and self._has_real_order_ids(trade):
            self.logger.warning(
                "Estado REAL detectado em modo PAPER para %s. Encerrando trade salvo localmente para evitar chamadas na Binance.",
                symbol,
            )
            self.state.record_event(
                "STALE_REAL_STATE_CLOSED",
                symbol=symbol,
                status="closed",
                details={"reason": "real_state_detected_in_paper_mode"},
                trade=trade,
            )
            self.state.close_trade(symbol, exit_time=datetime.now(timezone.utc).isoformat())
            return

        if not getattr(self.exchange, "is_paper", False) and self._has_stale_paper_state(trade):
            self.logger.warning(
                "Estado PAPER detectado em modo REAL para %s. Encerrando trade salvo localmente antes de sincronizar com a Binance.",
                symbol,
            )
            self.state.record_event(
                "STALE_PAPER_STATE_CLOSED",
                symbol=symbol,
                status="closed",
                details={"reason": "paper_state_detected_in_real_mode"},
                trade=trade,
            )
            self.state.close_trade(symbol, exit_time=datetime.now(timezone.utc).isoformat())
            return

        if trade["status"] == "PENDING":
            order = self.exchange.get_order(symbol, trade["entry_order_id"])
            if not order:
                return

            if order.get("status") == "FILLED":
                fill_price = self._resolve_order_fill_price(order, trade)
                fill_amount = self._to_float(order.get("amount") or order.get("filled"), trade.get("quantity"))
                self.logger.info("Entry order filled for %s", symbol)
                trade["status"] = "OPEN"
                trade["entry_price"] = fill_price
                if fill_amount:
                    trade["quantity"] = fill_amount
                trade["position_value_usd"] = self._to_float(trade["quantity"]) * fill_price
                leverage = self._to_float(trade.get("leverage") or 1, 1) or 1
                if getattr(self.exchange, "market_type", "") != "spot":
                    trade["margin_used_usd"] = trade["position_value_usd"] / leverage
                else:
                    trade["margin_used_usd"] = trade["position_value_usd"]
                self.state.update_trade(trade)
                self._settle_paper_open(trade)
                self.state.record_event(
                    "ENTRY_FILLED",
                    symbol=symbol,
                    status="filled",
                    details={"order_status": order.get("status"), "resolved_entry_price": trade["entry_price"]},
                    trade=trade,
                )
                self.place_protection_orders(trade)

            elif order.get("status") in ["CANCELED", "REJECTED", "EXPIRED"]:
                self.logger.warning("Entry order %s for %s", order.get("status"), symbol)
                trade["status"] = "CLOSED"
                self.state.update_trade(trade)
                self.state.record_event(
                    "ENTRY_NOT_FILLED",
                    symbol=symbol,
                    status=order.get("status"),
                    details={"order_status": order.get("status")},
                    trade=trade,
                )

        elif trade["status"] == "OPEN":
            ticker = self.exchange.get_ticker(symbol)
            current_price = self.exchange._ticker_price(ticker) if hasattr(self.exchange, "_ticker_price") else 0.0
            if not current_price and ticker:
                current_price = self._to_float(ticker.get("last") or ticker.get("close") or ticker.get("bid"))

            sl_order = None
            if trade.get("stop_loss_order_id"):
                sl_order = self.exchange.get_order(symbol, trade["stop_loss_order_id"])
                if sl_order and sl_order.get("status") == "FILLED":
                    fill_price = self._resolve_order_fill_price(sl_order, trade, fallback=trade.get("stop_loss_price") or current_price)
                    self.logger.info("STOP LOSS triggered for %s", symbol)
                    self.state.record_event(
                        "STOP_LOSS_TRIGGERED",
                        symbol=symbol,
                        status="filled",
                        details={"order_id": trade.get("stop_loss_order_id"), "fill_price": fill_price},
                        trade=trade,
                    )
                    self.close_trade_cleanup(trade, reason="STOP_LOSS", exit_price=fill_price)
                    return

            if self._exit_policy() == "target_then_sell":
                self._disarm_take_profit_order(trade)
                if self._manage_runner_price_exit(trade, current_price):
                    return
            elif trade.get("take_profit_order_id"):
                tp_order = self.exchange.get_order(symbol, trade["take_profit_order_id"])
                if tp_order and tp_order.get("status") == "FILLED":
                    fill_price = self._resolve_order_fill_price(tp_order, trade, fallback=trade.get("take_profit_price") or current_price)
                    self.logger.info("TAKE PROFIT triggered for %s", symbol)
                    self.state.record_event(
                        "TAKE_PROFIT_TRIGGERED",
                        symbol=symbol,
                        status="filled",
                        details={"order_id": trade.get("take_profit_order_id"), "fill_price": fill_price},
                        trade=trade,
                    )
                    self.close_trade_cleanup(trade, reason="TAKE_PROFIT", exit_price=fill_price)
                    return

    def place_protection_orders(self, trade):
        symbol = trade["symbol"]
        side = "sell" if trade["side"] == "buy" else "buy"
        quantity = trade["quantity"]
        entry_price = self._to_float(trade["entry_price"])
        sl_price, tp_price = self._protection_levels(trade["side"], entry_price, trade.get("signal_data"))
        trade["stop_loss_price"] = sl_price
        trade["take_profit_price"] = tp_price
        runner = self._exit_policy() == "target_then_sell"

        if getattr(self.exchange, "market_type", "") == "spot":
            if trade["side"] != "buy":
                return
            if runner:
                trade["take_profit_order_id"] = None
                trade["oco_order_id"] = None
                self.state.update_trade(trade)
                self.state.record_event(
                    "SPOT_RUNNER_ARMED",
                    symbol=symbol,
                    status="open",
                    details={
                        "mode": "spot",
                        "stop_loss_price": sl_price,
                        "take_profit_price": tp_price,
                        "note": "alvo não vira ordem; espera Sell acima ou pullback",
                    },
                    trade=trade,
                )
                return
            try:
                oco = self.exchange.create_oco_order(symbol, "sell", quantity, tp_price, sl_price)
                trade["oco_order_id"] = oco.get("id") if isinstance(oco, dict) else None
                sl_id = None
                tp_id = None
                if isinstance(oco, dict):
                    info = oco.get("info", {}) if isinstance(oco.get("info", {}), dict) else {}
                    reports = info.get("orderReports") or info.get("orders") or []
                    if isinstance(reports, list):
                        for r in reports:
                            if not isinstance(r, dict):
                                continue
                            r_type = (r.get("type") or "").upper()
                            r_id = r.get("orderId") or r.get("id")
                            if not r_id:
                                continue
                            if "STOP" in r_type and sl_id is None:
                                sl_id = str(r_id)
                            if ("LIMIT" in r_type or "TAKE_PROFIT" in r_type) and tp_id is None:
                                tp_id = str(r_id)
                    if sl_id:
                        trade["stop_loss_order_id"] = sl_id
                    if tp_id:
                        trade["take_profit_order_id"] = tp_id
                if not trade.get("stop_loss_order_id") or not trade.get("take_profit_order_id"):
                    raise RuntimeError("OCO criado sem IDs de SL/TP")
                self.state.update_trade(trade)
                self.state.record_event(
                    "SPOT_PROTECTION_CREATED",
                    symbol=symbol,
                    status="open",
                    details={
                        "mode": "spot",
                        "oco_order_id": trade.get("oco_order_id"),
                        "stop_loss_price": sl_price,
                        "take_profit_price": tp_price,
                    },
                    trade=trade,
                )
            except Exception as e:
                self.logger.error("Falha ao criar OCO no spot para %s: %s", symbol, e)
                self.state.record_event(
                    "SPOT_PROTECTION_FAILED",
                    symbol=symbol,
                    status="error",
                    details={"mode": "spot", "error": str(e)},
                    trade=trade,
                )
                self.close_position_market(trade, reason="PROTECTION_FAILED")
            return

        sl_order = self.exchange.create_stop_loss_order(symbol, side, quantity, sl_price)
        tp_order = None if runner else self.exchange.create_take_profit_order(symbol, side, quantity, tp_price)
        if not sl_order or (not runner and not tp_order):
            self.logger.error("Proteção futures incompleta para %s (sl=%s tp=%s). Fechando posição.", symbol, bool(sl_order), bool(tp_order))
            self.state.record_event(
                "FUTURES_PROTECTION_FAILED",
                symbol=symbol,
                status="error",
                details={"stop_ok": bool(sl_order), "take_profit_ok": bool(tp_order), "stop_loss_price": sl_price, "take_profit_price": tp_price, "runner": runner},
                trade=trade,
            )
            self.close_position_market(trade, reason="PROTECTION_FAILED")
            return

        trade["stop_loss_order_id"] = sl_order["id"]
        trade["take_profit_order_id"] = None if runner else tp_order["id"]
        self.state.update_trade(trade)
        self.state.record_event(
            "FUTURES_PROTECTION_CREATED",
            symbol=symbol,
            status="open",
            details={
                "mode": "futures",
                "stop_loss_order_id": trade.get("stop_loss_order_id"),
                "take_profit_order_id": trade.get("take_profit_order_id"),
                "stop_loss_price": sl_price,
                "take_profit_price": tp_price,
                "runner": runner,
            },
            trade=trade,
        )

    def close_trade_cleanup(self, trade, reason="MANUAL", exit_price=None):
        symbol = trade["symbol"]

        if trade.get("stop_loss_order_id"):
            self.exchange.cancel_order(symbol, trade["stop_loss_order_id"])
        if trade.get("take_profit_order_id"):
            self.exchange.cancel_order(symbol, trade["take_profit_order_id"])
        if trade.get("oco_order_id") and not trade.get("stop_loss_order_id") and not trade.get("take_profit_order_id"):
            self.exchange.cancel_order(symbol, trade["oco_order_id"])

        if exit_price is None:
            ticker = self.exchange.get_ticker(symbol)
            exit_price = 0.0
            if ticker:
                exit_price = self._to_float(ticker.get("last") or ticker.get("close") or ticker.get("bid"))

        pnl_usd, pnl_percent = self._compute_pnl(trade, exit_price)
        trade["exit_price"] = exit_price
        trade["pnl_usd"] = pnl_usd
        trade["pnl_percent"] = pnl_percent
        self._settle_paper_close(trade, pnl_usd)
        self.state.close_trade(
            symbol,
            exit_price=exit_price,
            exit_time=datetime.now(timezone.utc).isoformat(),
            pnl_usd=pnl_usd,
            pnl_percent=pnl_percent,
        )
        self.state.record_event(
            "TRADE_CLOSED",
            symbol=symbol,
            status="closed",
            details={
                "reason": reason,
                "exit_price": exit_price,
                "current_price": exit_price,
                "pnl_usd": pnl_usd,
                "pnl_percent": pnl_percent,
            },
            trade=trade,
        )
        self.logger.info("Trade for %s closed. Reason: %s. P&L: $%.2f (%.2f%%)", symbol, reason, pnl_usd, pnl_percent)

    def close_position_market(self, trade, reason="REVERSAL"):
        symbol = trade["symbol"]
        side = "sell" if trade["side"] == "buy" else "buy"

        if getattr(self.exchange, "market_type", "") == "spot" and side == "sell" and not getattr(self.exchange, "is_paper", False):
            position = self.exchange.get_position(symbol)
            if position:
                available_quantity = self._to_float(position.get("free", 0.0))
                if available_quantity > 0:
                    self.logger.info("Closing position for %s. Available balance: %s", symbol, available_quantity)
                    order = self.exchange.create_market_order(symbol, side, available_quantity)
                    fill_price = self._resolve_order_fill_price(order, trade)
                    self.close_trade_cleanup(trade, reason=reason, exit_price=fill_price)
                    return

        quantity = trade["quantity"]
        order = self.exchange.create_market_order(symbol, side, quantity)
        fill_price = self._resolve_order_fill_price(order, trade)
        self.close_trade_cleanup(trade, reason=reason, exit_price=fill_price)

    def calculate_total_pnl(self):
        total_pnl_usd = 0.0
        total_position_value_usd = 0.0
        trades = self.state.load_state()

        for trade in trades:
            if trade.get("status") not in ["OPEN", "PENDING", "PARTIALLY_FILLED"]:
                continue
            ticker = self.exchange.get_ticker(trade["symbol"])
            current_price = self._to_float((ticker or {}).get("last") or (ticker or {}).get("close") or (ticker or {}).get("bid"))
            if current_price and trade.get("entry_price"):
                pnl, _ = self._compute_pnl(trade, current_price)
                total_pnl_usd += pnl
                total_position_value_usd += self._to_float(trade.get("position_value_usd"))

        return {
            "total_pnl_usd": total_pnl_usd,
            "total_position_value_usd": total_position_value_usd,
            "pnl_percent": (total_pnl_usd / total_position_value_usd * 100) if total_position_value_usd > 0 else 0.0,
            "trade_count": len([t for t in trades if t.get("status") in ["OPEN", "PENDING", "PARTIALLY_FILLED"]]),
        }

    def close_all_positions(self, reason="EMERGENCY_CLOSE"):
        trades = self.state.load_state()
        closed_count = 0
        for trade in trades:
            if trade.get("status") in ["OPEN", "PENDING", "PARTIALLY_FILLED"]:
                symbol = trade.get("symbol")
                self.logger.warning("Closing trade for %s due to %s", symbol, reason)
                try:
                    self.close_position_market(trade, reason=reason)
                    closed_count += 1
                except Exception as e:
                    self.logger.error("Failed to close position %s: %s", symbol, e)
                    self.close_trade_cleanup(trade, reason=f"{reason}_ERROR")
        return closed_count

    def process_pending_commands(self):
        commands = claim_pending_commands()
        for cmd in commands:
            cmd_type = str(cmd.get("type") or "").upper()
            reason = cmd.get("reason") or cmd_type
            try:
                if cmd_type == "CLOSE_ALL":
                    closed = self.close_all_positions(reason=reason or "EMERGENCY_CLOSE")
                    finish_command(cmd["id"], result={"closed_count": closed})
                    self.logger.warning("Command CLOSE_ALL executado. Fechadas: %s", closed)
                elif cmd_type == "CLOSE_SYMBOL":
                    symbol = cmd.get("symbol")
                    trade = self.state.get_active_trade(symbol) if symbol else None
                    if not trade:
                        finish_command(cmd["id"], result={"closed_count": 0, "detail": "no_active_trade"})
                        continue
                    self.close_position_market(trade, reason=reason or "MANUAL_CLOSE")
                    finish_command(cmd["id"], result={"closed_count": 1, "symbol": symbol})
                elif cmd_type == "SET_TPSL":
                    finish_command(cmd["id"], result={"detail": "not_implemented"})
                else:
                    finish_command(cmd["id"], error=f"unknown_type:{cmd_type}")
            except Exception as e:
                self.logger.error("Falha ao processar comando %s: %s", cmd.get("id"), e, exc_info=True)
                finish_command(cmd["id"], error=str(e))

    def _exit_policy(self, cfg=None):
        cfg = cfg if isinstance(cfg, dict) else (
            self.state.load_config() if hasattr(self.state, "load_config") else {}
        )
        policy = str(cfg.get("exit_policy") or getattr(Config, "EXIT_POLICY", "protection") or "protection").strip().lower()
        aliases = {
            "hold_to_target": "protection",
            "tp_sl": "protection",
            "ignore": "protection",
            "runner": "target_then_sell",
            "hold_after_target": "target_then_sell",
            "trail_after_target": "target_then_sell",
        }
        policy = aliases.get(policy, policy)
        if policy not in ("protection", "confirm", "reversal", "target_then_sell"):
            return "protection"
        return policy

    def _ticker_last(self, symbol):
        ticker = self.exchange.get_ticker(symbol)
        if hasattr(self.exchange, "_ticker_price"):
            price = self.exchange._ticker_price(ticker)
            if price:
                return self._to_float(price)
        if ticker:
            return self._to_float(ticker.get("last") or ticker.get("close") or ticker.get("bid"))
        return 0.0

    def _price_beyond_target(self, trade, price):
        tp = self._to_float(trade.get("take_profit_price"))
        price = self._to_float(price)
        if tp <= 0 or price <= 0:
            return False
        side = str(trade.get("side") or "").lower()
        if side == "buy":
            return price >= tp
        if side == "sell":
            return price <= tp
        return False

    def _price_gave_back_target(self, trade, price):
        tp = self._to_float(trade.get("take_profit_price"))
        price = self._to_float(price)
        if tp <= 0 or price <= 0:
            return False
        side = str(trade.get("side") or "").lower()
        if side == "buy":
            return price < tp
        if side == "sell":
            return price > tp
        return False

    def _software_stop_hit(self, trade, price):
        sl = self._to_float(trade.get("stop_loss_price"))
        price = self._to_float(price)
        if sl <= 0 or price <= 0:
            return False
        side = str(trade.get("side") or "").lower()
        if side == "buy":
            return price <= sl
        if side == "sell":
            return price >= sl
        return False

    def _disarm_take_profit_order(self, trade):
        if trade.get("runner_tp_disarmed"):
            return
        symbol = trade.get("symbol")
        changed = False
        if trade.get("take_profit_order_id"):
            self.exchange.cancel_order(symbol, trade.get("take_profit_order_id"))
            trade["take_profit_order_id"] = None
            changed = True
        if trade.get("oco_order_id"):
            self.exchange.cancel_order(symbol, trade.get("oco_order_id"))
            trade["oco_order_id"] = None
            trade["stop_loss_order_id"] = None
            trade["take_profit_order_id"] = None
            changed = True
        trade["runner_tp_disarmed"] = True
        if hasattr(self.state, "update_trade"):
            self.state.update_trade(trade)
        if changed:
            self.state.record_event(
                "TAKE_PROFIT_DISARMED",
                symbol=symbol,
                status="held",
                details={"reason": "target_then_sell", "take_profit_price": trade.get("take_profit_price")},
                trade=trade,
            )

    def _mark_target_reached(self, trade, price):
        if trade.get("target_reached"):
            return False
        trade["target_reached"] = True
        trade["target_reached_at"] = datetime.now(timezone.utc).isoformat()
        trade["target_reached_price"] = self._to_float(price)
        if hasattr(self.state, "update_trade"):
            self.state.update_trade(trade)
        self.logger.info(
            "Alvo tocado em %s a %.6f. Segurando até Sell acima do alvo ou pullback.",
            trade.get("symbol"),
            self._to_float(price),
        )
        self.state.record_event(
            "TARGET_REACHED",
            symbol=trade.get("symbol"),
            status="held",
            details={
                "price": self._to_float(price),
                "take_profit_price": trade.get("take_profit_price"),
            },
            trade=trade,
        )
        return True

    def _manage_runner_price_exit(self, trade, current_price):
        price = self._to_float(current_price)
        if price <= 0:
            return False
        if not trade.get("target_reached") and self._software_stop_hit(trade, price) and not trade.get("stop_loss_order_id"):
            self.close_position_market(trade, reason="STOP_LOSS")
            return True
        if not trade.get("target_reached"):
            if self._price_beyond_target(trade, price):
                self._mark_target_reached(trade, price)
            return False
        if self._price_gave_back_target(trade, price):
            self.logger.info("Pullback abaixo do alvo em %s. Fechando.", trade.get("symbol"))
            self.close_position_market(trade, reason="TARGET_GIVEBACK")
            return True
        return False

    def _confirm_reversal_needed(self, cfg=None):
        cfg = cfg if isinstance(cfg, dict) else (
            self.state.load_config() if hasattr(self.state, "load_config") else {}
        )
        needed = cfg.get("confirm_reversal_signals", getattr(Config, "CONFIRM_REVERSAL_SIGNALS", 2))
        try:
            needed = int(needed)
        except (TypeError, ValueError):
            needed = 2
        return max(2, needed)

    @staticmethod
    def _is_opposite_recommendation(side, recommendation):
        side = str(side or "").lower()
        rec = str(recommendation or "")
        return (side == "buy" and rec == "Sell") or (side == "sell" and rec == "Buy")

    def _reset_opposite_streak(self, trade):
        if not trade:
            return
        if int(trade.get("opposite_signal_streak") or 0) == 0:
            return
        trade["opposite_signal_streak"] = 0
        if hasattr(self.state, "update_trade"):
            self.state.update_trade(trade)

    def _ignore_reversal(self, symbol, trade, signal_data, signal_key, extra_details=None):
        details = {
            "recommendation": signal_data.get("recommendation"),
            "market_type": getattr(self.exchange, "market_type", "unknown"),
            "signal_key": signal_key,
            "exit_policy": self._exit_policy(),
            "stop_loss_price": trade.get("stop_loss_price"),
            "take_profit_price": trade.get("take_profit_price"),
        }
        if extra_details:
            details.update(extra_details)
        self.logger.info(
            "Sinal contrário ignorado para %s (%s). Posição segue até target/stop.",
            symbol,
            signal_data.get("recommendation"),
        )
        self.state.set_last_signal_key(symbol, signal_key)
        self.state.record_event(
            "REVERSAL_IGNORED",
            symbol=symbol,
            status="held",
            details=details,
            trade=trade,
        )

    def _close_from_reversal(self, symbol, trade, signal_data, signal_key):
        recommendation = signal_data.get("recommendation")
        self.logger.info("Reversal signal for %s. Closing position.", symbol)
        self.state.set_last_signal_key(symbol, signal_key)
        self.state.record_event(
            "REVERSAL_SIGNAL",
            symbol=symbol,
            status="signal",
            details={
                "recommendation": recommendation,
                "market_type": getattr(self.exchange, "market_type", "unknown"),
                "signal_key": signal_key,
            },
            trade=trade,
        )
        if getattr(self.exchange, "market_type", "") == "spot" and not getattr(self.exchange, "is_paper", False):
            position = self.exchange.get_position(symbol)
            if position and self._to_float(position.get("total", 0.0)) > 0:
                self.close_position_market(trade, reason="REVERSAL")
            else:
                self.logger.warning("Position for %s not found or zero balance. Skipping close.", symbol)
                self.state.close_trade(symbol, exit_time=datetime.now(timezone.utc).isoformat())
                self.state.record_event(
                    "POSITION_NOT_FOUND",
                    symbol=symbol,
                    status="skipped",
                    details={"reason": "position_not_found_or_zero_balance"},
                    trade=trade,
                )
            return
        self.close_position_market(trade, reason="REVERSAL")

    def _manage_open_trade_signal(self, symbol, trade, signal_data, is_new_signal, cfg):
        if not is_new_signal:
            return
        recommendation = signal_data.get("recommendation")
        signal_key = signal_data.get("signal_key")
        if not self._is_opposite_recommendation(trade.get("side"), recommendation):
            self._reset_opposite_streak(trade)
            if signal_key:
                self.state.set_last_signal_key(symbol, signal_key)
            return

        policy = self._exit_policy(cfg)
        if policy == "protection":
            self._ignore_reversal(symbol, trade, signal_data, signal_key)
            return

        if policy == "target_then_sell":
            if not trade.get("target_reached"):
                price = self._ticker_last(symbol)
                if self._price_beyond_target(trade, price):
                    self._mark_target_reached(trade, price)
                else:
                    self._ignore_reversal(
                        symbol,
                        trade,
                        signal_data,
                        signal_key,
                        extra_details={"reason": "target_not_reached"},
                    )
                    return
            price = self._ticker_last(symbol)
            if self._price_gave_back_target(trade, price):
                self.state.set_last_signal_key(symbol, signal_key)
                self.close_position_market(trade, reason="TARGET_GIVEBACK")
                return
            if self._price_beyond_target(trade, price) or price <= 0:
                self.logger.info("Sell acima do alvo em %s. Fechando.", symbol)
                self.state.set_last_signal_key(symbol, signal_key)
                self.state.record_event(
                    "RUNNER_SELL",
                    symbol=symbol,
                    status="signal",
                    details={
                        "recommendation": recommendation,
                        "price": price,
                        "take_profit_price": trade.get("take_profit_price"),
                        "signal_key": signal_key,
                    },
                    trade=trade,
                )
                self.close_position_market(trade, reason="RUNNER_SELL")
            return

        if policy == "confirm":
            streak = int(trade.get("opposite_signal_streak") or 0) + 1
            trade["opposite_signal_streak"] = streak
            if hasattr(self.state, "update_trade"):
                self.state.update_trade(trade)
            needed = self._confirm_reversal_needed(cfg)
            if streak < needed:
                self._ignore_reversal(
                    symbol,
                    trade,
                    signal_data,
                    signal_key,
                    extra_details={"opposite_signal_streak": streak, "confirm_reversal_signals": needed},
                )
                return

        self._close_from_reversal(symbol, trade, signal_data, signal_key)

    def process_signal(self, symbol, signal_data):
        if not signal_data:
            return

        active_trade = self.state.get_active_trade(symbol)
        recommendation = signal_data.get("recommendation")
        confidence = self._to_float(signal_data.get("percentage"))
        signal_key = signal_data.get("signal_key")

        cfg = self.state.load_config() if hasattr(self.state, "load_config") else {}
        is_active = self.state.is_bot_active() if hasattr(self.state, "is_bot_active") else True
        confidence_threshold = self._to_float(cfg.get("confidence_threshold", Config.CONFIDENCE_THRESHOLD))

        if confidence < confidence_threshold:
            return

        last_key = self.state.get_last_signal_key(symbol)
        is_new_signal = bool(signal_key) and signal_key != last_key

        if active_trade:
            self._manage_open_trade_signal(symbol, active_trade, signal_data, is_new_signal, cfg)
            return

        if getattr(self.exchange, "market_type", "") == "spot":
            if recommendation != "Buy":
                return
            if not is_new_signal:
                return
            if not is_active:
                self.logger.debug("Bot pausado. Sinal de compra para %s ignorado.", symbol)
                return
            self.state.set_last_signal_key(symbol, signal_key)
            self.open_position(symbol, "buy", signal_data)
            return

        if recommendation not in ("Buy", "Sell"):
            return
        if not is_new_signal:
            return
        if not is_active:
            self.logger.debug("Bot pausado. Sinal para %s ignorado.", symbol)
            return
        self.state.set_last_signal_key(symbol, signal_key)
        self.open_position(symbol, "buy" if recommendation == "Buy" else "sell", signal_data)

    def open_position(self, symbol, side, signal_data):
        if getattr(self.exchange, "market_type", "") == "spot" and side == "sell":
            return

        if hasattr(self.state, "is_bot_active") and not self.state.is_bot_active():
            self.logger.info("Bot pausado. Operação para %s cancelada.", symbol)
            return

        balance = self.exchange.get_balance()
        price = self._to_float(signal_data.get("price"))
        if price <= 0:
            self.state.record_event("TRADE_SKIPPED", symbol=symbol, status="skipped", details={"reason": "invalid_price"})
            return

        crypto_limit = self.state.get_crypto_limit(symbol) if hasattr(self.state, "get_crypto_limit") else 100.0
        if crypto_limit <= 0:
            self.logger.warning("Alocação configurada para %s é zero. Operação ignorada.", symbol)
            self.state.record_event(
                "TRADE_SKIPPED",
                symbol=symbol,
                status="skipped",
                details={"reason": "crypto_limit_zero_or_disabled", "crypto_limit": crypto_limit, "side": side},
            )
            return

        if balance < 10:
            self.logger.warning("Insufficient balance to trade")
            self.state.record_event(
                "TRADE_SKIPPED",
                symbol=symbol,
                status="skipped",
                details={"reason": "insufficient_balance", "balance": balance, "side": side},
            )
            return

        cfg = self.state.load_config() if hasattr(self.state, "load_config") else {}
        risk_per_trade = self._to_float(cfg.get("risk_per_trade", Config.RISK_PER_TRADE))
        leverage = self._to_float(cfg.get("leverage", Config.LEVERAGE), 1) or 1
        if getattr(self.exchange, "market_type", "") == "spot":
            leverage = 1

        sl_price, _tp_price = self._protection_levels(side, price, signal_data)
        if getattr(self.exchange, "market_type", "") == "spot":
            max_notional = min(crypto_limit, balance)
        else:
            max_notional = min(crypto_limit * leverage, balance * leverage)

        effective_capital = min(balance, crypto_limit)
        quantity, notional, sl_distance, risk_usd = compute_order_quantity(
            price, sl_price, effective_capital, risk_per_trade, max_notional
        )
        if sl_distance <= 0 or quantity <= 0:
            self.state.record_event("TRADE_SKIPPED", symbol=symbol, status="skipped", details={"reason": "invalid_stop_distance"})
            return

        min_notional = 10.0
        if hasattr(self.exchange, "_min_notional"):
            min_notional = self.exchange._min_notional(symbol)
        if hasattr(self.exchange, "_precision_amount"):
            quantity = self.exchange._precision_amount(symbol, quantity)
            notional = quantity * price
        if notional < min_notional:
            self.logger.warning("Notional $%.2f abaixo do mínimo $%.2f para %s.", notional, min_notional, symbol)
            self.state.record_event(
                "TRADE_SKIPPED",
                symbol=symbol,
                status="skipped",
                details={"reason": "notional_too_low", "notional": notional, "min_notional": min_notional},
            )
            return

        if getattr(self.exchange, "market_type", "") != "spot":
            if not self.exchange.set_leverage(symbol, int(leverage)):
                self.state.record_event(
                    "TRADE_SKIPPED",
                    symbol=symbol,
                    status="skipped",
                    details={"reason": "set_leverage_failed", "leverage": leverage},
                )
                return

        self.logger.info(
            "Opening %s position for %s. Balance: $%.2f, Limit: $%.2f, Risk: $%.2f (%.1f%% at SL), "
            "SL dist: $%.6f, Notional: $%.2f, Qty: %s, Leverage: %sx, SL: %s",
            side, symbol, balance, crypto_limit, risk_usd, risk_per_trade * 100,
            sl_distance, notional, quantity, leverage, sl_price,
        )
        self.state.record_event(
            "ENTRY_SUBMITTED",
            symbol=symbol,
            status="submitted",
            details={
                "side": side,
                "quantity": quantity,
                "price": price,
                "stop_loss_price": sl_price,
                "sl_distance": sl_distance,
                "risk_usd": risk_usd,
                "notional": notional,
                "signal_key": signal_data.get("signal_key"),
            },
        )

        try:
            order = self.exchange.create_market_order(symbol, side, quantity)
        except Exception as e:
            self.state.record_event(
                "ENTRY_FAILED",
                symbol=symbol,
                status="error",
                details={"side": side, "quantity": quantity, "price": price, "error": str(e)},
            )
            raise

        if order:
            filled_qty = self._to_float(order.get("amount"), quantity)
            entry_price = self._resolve_order_fill_price(order, {"entry_price": price, "signal_data": signal_data}, fallback=price)
            position_value_usd = filled_qty * entry_price
            trade = {
                "symbol": symbol,
                "entry_order_id": order["id"],
                "side": side,
                "quantity": filled_qty,
                "entry_price": entry_price,
                "position_value_usd": position_value_usd,
                "margin_used_usd": position_value_usd / leverage if leverage else position_value_usd,
                "leverage": leverage,
                "status": "PENDING",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "signal_key": signal_data.get("signal_key"),
                "stop_loss_price": sl_price,
                "take_profit_price": _tp_price,
                "signal_data": signal_data,
            }
            self.state.update_trade(trade)
            self.state.record_event(
                "ENTRY_ACCEPTED",
                symbol=symbol,
                status=order.get("status"),
                details={
                    "order_id": order.get("id"),
                    "side": side,
                    "quantity": filled_qty,
                    "price": entry_price,
                    "position_value_usd": position_value_usd,
                },
                trade=trade,
            )
            self.sync_state(symbol)
