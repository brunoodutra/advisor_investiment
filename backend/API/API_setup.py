
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import joblib
import os
import asyncio
import json
import time
import pandas as pd
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timezone
app = FastAPI()

_CSV_LINE_CACHE_TTL_SEC = 8.0
_csv_last_line_cache = {}

def _read_last_csv_line(file_path, with_header: bool = True):
    """Lê APENAS a última linha (e opcionalmente o header) de um CSV,
    evitando carregar o arquivo TODO no pandas (muito mais rápido para arquivos grandes).
    Retorna (headers_list, last_row_list) ou (None, None) em caso de falha.
    """
    try:
        p = Path(file_path)
        if not p.exists():
            return None, None
        size = p.stat().st_size
        if size == 0:
            return None, None
        with open(p, "rb") as f:
            tail_size = min(size, 4096)
            f.seek(-tail_size, 2)
            raw = f.read()
        text = raw.decode("utf-8", errors="replace")
        lines = text.splitlines()
        last = None
        while lines and last is None:
            cand = lines.pop()
            if cand.strip():
                last = cand
        if last is None:
            return None, None
        headers = None
        if with_header:
            if tail_size >= size:
                first_line = text.splitlines()[0] if text.splitlines() else None
            else:
                with open(p, "r", encoding="utf-8", errors="replace") as f:
                    first_line = f.readline().rstrip("\r\n")
            if first_line:
                headers = [c.strip() for c in first_line.split(",")]
        row = [c.strip() for c in _split_csv_line(last)]
        return headers, row
    except Exception:
        return None, None

def _split_csv_line(line: str):
    """Split simples de CSV por vírgula, ignorando vírgulas dentro de aspas duplas.
    Usado em vez de csv.reader para evitar overhead quando só queremos a última linha.
    """
    out = []
    cur = []
    in_q = False
    for ch in line:
        if ch == '"':
            in_q = not in_q
        elif ch == "," and not in_q:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return out

def _cache_get(key):
    entry = _csv_last_line_cache.get(key)
    if not entry:
        return None
    value, expire_at = entry
    if time.monotonic() > expire_at:
        _csv_last_line_cache.pop(key, None)
        return None
    return value

def _cache_set(key, value):
    _csv_last_line_cache[key] = (value, time.monotonic() + _CSV_LINE_CACHE_TTL_SEC)

def _cell(row, headers, name):
    if not row or not headers:
        return None
    if name not in headers:
        return None
    idx = headers.index(name)
    if idx >= len(row):
        return None
    return row[idx]

import sys

# Adiciona o diretório pai (finance) ao path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Agora importa usando o caminho correto
from API.news_scraper import get_crypto_news, get_sentiment_analysis_payload
from API.chat_agent.schemas import ChatRequest, ChatAgentResponse, ChatResetRequest, ChatResetResponse
from API.chat_agent.service import chat_turn, reset_session

try:
    from Trade_Bot.src.config import Config
    def _get_default_bot_config() -> dict:
        return Config.get_default_bot_config()
except Exception as _cfg_err:
    print(f"[API] Warning: Could not import Config from Trade_Bot.src.config: {_cfg_err}")
    def _get_default_bot_config() -> dict:
        now_iso = datetime.now(timezone.utc).isoformat()
        return {
            "status": "paused",
            "started_at": now_iso,
            "default_crypto_limit": 100.0,
            "max_allocation_per_crypto": {
                "BTCUSDT": 250.0,
                "ETHUSDT": 200.0,
                "SOLUSDT": 150.0,
                "XRPUSDT": 100.0,
                "ADAUSDT": 100.0
            },
            "risk_per_trade": 0.015,
            "confidence_threshold": 0.60,
            "leverage": 10,
            "risk_profile": "moderate",
            "last_signal_keys": {},
            "last_loop_at": None,
            "updated_at": now_iso
        }

try:
    from Trade_Bot.src.json_store import load_json, save_json
    from Trade_Bot.src.command_queue import enqueue_command
except Exception as _store_err:
    print(f"[API] Warning: Could not import Trade_Bot json_store/command_queue: {_store_err}")
    load_json = None
    save_json = None
    enqueue_command = None

_DEFAULT_FRONTEND_ORIGINS = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_frontend_origins = list(dict.fromkeys(
    _DEFAULT_FRONTEND_ORIGINS
    + [
        origin.strip()
        for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
        if origin.strip()
    ]
))
_trade_bot_api_token = (os.getenv("TRADE_BOT_API_TOKEN") or "").strip()
if not _trade_bot_api_token:
    print("[API] Warning: TRADE_BOT_API_TOKEN não definido. POST /trade_bot/* permanece aberto.")


def _cors_headers_for(request: Request) -> dict:
    origin = request.headers.get("origin") or ""
    if origin in _frontend_origins:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Trade-Bot-Token, Accept",
        }
    return {}


app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*", "X-Trade-Bot-Token", "Authorization", "Content-Type"],
)


@app.middleware("http")
async def protect_trade_bot_mutations(request: Request, call_next):
    path = request.url.path
    if path.startswith("/trade_bot") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if _trade_bot_api_token:
            provided = request.headers.get("x-trade-bot-token") or ""
            auth = request.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                provided = provided or auth[7:].strip()
            if provided != _trade_bot_api_token:
                return JSONResponse(
                    {"detail": "Unauthorized"},
                    status_code=401,
                    headers=_cors_headers_for(request),
                )
    return await call_next(request)

_api_dir = Path(__file__).resolve().parent
_recommendations_dir = (_api_dir.parent / "AI" / "Classification" / "Real_Time_Inference" / "Recommendations").resolve()
_trade_bot_data_dir = (_api_dir.parent / "Trade_Bot" / "data").resolve()

def _recommendation_csv_path(model_name: str, crypto: str) -> Path:
    return _recommendations_dir / f"{model_name}_{crypto}_recommendation.csv"

def _trade_bot_json_path(file_name: str) -> Path:
    return _trade_bot_data_dir / file_name

from typing import List, Dict, Any, Optional

def _load_json_list(file_path: Path) -> list:
    if load_json:
        payload = load_json(file_path, [])
        return payload if isinstance(payload, list) else []
    try:
        if not file_path.exists():
            return []
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, list) else []
    except Exception as e:
        print(f"Error loading JSON list from {file_path}: {e}")
        return []

def _save_json_list(file_path: Path, data: list):
    if save_json:
        save_json(file_path, data)
        return
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving JSON list to {file_path}: {e}")

def _load_json_dict(file_path: Path, default: dict) -> dict:
    if load_json:
        payload = load_json(file_path, default)
        if isinstance(payload, dict):
            res = default.copy()
            res.update(payload)
            return res
        return default.copy()
    try:
        if not file_path.exists():
            return default.copy()
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict):
            res = default.copy()
            res.update(payload)
            return res
        return default.copy()
    except Exception as e:
        print(f"Error loading JSON dict from {file_path}: {e}")
        return default.copy()

def _save_json_dict(file_path: Path, data: dict):
    if save_json:
        save_json(file_path, data)
        return
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving JSON dict to {file_path}: {e}")

def _get_bot_config() -> dict:
    return _load_json_dict(_trade_bot_json_path("bot_config.json"), _get_default_bot_config())

def _save_bot_config(config_dict: dict) -> dict:
    current = _get_bot_config()
    if isinstance(config_dict, dict):
        current.update(config_dict)
    current["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_json_dict(_trade_bot_json_path("bot_config.json"), current)
    return current

def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def _trade_protection_prices(trade) -> tuple:
    sl = _safe_float(trade.get("stop_loss_price"))
    tp = _safe_float(trade.get("take_profit_price"))
    gains = (trade.get("signal_data") or {}).get("signal_gains") or {}
    if sl <= 0:
        sl = _safe_float(gains.get("StopLoss"))
    if tp <= 0:
        tp = _safe_float(gains.get("Target"))
    return (sl if sl > 0 else None), (tp if tp > 0 else None)

def _normalize_trade_bot_symbol(symbol: str) -> str:
    symbol = str(symbol or "").upper()
    if symbol.endswith("USDT"):
        return symbol[:-4]
    return symbol

def _parse_timestamp(value: str):
    if not value:
        return None
    try:
        normalized = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except Exception:
        return None

def _get_trade_bot_dashboard():
    active_trades = _load_json_list(_trade_bot_json_path("active_trades.json"))
    order_history = _load_json_list(_trade_bot_json_path("order_history.json"))

    open_trades = [t for t in active_trades if t.get("status") in ["OPEN", "PENDING", "PARTIALLY_FILLED"]]
    closed_events = [e for e in order_history if e.get("event_type") == "TRADE_CLOSED"]
    entry_events = [e for e in order_history if e.get("event_type") == "ENTRY_ACCEPTED"]

    realized_pnl_usd = 0.0
    realized_pnl_percent_sum = 0.0
    wins = 0
    losses = 0
    breakeven = 0
    daily_pnl = defaultdict(float)
    close_reason_counter = Counter()
    entries_by_symbol = defaultdict(lambda: {"buy": 0, "sell": 0})

    for event in entry_events:
        symbol = event.get("symbol") or event.get("trade", {}).get("symbol") or "UNKNOWN"
        side = (event.get("details", {}) or {}).get("side") or event.get("trade", {}).get("side") or "unknown"
        side = str(side).lower()
        if side not in ("buy", "sell"):
            continue
        entries_by_symbol[symbol][side] += 1

    cumulative_points = []
    cumulative_total = 0.0
    for event in sorted(closed_events, key=lambda item: item.get("timestamp") or ""):
        details = event.get("details", {}) or {}
        pnl_usd = _safe_float(details.get("pnl_usd"))
        pnl_percent = _safe_float(details.get("pnl_percent"))
        realized_pnl_usd += pnl_usd
        realized_pnl_percent_sum += pnl_percent
        cumulative_total += pnl_usd

        if pnl_usd > 0:
            wins += 1
        elif pnl_usd < 0:
            losses += 1
        else:
            breakeven += 1

        reason = details.get("reason") or "UNKNOWN"
        close_reason_counter[str(reason)] += 1

        ts = _parse_timestamp(event.get("timestamp"))
        if ts:
            daily_pnl[ts.date().isoformat()] += pnl_usd

        cumulative_points.append({
            "timestamp": event.get("timestamp"),
            "symbol": event.get("symbol"),
            "pnl_usd": round(pnl_usd, 4),
            "cumulative_pnl_usd": round(cumulative_total, 4),
        })

    open_pnl_usd = 0.0
    open_position_value_usd = 0.0
    active_positions = []
    for trade in open_trades:
        symbol = trade.get("symbol")
        entry_price = _safe_float(trade.get("entry_price"))
        quantity = _safe_float(trade.get("quantity"))
        position_value_usd = _safe_float(trade.get("position_value_usd"))
        current_price = None
        current_pnl_usd = None
        current_pnl_percent = None

        try:
            crypto = _normalize_trade_bot_symbol(symbol)
            rec = get_last_recommendation("CNN", crypto)
            if rec and rec.get("Price") is not None:
                current_price = _safe_float(rec.get("Price"))
        except Exception:
            current_price = None

        if current_price and entry_price and quantity:
            if str(trade.get("side")).lower() == "buy":
                current_pnl_usd = (current_price - entry_price) * quantity
            else:
                current_pnl_usd = (entry_price - current_price) * quantity
            current_pnl_percent = (current_pnl_usd / position_value_usd * 100) if position_value_usd > 0 else 0.0
            open_pnl_usd += current_pnl_usd
        open_position_value_usd += position_value_usd

        stop_loss, take_profit = _trade_protection_prices(trade)
        active_positions.append({
            "symbol": symbol,
            "side": trade.get("side"),
            "status": trade.get("status"),
            "entry_order_id": trade.get("entry_order_id"),
            "entry_price": entry_price,
            "current_price": round(current_price, 6) if current_price is not None else None,
            "quantity": quantity,
            "position_value_usd": round(position_value_usd, 4),
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "pnl_usd": round(current_pnl_usd, 4) if current_pnl_usd is not None else None,
            "pnl_percent": round(current_pnl_percent, 4) if current_pnl_percent is not None else None,
            "timestamp": trade.get("timestamp"),
        })

    total_closed = len(closed_events)
    avg_pnl_percent = realized_pnl_percent_sum / total_closed if total_closed else 0.0
    win_rate = (wins / total_closed * 100) if total_closed else 0.0

    symbol_totals = []
    for symbol, counts in sorted(entries_by_symbol.items()):
        total = counts["buy"] + counts["sell"]
        symbol_totals.append({
            "symbol": symbol,
            "buy": counts["buy"],
            "sell": counts["sell"],
            "total": total,
        })

    recent_events = []
    for event in order_history[-25:]:
        recent_events.append({
            "timestamp": event.get("timestamp"),
            "event_type": event.get("event_type"),
            "symbol": event.get("symbol"),
            "status": event.get("status"),
            "details": event.get("details", {}) or {},
        })

    bot_config = _get_bot_config()
    return {
        "bot_status": bot_config.get("status", "running"),
        "bot_started_at": bot_config.get("started_at"),
        "config": bot_config,
        "summary": {
            "active_positions": len(open_trades),
            "closed_trades": total_closed,
            "winning_trades": wins,
            "losing_trades": losses,
            "breakeven_trades": breakeven,
            "win_rate": round(win_rate, 2),
            "realized_pnl_usd": round(realized_pnl_usd, 4),
            "avg_pnl_percent": round(avg_pnl_percent, 4),
            "open_pnl_usd": round(open_pnl_usd, 4),
            "open_position_value_usd": round(open_position_value_usd, 4),
            "buy_entries": sum(item["buy"] for item in symbol_totals),
            "sell_entries": sum(item["sell"] for item in symbol_totals),
            "history_events": len(order_history),
            "last_event_at": order_history[-1].get("timestamp") if order_history else None,
        },
        "charts": {
            "cumulative_pnl": cumulative_points[-120:],
            "daily_realized_pnl": [
                {"date": date_key, "pnl_usd": round(value, 4)}
                for date_key, value in sorted(daily_pnl.items())
            ],
            "entries_by_symbol": symbol_totals,
            "close_reasons": [
                {"reason": reason, "count": count}
                for reason, count in close_reason_counter.most_common()
            ],
            "trade_outcomes": {
                "wins": wins,
                "losses": losses,
                "breakeven": breakeven,
            },
        },
        "active_positions": active_positions,
        "recent_events": list(reversed(recent_events)),
    }

# function to get the last recomendation
def get_last_recommendation(model_name: str, crypto: str):
    cache_key = f"last_rec:{model_name}:{crypto}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached if cached is not False else None
    file_path = _recommendation_csv_path(model_name, crypto)
    try:
        headers, row = _read_last_csv_line(file_path, with_header=True)
        if headers and row:
            result = {
                'Date': _cell(row, headers, 'Date'),
                'Time': _cell(row, headers, 'Time'),
                'recommendation': _cell(row, headers, 'recommendation'),
                'percentage': _safe_float(_cell(row, headers, 'percentage'), 0.0),
                'Price': _safe_float(_cell(row, headers, 'Price'), 0.0),
            }
            _cache_set(cache_key, result or False)
            return result
    except Exception as e:
        print(f"[fast-read] Fallback to pandas for {file_path}: {e}")
    try:
        df = pd.read_csv(str(file_path), sep=',', header=0)
        last_recommendation = df.iloc[-1]
        result = {
            'Date': last_recommendation['Date'],
            'Time': last_recommendation['Time'],
            'recommendation': last_recommendation['recommendation'],
            'percentage': last_recommendation['percentage'],
            'Price': last_recommendation['Price'],
        }
        _cache_set(cache_key, result or False)
        return result
    except pd.errors.ParserError as e:
        print(f"Error parsing CSV file: {e}")
        _cache_set(cache_key, False)
        return None
    except FileNotFoundError:
        print(f"File not found: {file_path}")
        _cache_set(cache_key, False)
        return None
    except Exception as e:
        print(f"An error occurred: {e}")
        _cache_set(cache_key, False)
        return None
# function to get a specific date and time recomendation
def get_especific_recommendation(model_name: str, crypto: str, date: str, time: str, profile: str = 'conservative'):
    file_path = _recommendation_csv_path(model_name, crypto)
    try:
        # Specify the delimiter (in this case, a comma)
        df = pd.read_csv(str(file_path), sep=',', header=0)
        specific_recommendation = df[(df['Date'] == date) & (df['Time'] == time)]

        signal_gains = specific_recommendation['SignalGains'].apply(json.loads).iloc[0]
        # Obtem os valores de target e stop loss para o perfil especificado
        target = signal_gains[profile]['target']
        stop_loss = signal_gains[profile]['stop_loss']

        if not specific_recommendation.empty:
            row = specific_recommendation.iloc[0]
            return {
                'Date': row['Date'],
                'Time': row['Time'],
                'recommendation': row['recommendation'],
                'percentage': row['percentage'],
                'Price': row['Price'],
                'target': target,
                'stop_loss': stop_loss
            }
        else:
            return None
    except pd.errors.ParserError as e:
        print(f"Error parsing CSV file: {e}")
        return None
    except FileNotFoundError:
        print(f"File not found: {file_path}")
        return None
    except Exception as e:
        print(f"An error occurred: {e}")
        return None

def get_recommendation_history(model_name: str, crypto: str, last_n: int = 200):
    file_path = _recommendation_csv_path(model_name, crypto)
    if file_path.exists():
        df = pd.read_csv(str(file_path))

        if len(df) < last_n:
            last_n = len(df)
            
        df = df.iloc[-last_n:]  # Get the last n rows
        
        history = []
        for index, row in df.iterrows():
            history.append({
                'Date': row['Date'],
                'Time': row['Time'],
                'recommendation': row['recommendation'],
                'percentage': row['percentage'],
                'Price': row['Price'],
            })
        return history
    else:
        return None

def get_last_target_stop(model_name: str, crypto: str, profile: str):
    cache_key = f"last_ts:{model_name}:{crypto}:{profile}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached if cached is not False else None
    file_path = _recommendation_csv_path(model_name, crypto)
    try:
        headers, row = _read_last_csv_line(file_path, with_header=True)
        if headers and row:
            sg_raw = _cell(row, headers, 'SignalGains')
            if sg_raw:
                try:
                    signal_gains = json.loads(sg_raw)
                except Exception:
                    signal_gains = None
                if (isinstance(signal_gains, dict)
                        and profile in signal_gains
                        and 'target' in signal_gains[profile]
                        and 'stop_loss' in signal_gains[profile]):
                    result = {
                        'target': signal_gains[profile]['target'],
                        'stop_loss': signal_gains[profile]['stop_loss'],
                    }
                    _cache_set(cache_key, result or False)
                    return result
    except Exception as e:
        print(f"[fast-read ts] Fallback to pandas for {file_path}: {e}")
    try:
        df = pd.read_csv(str(file_path), sep=',', header=0)
        last_row = df.iloc[-1]
        signal_gains = json.loads(last_row['SignalGains'])
        target = signal_gains[profile]['target']
        stop_loss = signal_gains[profile]['stop_loss']
        result = {'target': target, 'stop_loss': stop_loss}
        _cache_set(cache_key, result or False)
        return result
    except pd.errors.ParserError as e:
        print(f"Error parsing CSV file: {e}")
        _cache_set(cache_key, False)
        return None
    except FileNotFoundError:
        print(f"File not found: {file_path}")
        _cache_set(cache_key, False)
        return None
    except Exception as e:
        print(f"An error occurred: {e}")
        _cache_set(cache_key, False)
        return None

# API para obter os valores de target e stop loss
@app.get("/last_target_stop")
def last_target_stop_api(model_name: str, crypto: str, profile: str):
    last_target_stop = get_last_target_stop(model_name, crypto, profile)
    if last_target_stop is not None:
        return last_target_stop
    else:
        return {"error": "No recommendations found"}
        
# API to get the last recomendation
@app.get("/last_recommendation")
def last_recommendation_api(model_name: str, crypto: str):
    last_recommendation = get_last_recommendation(model_name, crypto)
    if last_recommendation is not None:
        return last_recommendation
    else:
        return {"error": "No recommendations found"}

@app.get("/specific_recommendation")
def specific_recommendation_api(model_name: str, crypto: str, date: str, time: str, profile: str = 'conservative'):
    specific_recommendation = get_especific_recommendation(model_name, crypto, date, time, profile)
    if specific_recommendation is not None:
        return specific_recommendation
    else:
        return {"error": "No recommendations found for the specified date and time"}    
    
# API to get the history 
@app.get("/recommendation_history")
def recommendation_history_api(model_name: str, crypto: str, last_n: int = 500):
    history  = get_recommendation_history(model_name, crypto, last_n)
    if history  is not None:
        return history 
    else:
        return {"error": "No recommendations found"}

@app.get("/crypto_news")
async def crypto_news(crypto: str, limit: int = 10, lang: str = "mixed"):
    payload = get_crypto_news(crypto=crypto, limit=limit, lang=lang)
    if payload.get("news_items"):
        return payload
    return {
        "crypto": str(crypto or "").upper(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sources_used": [],
        "news_items": [],
    }

@app.get("/sentiment_analysis")
async def sentiment_analysis(crypto: str, limit: int = 10, lang: str = "mixed"):
    payload = get_sentiment_analysis_payload(crypto=crypto, limit=limit, lang=lang)
    if payload.get("news_count", 0) > 0:
        return payload
    return {
        "Sentiment": "middle",
        "Top_news": [],
        "crypto": str(crypto or "").upper(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sources_used": [],
        "news_count": 0,
        "confidence": None,
        "rationale": None,
        "key_drivers": [],
        "sentiment_method": "heuristic",
    }

@app.get("/trade_bot/dashboard")
def trade_bot_dashboard():
    return _get_trade_bot_dashboard()

from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class BotConfigUpdateRequest(BaseModel):
    status: Optional[str] = None
    default_crypto_limit: Optional[float] = None
    max_allocation_per_crypto: Optional[Dict[str, float]] = None
    risk_per_trade: Optional[float] = None
    confidence_threshold: Optional[float] = None
    leverage: Optional[int] = None
    risk_profile: Optional[str] = None

class BotToggleRequest(BaseModel):
    status: Optional[str] = None

@app.get("/trade_bot/config")
def get_trade_bot_config_api():
    return _get_bot_config()

@app.post("/trade_bot/config")
def update_trade_bot_config_api(req: BotConfigUpdateRequest):
    data = req.dict(exclude_unset=True)
    updated = _save_bot_config(data)
    return {"status": "success", "config": updated}

@app.post("/trade_bot/toggle")
def toggle_trade_bot_api(req: Optional[BotToggleRequest] = None):
    current = _get_bot_config()
    current_status = current.get("status", "running")
    target_status = None
    if req and req.status:
        target_status = req.status
    else:
        target_status = "paused" if current_status == "running" else "running"

    update_data = {"status": target_status}
    if target_status == "running" and current_status != "running":
        update_data["started_at"] = datetime.now(timezone.utc).isoformat()

    updated = _save_bot_config(update_data)
    return {"status": updated.get("status"), "config": updated}

@app.post("/trade_bot/emergency_close")
def emergency_close_trade_bot_api():
    updated_config = _save_bot_config({"status": "paused"})
    if enqueue_command is None:
        return JSONResponse(
            {"detail": "Fila de comandos indisponível. O bot não pode fechar posições pela API."},
            status_code=503,
        )
    command = enqueue_command("CLOSE_ALL", reason="EMERGENCY_MANUAL_CLOSE")
    return {
        "status": "queued",
        "queued": True,
        "command_id": command.get("id"),
        "closed_count": 0,
        "closed_positions": 0,
        "bot_status": "paused",
        "config": updated_config,
        "message": "Fechamento emergencial enfileirado. O bot executa o CLOSE_ALL mesmo se estiver pausado.",
    }


class ClosePositionRequest(BaseModel):
    symbol: str
    reason: Optional[str] = "MANUAL_CLOSE"


@app.post("/trade_bot/positions/close")
def close_trade_bot_position_api(req: ClosePositionRequest):
    if enqueue_command is None:
        return JSONResponse({"detail": "Fila de comandos indisponível."}, status_code=503)
    command = enqueue_command("CLOSE_SYMBOL", symbol=req.symbol, reason=req.reason or "MANUAL_CLOSE")
    return {
        "status": "queued",
        "queued": True,
        "command_id": command.get("id"),
        "symbol": req.symbol,
    }

@app.post("/chat", response_model=ChatAgentResponse)
async def chat_api(request: ChatRequest):
    try:
        return await asyncio.to_thread(chat_turn, request)
    except Exception as exc:
        msg = (
            "Não foi possível obter uma resposta da IA agora. "
            "Verifique GROQ_API_KEY / OPENROUTER_API_KEY no .env e os logs da API."
        )
        print(f"[chat] Erro: {exc}")
        from API.chat_agent.schemas import MissionStatus
        return ChatAgentResponse(
            content=msg,
            answer=msg,
            mission=MissionStatus(),
            blocked=True,
            blocked_reason="llm_unavailable",
            summary=None,
            tools_used=[],
        )


@app.post("/chat/reset", response_model=ChatResetResponse)
async def chat_reset_api(request: ChatResetRequest):
    try:
        await asyncio.to_thread(reset_session, request.sessionId)
    except Exception as exc:
        print(f"[chat/reset] Erro: {exc}")
    return ChatResetResponse(status="ok")
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
