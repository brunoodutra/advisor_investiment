import logging
import time
from urllib.parse import urlencode

import requests

from .config import Config


class SignalReader:
    def __init__(self):
        self.logger = logging.getLogger("TradeBot.SignalReader")
        self._max_retries = 1
        self._retry_backoff_seconds = 2.0

    def _normalize_crypto(self, symbol):
        if symbol.endswith("USDT"):
            return symbol[:-4]
        return symbol

    def _build_url(self, endpoint, params):
        query = urlencode(params)
        return f"{Config.API_BASE_URL.rstrip('/')}/{endpoint}?{query}"

    def _request_json(self, endpoint, params, symbol=None):
        url = self._build_url(endpoint, params)
        last_exc = None
        for attempt in range(self._max_retries + 1):
            try:
                response = requests.get(url, timeout=Config.API_TIMEOUT_SECONDS)
                response.raise_for_status()
                payload = response.json()
                if isinstance(payload, dict) and payload.get("error"):
                    if symbol:
                        self.logger.warning("API retornou erro para %s (%s): %s", endpoint, symbol, payload["error"])
                    else:
                        self.logger.warning("API retornou erro para %s: %s", endpoint, payload["error"])
                    return None
                return payload
            except Exception as e:
                last_exc = e
                if attempt < self._max_retries:
                    sleep_for = self._retry_backoff_seconds * (attempt + 1)
                    self.logger.warning(
                        "Tentativa %d/%d falhou para %s%s: %s. "
                        "Aguardando %.1fs antes de repetir...",
                        attempt + 1, self._max_retries + 1,
                        endpoint, f" ({symbol})" if symbol else "",
                        str(e).splitlines()[0],
                        sleep_for,
                    )
                    time.sleep(sleep_for)
                else:
                    break
        if symbol:
            self.logger.error("Falha ao consultar %s (%s): %s", url, symbol, last_exc)
        else:
            self.logger.error("Falha ao consultar %s: %s", url, last_exc)
        return None

    def get_latest_signal(self, symbol, profile="moderate"):
        crypto = self._normalize_crypto(symbol)
        profile = str(profile or "moderate").lower()
        if profile not in ("conservative", "moderate", "aggressive"):
            profile = "moderate"

        recommendation = self._request_json(
            "last_recommendation",
            {"model_name": Config.MODEL_NAME, "crypto": crypto},
            symbol=symbol,
        )
        if not recommendation:
            return None

        recommendation_value = recommendation.get("recommendation")
        target_stop = None
        if recommendation_value and recommendation_value != "Hold":
            target_stop = self._request_json(
                "last_target_stop",
                {"model_name": Config.MODEL_NAME, "crypto": crypto, "profile": profile},
                symbol=symbol,
            )

        date_value = recommendation.get("Date")
        time_value = recommendation.get("Time")
        timestamp = f"{date_value} {time_value}".strip() if date_value or time_value else None
        signal_key = "|".join([
            str(date_value or ""),
            str(time_value or ""),
            str(recommendation_value or ""),
        ])

        signal_gains = None
        if target_stop:
            signal_gains = {
                "Target": target_stop.get("target"),
                "StopLoss": target_stop.get("stop_loss"),
            }

        try:
            price = float(recommendation.get("Price", 0.0))
        except (TypeError, ValueError):
            price = 0.0

        try:
            percentage = float(recommendation.get("percentage", 0.0))
        except (TypeError, ValueError):
            percentage = 0.0

        return {
            "timestamp": timestamp,
            "date": date_value,
            "time": time_value,
            "signal_key": signal_key,
            "recommendation": recommendation.get("recommendation"),
            "percentage": percentage,
            "price": price,
            "signal_gains": signal_gains,
            "profile": profile,
        }
