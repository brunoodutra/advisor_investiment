import os
import yaml
from datetime import datetime, timezone
from dotenv import load_dotenv

_trade_bot_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_trade_bot_dir, ".env"))

def _load_yaml_settings() -> dict:
    yaml_path = os.path.join(_trade_bot_dir, "bot_settings.yaml")
    if os.path.exists(yaml_path):
        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                if isinstance(data, dict):
                    return data
        except Exception as e:
            print(f"[Config] Warning: Failed to parse bot_settings.yaml: {e}")
    return {}

_yaml_settings = _load_yaml_settings()
_bot_yaml = _yaml_settings.get("bot", {})
_alloc_yaml = _yaml_settings.get("allocation", {})
_market_yaml = _yaml_settings.get("market", {})

class Config:
    API_KEY = os.getenv("BINANCE_API_KEY")
    SECRET_KEY = os.getenv("BINANCE_SECRET_KEY") or os.getenv("BINANCE_API_SECRET")
    TRADING_MODE = os.getenv("TRADING_MODE", os.getenv("MODE", "PAPER")).upper()
    MARKET_MODE = os.getenv("MARKET_MODE", os.getenv("MARKET_TYPE", "FUTURES")).upper()  # FUTURES | SPOT
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
    API_BASE_URL = os.getenv("RECOMMENDATION_API_URL", "http://127.0.0.1:8000")
    MODEL_NAME = os.getenv("RECOMMENDATION_MODEL_NAME", "CNN")
    API_TIMEOUT_SECONDS = float(os.getenv("API_TIMEOUT_SECONDS", "30"))
    PAPER_BALANCE = float(os.getenv("PAPER_BALANCE", "1000"))
    TRADE_BOT_API_TOKEN = (os.getenv("TRADE_BOT_API_TOKEN") or "").strip()
    FRONTEND_ORIGINS = [
        origin.strip()
        for origin in os.getenv(
            "FRONTEND_ORIGINS",
            "http://localhost:8080,http://127.0.0.1:8080",
        ).split(",")
        if origin.strip()
    ]

    BASE_DIR = _trade_bot_dir
    DATA_DIR = os.path.join(BASE_DIR, "data")
    LOG_DIR = os.path.join(BASE_DIR, "logs")
    SETTINGS_YAML_PATH = os.path.join(BASE_DIR, "bot_settings.yaml")

    SYMBOLS = _market_yaml.get("symbols", ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "ADAUSDT"])
    TIMEFRAME = _market_yaml.get("timeframe", "4h")
    # Confianca minima do modelo para aceitar um sinal e tentar operar.
    CONFIDENCE_THRESHOLD = float(_bot_yaml.get("confidence_threshold", 0.60))
    # Fração do capital efetivo arriscada se o stop loss for atingido (não é o tamanho da posição).
    RISK_PER_TRADE = float(_bot_yaml.get("risk_per_trade", 0.015))
    # Multiplicador de exposicao no futures; 10 significa 10x de alavancagem.
    LEVERAGE = int(_bot_yaml.get("leverage", 10))
    RISK_PROFILE = str(_bot_yaml.get("risk_profile", "moderate")).lower()
    # Frequencia do log de P&L total (em ciclos); 0 = desativado, 1 = a cada ciclo, 2 = a cada 2 ciclos, etc.
    PNL_LOG_INTERVAL = int(_bot_yaml.get("pnl_log_interval", 1))
    # protection | confirm | reversal | target_then_sell — ver bot_settings.yaml
    EXIT_POLICY = str(_bot_yaml.get("exit_policy", "protection")).strip().lower()
    CONFIRM_REVERSAL_SIGNALS = int(_bot_yaml.get("confirm_reversal_signals", 2))

    @staticmethod
    def get_default_bot_config() -> dict:
        """
        Retorna o dicionário de configuração padrão (fallback) lido do bot_settings.yaml.
        Usado para inicializar ou mesclar com bot_config.json em tempo de execução.
        """
        yaml_data = _load_yaml_settings()
        bot_data = yaml_data.get("bot", {})
        alloc_data = yaml_data.get("allocation", {})
        
        now_iso = datetime.now(timezone.utc).isoformat()
        return {
            "status": str(bot_data.get("status", "paused")),
            "started_at": now_iso,
            "default_crypto_limit": float(alloc_data.get("default_crypto_limit", 100.0)),
            "max_allocation_per_crypto": dict(alloc_data.get("max_allocation_per_crypto", {
                "BTCUSDT": 250.0,
                "ETHUSDT": 200.0,
                "SOLUSDT": 150.0,
                "XRPUSDT": 100.0,
                "ADAUSDT": 100.0
            })),
            "risk_per_trade": float(bot_data.get("risk_per_trade", 0.015)),
            "confidence_threshold": float(bot_data.get("confidence_threshold", 0.60)),
            "leverage": int(bot_data.get("leverage", 10)),
            "risk_profile": str(bot_data.get("risk_profile", "moderate")).lower(),
            "exit_policy": str(bot_data.get("exit_policy", "protection")).strip().lower(),
            "confirm_reversal_signals": int(bot_data.get("confirm_reversal_signals", 2)),
            "last_signal_keys": {},
            "last_loop_at": None,
            "updated_at": now_iso
        }

    @staticmethod
    def validate():
        if Config.TRADING_MODE != "PAPER" and (not Config.API_KEY or not Config.SECRET_KEY):
            raise ValueError("API_KEY and SECRET_KEY must be set in .env file")
