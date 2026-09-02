import logging
import os
from datetime import datetime, timezone

import ccxt

from .config import Config
from .json_store import load_json, update_json


class ExchangeClient:
    def __init__(self):
        self.logger = logging.getLogger("TradeBot.Exchange")
        self.is_paper = Config.TRADING_MODE == "PAPER"
        self.initial_paper_balance = float(getattr(Config, "PAPER_BALANCE", 1000))
        self.market_mode = (getattr(Config, "MARKET_MODE", "FUTURES") or "FUTURES").upper()
        self.paper_account_path = os.path.join(Config.DATA_DIR, "paper_account.json")

        exchange_config = {
            "enableRateLimit": True,
            "options": {
                "recvWindow": 60000,
            },
        }
        if not self.is_paper and Config.API_KEY and Config.SECRET_KEY:
            exchange_config["apiKey"] = Config.API_KEY
            exchange_config["secret"] = Config.SECRET_KEY

        if self.market_mode == "SPOT":
            self.exchange = ccxt.binance(exchange_config)
            self.market_type = "spot"
        else:
            self.exchange = ccxt.binanceusdm(exchange_config)
            self.market_type = "futures-usdm"

        try:
            self.exchange.load_markets()
            self.logger.info("Exchange configurado para: %s", self.market_type)
        except Exception as e:
            self.logger.warning("Falha ao carregar mercados da Binance: %s", e)

        if self.is_paper:
            self._ensure_paper_account()
            self.logger.info("Running in PAPER mode (sem envio de ordens reais)")

    def _ensure_paper_account(self):
        account = load_json(self.paper_account_path, None)
        if not isinstance(account, dict):
            with update_json(self.paper_account_path, {}) as acc:
                acc.setdefault("balance", self.initial_paper_balance)
                acc.setdefault("orders", {})

    def _paper_default(self):
        return {"balance": self.initial_paper_balance, "orders": {}}

    def _normalize_symbol(self, symbol):
        if not isinstance(symbol, str):
            return symbol
        if "/" in symbol:
            return symbol
        if symbol.endswith("USDT"):
            base = symbol[:-4]
            if self.market_type == "spot":
                return f"{base}/USDT"
            return f"{base}/USDT:USDT"
        return symbol

    def _to_float(self, value, default=0.0):
        try:
            if value is None or value == "":
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    def _ticker_price(self, ticker):
        if not ticker:
            return 0.0
        return self._to_float(ticker.get("last") or ticker.get("close") or ticker.get("bid"))

    def _precision_amount(self, symbol, amount):
        try:
            return float(self.exchange.amount_to_precision(self._normalize_symbol(symbol), amount))
        except Exception:
            return float(amount)

    def _precision_price(self, symbol, price):
        try:
            return float(self.exchange.price_to_precision(self._normalize_symbol(symbol), price))
        except Exception:
            return float(price)

    def _min_notional(self, symbol):
        normalized = self._normalize_symbol(symbol)
        min_notional = 10.0
        if normalized in getattr(self.exchange, "markets", {}):
            market = self.exchange.markets[normalized]
            filters = market.get("limits", {}).get("cost", {}) or {}
            min_notional = filters.get("min", 10.0) or 10.0
        return float(min_notional)

    def _store_paper_order(self, order):
        with update_json(self.paper_account_path, self._paper_default()) as account:
            orders = account.setdefault("orders", {})
            orders[str(order["id"])] = order

    def _get_paper_order(self, order_id):
        account = load_json(self.paper_account_path, self._paper_default())
        return (account.get("orders") or {}).get(str(order_id))

    def _mark_paper_order(self, order_id, **updates):
        with update_json(self.paper_account_path, self._paper_default()) as account:
            orders = account.setdefault("orders", {})
            current = orders.get(str(order_id), {})
            current.update(updates)
            orders[str(order_id)] = current
            return current

    def adjust_paper_balance(self, delta):
        with update_json(self.paper_account_path, self._paper_default()) as account:
            account["balance"] = float(account.get("balance", self.initial_paper_balance)) + float(delta)
            return account["balance"]

    def validate_connection(self):
        if self.is_paper:
            return True

        try:
            self.exchange.load_markets()
            balance = self.exchange.fetch_balance()
            usdt_info = balance.get("USDT", {})
            self.logger.info(
                "Conexao Binance %s validada. USDT free=%s total=%s",
                self.market_type,
                usdt_info.get("free"),
                usdt_info.get("total"),
            )
            return True
        except ccxt.AuthenticationError as e:
            self.logger.error(
                "Falha de autenticacao na Binance %s. Verifique API key, secret, permissoes e whitelist de IP: %s",
                self.market_type,
                e,
            )
            return False
        except Exception as e:
            self.logger.error("Falha ao validar conexao com Binance %s: %s", self.market_type, e)
            return False

    def set_leverage(self, symbol, leverage):
        leverage = int(leverage)
        if self.market_type == "spot":
            return True
        if self.is_paper:
            self.logger.info("PAPER set_leverage %sx em %s", leverage, symbol)
            return True
        try:
            self.exchange.set_leverage(leverage, self._normalize_symbol(symbol))
            self.logger.info("Leverage %sx aplicada em %s", leverage, symbol)
            return True
        except Exception as e:
            self.logger.error("Falha ao definir leverage %sx em %s: %s", leverage, symbol, e)
            return False

    def get_balance(self):
        if self.is_paper:
            account = load_json(self.paper_account_path, self._paper_default())
            return float(account.get("balance", self.initial_paper_balance))
        try:
            balance = self.exchange.fetch_balance()
            return float(balance["USDT"]["free"])
        except Exception as e:
            self.logger.error(f"Error fetching balance: {e}")
            return 0.0

    def get_ticker(self, symbol):
        try:
            return self.exchange.fetch_ticker(self._normalize_symbol(symbol))
        except Exception as e:
            self.logger.error(f"Error fetching ticker for {symbol}: {e}")
            return None

    def create_market_order(self, symbol, side, amount):
        if self.is_paper:
            ticker = self.get_ticker(symbol) or {}
            price = self._ticker_price(ticker)
            amount = self._precision_amount(symbol, amount)
            order_id = f"paper_{symbol}_{side}_{datetime.now(timezone.utc).timestamp()}"
            order = {
                "id": order_id,
                "symbol": symbol,
                "type": "market",
                "side": side,
                "amount": amount,
                "average": price,
                "price": price,
                "status": "FILLED",
            }
            self._store_paper_order(order)
            self.logger.info("PAPER order: market %s %s amount=%s price=%s id=%s", side, symbol, amount, price, order_id)
            return order
        try:
            normalized_symbol = self._normalize_symbol(symbol)
            amount = self.exchange.amount_to_precision(normalized_symbol, amount)
            ticker = self.get_ticker(symbol)
            current_price = self._ticker_price(ticker)
            min_notional = self._min_notional(symbol)
            order_value = float(amount) * current_price
            if order_value < min_notional and current_price > 0:
                self.logger.warning(
                    f"Order value ${order_value:.2f} is below minimum ${min_notional:.2f} for {symbol}. "
                    f"Adjusting amount to meet minimum."
                )
                amount = self.exchange.amount_to_precision(normalized_symbol, min_notional / current_price)

            order = self.exchange.create_order(normalized_symbol, "market", side, amount)
            self.logger.info(f"Market {side} order created for {symbol}: {order['id']}")
            return order
        except Exception as e:
            self.logger.error(f"Error creating market order: {e}")
            raise e

    def create_stop_loss_order(self, symbol, side, amount, stop_price):
        if self.market_type == "spot":
            raise NotImplementedError("Use create_oco_order for spot protection orders.")
        amount = self._precision_amount(symbol, amount)
        stop_price = self._precision_price(symbol, stop_price)
        if self.is_paper:
            order_id = f"paper_sl_{symbol}_{side}_{datetime.now(timezone.utc).timestamp()}"
            order = {
                "id": order_id,
                "symbol": symbol,
                "type": "STOP_MARKET",
                "side": side,
                "amount": amount,
                "stopPrice": stop_price,
                "status": "OPEN",
            }
            self._store_paper_order(order)
            self.logger.info("PAPER order: stop_loss %s %s amount=%s stop=%s id=%s", side, symbol, amount, stop_price, order_id)
            return order
        try:
            normalized_symbol = self._normalize_symbol(symbol)
            amount = self.exchange.amount_to_precision(normalized_symbol, amount)
            price = self.exchange.price_to_precision(normalized_symbol, stop_price)
            ticker = self.get_ticker(symbol)
            current_price = self._ticker_price(ticker)
            min_notional = self._min_notional(symbol)
            order_value = float(amount) * current_price
            if order_value < min_notional and current_price > 0:
                amount = self.exchange.amount_to_precision(normalized_symbol, min_notional / current_price)

            params = {"stopPrice": price}
            order = self.exchange.create_order(normalized_symbol, "STOP_MARKET", side, float(amount), params=params)
            self.logger.info(f"Stop loss order created for {symbol} at {price}: {order['id']}")
            return order
        except Exception as e:
            self.logger.error(f"Error creating stop loss order: {e}")
            return None

    def create_take_profit_order(self, symbol, side, amount, tp_price):
        if self.market_type == "spot":
            raise NotImplementedError("Use create_oco_order for spot protection orders.")
        amount = self._precision_amount(symbol, amount)
        tp_price = self._precision_price(symbol, tp_price)
        if self.is_paper:
            order_id = f"paper_tp_{symbol}_{side}_{datetime.now(timezone.utc).timestamp()}"
            order = {
                "id": order_id,
                "symbol": symbol,
                "type": "TAKE_PROFIT_MARKET",
                "side": side,
                "amount": amount,
                "stopPrice": tp_price,
                "status": "OPEN",
            }
            self._store_paper_order(order)
            self.logger.info("PAPER order: take_profit %s %s amount=%s tp=%s id=%s", side, symbol, amount, tp_price, order_id)
            return order
        try:
            normalized_symbol = self._normalize_symbol(symbol)
            amount = self.exchange.amount_to_precision(normalized_symbol, amount)
            price = self.exchange.price_to_precision(normalized_symbol, tp_price)
            ticker = self.get_ticker(symbol)
            current_price = self._ticker_price(ticker)
            min_notional = self._min_notional(symbol)
            order_value = float(amount) * current_price
            if order_value < min_notional and current_price > 0:
                amount = self.exchange.amount_to_precision(normalized_symbol, min_notional / current_price)

            params = {"stopPrice": price}
            order = self.exchange.create_order(normalized_symbol, "TAKE_PROFIT_MARKET", side, float(amount), params=params)
            self.logger.info(f"Take profit order created for {symbol} at {price}: {order['id']}")
            return order
        except Exception as e:
            self.logger.error(f"Error creating take profit order: {e}")
            return None

    def _paper_protection_filled(self, stored, last_price):
        order_type = str(stored.get("type") or "").upper()
        side = str(stored.get("side") or "").lower()
        stop = self._to_float(stored.get("stopPrice") or stored.get("price"))
        if last_price <= 0 or stop <= 0:
            return False
        if "STOP" in order_type:
            if side == "sell":
                return last_price <= stop
            return last_price >= stop
        if "TAKE_PROFIT" in order_type or stored.get("id", "").startswith("paper_tp_"):
            if side == "sell":
                return last_price >= stop
            return last_price <= stop
        return False

    def get_order(self, symbol, order_id):
        if self.is_paper:
            stored = self._get_paper_order(order_id) or {}
            if isinstance(order_id, str) and order_id.startswith("paper_"):
                if stored.get("status") == "FILLED":
                    return stored
                if stored.get("type") == "market" or (
                    not str(order_id).startswith("paper_sl_")
                    and not str(order_id).startswith("paper_tp_")
                    and "paper_oco_" not in str(order_id)
                    and "_sl_" not in str(order_id)
                    and "_tp_" not in str(order_id)
                ):
                    filled = dict(stored) if stored else {"id": order_id, "symbol": symbol, "status": "FILLED"}
                    filled["status"] = "FILLED"
                    return filled

                ticker = self.get_ticker(symbol)
                last_price = self._ticker_price(ticker)
                if stored and self._paper_protection_filled(stored, last_price):
                    fill_price = self._to_float(stored.get("stopPrice"), last_price)
                    return self._mark_paper_order(
                        order_id,
                        status="FILLED",
                        average=fill_price,
                        price=fill_price,
                        last=fill_price,
                    )
                result = dict(stored) if stored else {"id": order_id, "symbol": symbol, "status": "OPEN"}
                result.setdefault("status", "OPEN")
                return result
        try:
            return self.exchange.fetch_order(order_id, self._normalize_symbol(symbol))
        except Exception as e:
            self.logger.error(f"Error fetching order {order_id}: {e}")
            return None

    def cancel_order(self, symbol, order_id):
        if self.is_paper:
            self.logger.info("PAPER cancel order %s (%s)", order_id, symbol)
            self._mark_paper_order(order_id, status="CANCELED")
            return True
        try:
            self.exchange.cancel_order(order_id, self._normalize_symbol(symbol))
            self.logger.info(f"Order {order_id} cancelled")
            return True
        except Exception as e:
            self.logger.error(f"Error cancelling order {order_id}: {e}")
            return False

    def create_oco_order(self, symbol, side, amount, take_profit_price, stop_loss_price):
        if self.market_type != "spot":
            raise ValueError("OCO é suportado apenas em SPOT nesta implementacao.")
        amount = self._precision_amount(symbol, amount)
        take_profit_price = self._precision_price(symbol, take_profit_price)
        stop_loss_price = self._precision_price(symbol, stop_loss_price)
        if self.is_paper:
            order_id = f"paper_oco_{symbol}_{side}_{datetime.now(timezone.utc).timestamp()}"
            sl_id = f"paper_sl_{symbol}_{side}_{datetime.now(timezone.utc).timestamp()}"
            tp_id = f"paper_tp_{symbol}_{side}_{datetime.now(timezone.utc).timestamp()}"
            oco = {
                "id": order_id,
                "symbol": symbol,
                "type": "OCO",
                "side": side,
                "amount": amount,
                "status": "OPEN",
                "info": {
                    "orderReports": [
                        {"type": "STOP_LOSS_LIMIT", "orderId": sl_id, "stopPrice": stop_loss_price},
                        {"type": "LIMIT_MAKER", "orderId": tp_id, "price": take_profit_price},
                    ]
                },
            }
            self._store_paper_order(oco)
            self._store_paper_order({
                "id": sl_id, "symbol": symbol, "type": "STOP_MARKET", "side": side,
                "amount": amount, "stopPrice": stop_loss_price, "status": "OPEN",
            })
            self._store_paper_order({
                "id": tp_id, "symbol": symbol, "type": "TAKE_PROFIT_MARKET", "side": side,
                "amount": amount, "stopPrice": take_profit_price, "status": "OPEN",
            })
            self.logger.info(
                "PAPER order: oco %s %s amount=%s tp=%s sl=%s id=%s",
                side, symbol, amount, take_profit_price, stop_loss_price, order_id,
            )
            return oco

        normalized_symbol = self._normalize_symbol(symbol)
        amount = self.exchange.amount_to_precision(normalized_symbol, amount)
        tp_price = self.exchange.price_to_precision(normalized_symbol, take_profit_price)
        sl_stop = self.exchange.price_to_precision(normalized_symbol, stop_loss_price)
        sl_limit = sl_stop
        params = {
            "stopPrice": sl_stop,
            "stopLimitPrice": sl_limit,
            "stopLimitTimeInForce": "GTC",
        }
        order = self.exchange.create_order(normalized_symbol, "OCO", side, amount, tp_price, params=params)
        self.logger.info("OCO order created for %s: %s", symbol, order.get("id"))
        return order

    def get_position(self, symbol):
        if self.market_type == "spot":
            if self.is_paper:
                return {"symbol": self._normalize_symbol(symbol), "asset": symbol, "free": 0.0, "total": 0.0}
            try:
                normalized_symbol = self._normalize_symbol(symbol)
                base_asset = normalized_symbol.split("/")[0]
                balance = self.exchange.fetch_balance()
                asset_info = balance.get(base_asset, {})
                return {
                    "symbol": normalized_symbol,
                    "asset": base_asset,
                    "free": asset_info.get("free"),
                    "total": asset_info.get("total"),
                }
            except Exception as e:
                self.logger.error(f"Error fetching spot balance for {symbol}: {e}")
                return None
        try:
            positions = self.exchange.fetch_positions([self._normalize_symbol(symbol)])
            for pos in positions:
                if pos["symbol"] == self._normalize_symbol(symbol):
                    return pos
            return None
        except Exception as e:
            self.logger.error(f"Error fetching position for {symbol}: {e}")
            return None
