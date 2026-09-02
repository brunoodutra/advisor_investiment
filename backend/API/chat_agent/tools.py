from typing import Any, Dict, List, Optional

from API.news_scraper import get_crypto_news as _fetch_crypto_news
from API.news_scraper import get_sentiment_analysis_payload

ALWAYS_ALLOWED_TOOLS = {"get_trade_bot_summary"}
NEWS_LIMIT = 5


def _api_setup():
    from API import API_setup

    return API_setup


def get_recommendation(crypto: str, model: str = "CNN") -> Dict[str, Any]:
    symbol = str(crypto or "").upper().strip()
    if not symbol:
        return {"error": "crypto_required"}
    try:
        rec = _api_setup().get_last_recommendation(model, symbol)
        if not rec:
            return {"error": "not_available", "crypto": symbol}
        return {
            "crypto": symbol,
            "Date": rec.get("Date"),
            "Time": rec.get("Time"),
            "recommendation": rec.get("recommendation"),
            "percentage": rec.get("percentage"),
            "Price": rec.get("Price"),
        }
    except Exception as exc:
        return {"error": str(exc), "crypto": symbol}


def get_target_stop(crypto: str, profile: str = "moderate", model: str = "CNN") -> Dict[str, Any]:
    symbol = str(crypto or "").upper().strip()
    if not symbol:
        return {"error": "crypto_required"}
    try:
        ts = _api_setup().get_last_target_stop(model, symbol, profile)
        if not ts:
            return {"error": "not_available", "crypto": symbol, "profile": profile}
        return {
            "crypto": symbol,
            "profile": profile,
            "target": ts.get("target"),
            "stop_loss": ts.get("stop_loss"),
        }
    except Exception as exc:
        return {"error": str(exc), "crypto": symbol, "profile": profile}


def get_crypto_news_sentiment(crypto: str) -> Dict[str, Any]:
    symbol = str(crypto or "").upper().strip()
    if not symbol:
        return {"error": "crypto_required"}
    try:
        payload = get_sentiment_analysis_payload(crypto=symbol, limit=NEWS_LIMIT, lang="mixed")
        top_news = payload.get("Top_news") or []
        if isinstance(top_news, list):
            top_news = top_news[:NEWS_LIMIT]
        return {
            "crypto": payload.get("crypto") or symbol,
            "Sentiment": payload.get("Sentiment"),
            "confidence": payload.get("confidence"),
            "rationale": payload.get("rationale"),
            "key_drivers": (payload.get("key_drivers") or [])[:5],
            "sentiment_method": payload.get("sentiment_method"),
            "Top_news": top_news,
            "news_count": payload.get("news_count"),
        }
    except Exception as exc:
        return {"error": str(exc), "crypto": symbol}


def get_crypto_news(crypto: str, limit: int = NEWS_LIMIT) -> Dict[str, Any]:
    symbol = str(crypto or "").upper().strip()
    if not symbol:
        return {"error": "crypto_required"}
    safe_limit = max(1, min(int(limit or NEWS_LIMIT), NEWS_LIMIT))
    try:
        payload = _fetch_crypto_news(crypto=symbol, limit=safe_limit, lang="mixed")
        items = payload.get("news_items") or []
        trimmed = []
        for item in items[:safe_limit]:
            trimmed.append(
                {
                    "title": item.get("title"),
                    "summary": (item.get("summary") or "")[:200],
                    "source": item.get("source"),
                }
            )
        return {
            "crypto": payload.get("crypto") or symbol,
            "news_items": trimmed,
            "sources_used": (payload.get("sources_used") or [])[:10],
        }
    except Exception as exc:
        return {"error": str(exc), "crypto": symbol}


def get_trade_bot_summary() -> Dict[str, Any]:
    try:
        dashboard = _api_setup()._get_trade_bot_dashboard()
        summary = dashboard.get("summary") or {}
        positions = dashboard.get("active_positions") or []
        return {
            "bot_status": dashboard.get("bot_status"),
            "summary": {
                "active_positions": summary.get("active_positions"),
                "closed_trades": summary.get("closed_trades"),
                "win_rate": summary.get("win_rate"),
                "realized_pnl_usd": summary.get("realized_pnl_usd"),
                "open_pnl_usd": summary.get("open_pnl_usd"),
            },
            "active_positions": positions[:5],
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_chart_snapshot(context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not context or not isinstance(context, dict):
        return {"error": "not_in_request"}
    chart = context.get("chart")
    if not chart:
        return {"error": "not_in_request"}
    candles_tail = chart.get("candlesTail") or chart.get("candles_tail") or []
    if isinstance(candles_tail, list):
        candles_tail = candles_tail[:15]
    return {
        "candlesSummary": chart.get("candlesSummary"),
        "candlesTail": candles_tail,
        "indicators": chart.get("indicators"),
    }


def get_market_context(context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not context or not isinstance(context, dict):
        return {"error": "not_in_request"}
    market = context.get("market")
    if not market:
        return {"error": "not_in_request"}
    return market if isinstance(market, dict) else {"error": "not_in_request"}


def _is_tool_allowed(name: str, allowed_tools: List[str]) -> bool:
    if name in ALWAYS_ALLOWED_TOOLS:
        return True
    return name in allowed_tools


def execute_tool(
    name: str,
    args: Optional[Dict[str, Any]],
    *,
    hints: Dict[str, Any],
    context: Optional[Dict[str, Any]],
    allowed_tools: List[str],
) -> Dict[str, Any]:
    args = args if isinstance(args, dict) else {}
    if not _is_tool_allowed(name, allowed_tools):
        return {"error": "tool_not_allowed", "tool": name}

    crypto = args.get("crypto") or hints.get("crypto")
    model = args.get("model") or hints.get("model") or "CNN"
    profile = args.get("profile") or hints.get("profile") or "moderate"

    if name == "get_recommendation":
        return get_recommendation(crypto, model)
    if name == "get_target_stop":
        return get_target_stop(crypto, profile, model)
    if name == "get_crypto_news_sentiment":
        return get_crypto_news_sentiment(crypto)
    if name == "get_crypto_news":
        return get_crypto_news(crypto, args.get("limit", NEWS_LIMIT))
    if name == "get_trade_bot_summary":
        return get_trade_bot_summary()
    if name == "get_chart_snapshot":
        return get_chart_snapshot(context)
    if name == "get_market_context":
        return get_market_context(context)
    return {"error": "unknown_tool", "tool": name}
