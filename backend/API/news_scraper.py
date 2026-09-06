import json
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote
from xml.etree import ElementTree as ET

import requests
from concurrent.futures import ThreadPoolExecutor

try:
    from LLM_chat.llm_conversation import LLM_news_sentiment_response
except Exception:
    LLM_news_sentiment_response = None

_REQUEST_TIMEOUT_SECONDS = 8
_CACHE_TTL_SECONDS = 600
_CACHE_TTL_SECONDS_EMPTY = 120  # resultado vazio (ex.: ADA sem manchetes) re-tenta mais cedo

_NEWS_CACHE: Dict[str, Dict] = {}
_API_DIR = Path(__file__).resolve().parent
_SENTIMENT_CACHE_DIR = _API_DIR / "cache" / "sentiment"

_LANGUAGE_SOURCE_ORDER = {
    "pt": ["Portal do Bitcoin", "Cointelegraph Brasil"],
    "en": ["CoinDesk", "Cointelegraph", "Decrypt", "CryptoSlate", "Crypto.news", "NewsBTC", "Bitcoin.com"],
    "mixed": [
        "Portal do Bitcoin",
        "Cointelegraph Brasil",
        "CoinDesk",
        "Cointelegraph",
        "Decrypt",
        "CryptoSlate",
        "Crypto.news",
        "NewsBTC",
        "Bitcoin.com",
    ],
}

_BASE_FEEDS = {
    "CoinDesk": {
        "type": "rss",
        "language": "en",
        "url": "https://www.coindesk.com/arc/outboundfeeds/rss",
    },
    "Cointelegraph": {
        "type": "rss",
        "language": "en",
        "url": "https://cointelegraph.com/rss",
    },
    "Decrypt": {
        "type": "rss",
        "language": "en",
        "url": "https://decrypt.co/feed",
    },
    "CryptoSlate": {
        "type": "rss",
        "language": "en",
        "url": "https://cryptoslate.com/feed/",
    },
    "Crypto.news": {
        "type": "rss",
        "language": "en",
        "url": "https://crypto.news/feed/",
    },
    "NewsBTC": {
        "type": "rss",
        "language": "en",
        "url": "https://www.newsbtc.com/feed/",
    },
    "Bitcoin.com": {
        "type": "rss",
        "language": "en",
        "url": "https://news.bitcoin.com/feed/",
    },
    "Portal do Bitcoin": {
        "type": "rss",
        "language": "pt",
        "url": "https://portaldobitcoin.uol.com.br/feed/",
    },
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: Optional[str]) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        pass

    try:
        normalized = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _strip_html(value: Optional[str]) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _coin_metadata(crypto: str) -> Dict[str, List[str]]:
    symbol = str(crypto or "").upper().strip()
    names = {
        "BTC": ["bitcoin", "btc", "xbt"],
        "ETH": ["ethereum", "eth", "ether"],
        "SOL": ["solana", "sol"],
        "XRP": ["xrp", "ripple"],
        "ADA": ["ada", "cardano"],
        "BNB": ["bnb", "binance coin"],
        "DOGE": ["doge", "dogecoin"],
        "AVAX": ["avax", "avalanche"],
        "LINK": ["link", "chainlink"],
        "MATIC": ["matic", "polygon", "pol"],
        "DOT": ["dot", "polkadot"],
        "LTC": ["ltc", "litecoin"],
        "SHIB": ["shib", "shiba inu"],
    }
    keywords = names.get(symbol, [symbol.lower()])
    return {
        "symbol": symbol,
        "keywords": list(dict.fromkeys([symbol.lower()] + keywords)),
    }


def _cointelegraph_tag_url(keyword: str) -> str:
    safe_keyword = quote(keyword.strip().lower())
    return f"https://cointelegraph.com/rss/tag/{safe_keyword}"


def _cointelegraph_brasil_search_url(keyword: str) -> str:
    safe_keyword = quote(keyword.strip())
    return f"https://br.cointelegraph.com/tags/{safe_keyword}"


def _build_feed_catalog(crypto: str, lang: str = "mixed") -> List[Dict]:
    coin_info = _coin_metadata(crypto)
    feeds = []
    source_order = _LANGUAGE_SOURCE_ORDER.get(lang, _LANGUAGE_SOURCE_ORDER["mixed"])

    for source_name in source_order:
        base = _BASE_FEEDS.get(source_name)
        if base:
            feeds.append({**base, "source": source_name})

    # Cointelegraph por tag costuma ser mais preciso para algumas moedas.
    primary_keyword = coin_info["keywords"][0]
    if lang in ("en", "mixed"):
        feeds.insert(
            0,
            {
                "type": "rss",
                "language": "en",
                "source": "Cointelegraph",
                "url": _cointelegraph_tag_url(primary_keyword),
            },
        )

    # Fallback leve para Cointelegraph Brasil sem RSS dedicado.
    if lang in ("pt", "mixed"):
        feeds.insert(
            1,
            {
                "type": "html",
                "language": "pt",
                "source": "Cointelegraph Brasil",
                "url": _cointelegraph_brasil_search_url(primary_keyword),
            },
        )

    return feeds


def _fetch_text(url: str) -> Optional[str]:
    headers = {
        "User-Agent": "advisor-investiment-news-bot/1.0",
        "Accept": "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
    }
    try:
        response = requests.get(url, headers=headers, timeout=_REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        return response.text
    except Exception:
        return None


def _extract_rss_items(xml_text: str, source: str, language: str) -> List[Dict]:
    items: List[Dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    for item in root.findall(".//item"):
        title = _normalize_text(item.findtext("title"))
        link = _normalize_text(item.findtext("link"))
        description = _strip_html(item.findtext("description"))
        published_at = _parse_date(item.findtext("pubDate"))

        content = ""
        for child in list(item):
            tag_name = child.tag.lower()
            if tag_name.endswith("encoded"):
                content = _strip_html(child.text)
                break

        if not title or not link:
            continue

        items.append(
            {
                "title": title,
                "summary": description[:400],
                "url": link,
                "source": source,
                "language": language,
                "published_at": published_at.isoformat() if published_at else None,
                "content": content[:1200],
            }
        )

    return items


def _extract_cointelegraph_brasil_items(html_text: str, keyword: str) -> List[Dict]:
    items: List[Dict] = []
    pattern = re.compile(
        r'href="(?P<url>https://br\.cointelegraph\.com/news/[^"]+)"[^>]*>(?P<title>[^<]+)</a>',
        re.IGNORECASE,
    )

    seen = set()
    for match in pattern.finditer(html_text):
        title = _strip_html(match.group("title"))
        url = _normalize_text(match.group("url"))
        dedupe_key = f"{_normalize_key(title)}::{url}"
        if not title or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        items.append(
            {
                "title": title,
                "summary": "",
                "url": url,
                "source": "Cointelegraph Brasil",
                "language": "pt",
                "published_at": None,
                "content": keyword,
            }
        )
        if len(items) >= 15:
            break

    return items


def _fetch_feed_items(feed: Dict, keyword: str) -> List[Dict]:
    raw_text = _fetch_text(feed["url"])
    if not raw_text:
        return []

    if feed["type"] == "rss":
        return _extract_rss_items(raw_text, feed["source"], feed["language"])

    if feed["type"] == "html" and feed["source"] == "Cointelegraph Brasil":
        return _extract_cointelegraph_brasil_items(raw_text, keyword)

    return []


def _news_matches_crypto(item: Dict, keywords: List[str]) -> bool:
    haystack = " ".join(
        [
            item.get("title", ""),
            item.get("summary", ""),
            item.get("content", ""),
            item.get("url", ""),
        ]
    ).lower()

    for keyword in keywords:
        normalized = keyword.lower().strip()
        if not normalized:
            continue
        if len(normalized) <= 4:
            if re.search(rf"\b{re.escape(normalized)}\b", haystack):
                return True
        elif normalized in haystack:
            return True
    return False


def _language_bonus(item_language: str, requested_language: str) -> float:
    if requested_language == "mixed":
        return 0.0
    if item_language == requested_language:
        return 6.0
    return -4.0


def _source_bonus(source: str) -> float:
    ranking = {
        "Portal do Bitcoin": 10.0,
        "CoinDesk": 9.5,
        "Cointelegraph": 9.0,
        "Cointelegraph Brasil": 8.5,
        "Decrypt": 8.0,
        "CryptoSlate": 7.0,
        "Crypto.news": 7.0,
        "NewsBTC": 6.5,
        "Bitcoin.com": 6.0,
    }
    return ranking.get(source, 5.0)


def _recency_bonus(published_at: Optional[str]) -> float:
    if not published_at:
        return 3.0

    parsed = _parse_date(published_at)
    if not parsed:
        return 3.0

    hours_old = max((_utc_now() - parsed).total_seconds() / 3600.0, 0.0)
    if hours_old <= 6:
        return 20.0
    if hours_old <= 24:
        return 15.0
    if hours_old <= 48:
        return 10.0
    if hours_old <= 96:
        return 5.0
    return 1.0


def _keyword_bonus(item: Dict, keywords: List[str]) -> float:
    title = item.get("title", "").lower()
    summary = item.get("summary", "").lower()
    bonus = 0.0
    for keyword in keywords:
        normalized = keyword.lower().strip()
        if not normalized:
            continue
        if len(normalized) <= 4:
            pattern = rf"\b{re.escape(normalized)}\b"
            if re.search(pattern, title):
                bonus += 12.0
            elif re.search(pattern, summary):
                bonus += 5.0
        else:
            if normalized in title:
                bonus += 12.0
            elif normalized in summary:
                bonus += 5.0
    return min(bonus, 24.0)


def _dedupe_news(items: List[Dict]) -> List[Dict]:
    deduped = {}
    for item in items:
        url = item.get("url") or ""
        title = item.get("title") or ""
        key = url or _normalize_key(title)
        current = deduped.get(key)
        if current is None:
            deduped[key] = item
            continue
        current_score = current.get("score", 0)
        new_score = item.get("score", 0)
        if new_score > current_score:
            deduped[key] = item
    return list(deduped.values())


def _sort_news(items: List[Dict]) -> List[Dict]:
    return sorted(
        items,
        key=lambda item: (
            item.get("score", 0),
            item.get("published_at") or "",
        ),
        reverse=True,
    )


def _compute_sentiment(news_items: List[Dict]) -> str:
    if not news_items:
        return "middle"

    positive_terms = [
        "surge",
        "rally",
        "rise",
        "bull",
        "bullish",
        "alta",
        "sobe",
        "ganha",
        "aprova",
        "adoption",
        "approval",
        "inflow",
    ]
    negative_terms = [
        "fall",
        "drop",
        "crash",
        "bear",
        "bearish",
        "queda",
        "cai",
        "perde",
        "hack",
        "exploit",
        "outflow",
        "ban",
        "lawsuit",
    ]

    score = 0
    for item in news_items[:10]:
        text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
        for term in positive_terms:
            if term in text:
                score += 1
        for term in negative_terms:
            if term in text:
                score -= 1

    if score >= 2:
        return "positive"
    if score <= -2:
        return "negative"
    return "middle"


def _build_news_sentiment_context(crypto: str, news_items: List[Dict]) -> str:
    symbol = str(crypto or "").upper().strip()
    lines = [
        f"Ativo analisado: {symbol}",
        f"Quantidade de noticias: {len(news_items)}",
        "",
        "Noticias ranqueadas:",
    ]

    for index, item in enumerate(news_items[:10], start=1):
        title = _normalize_text(item.get("title"))
        summary = _normalize_text(item.get("summary"))
        source = _normalize_text(item.get("source"))
        published_at = _normalize_text(item.get("published_at"))
        language = _normalize_text(item.get("language"))
        score = item.get("score")

        lines.extend(
            [
                f"{index}. Titulo: {title}",
                f"Fonte: {source or 'desconhecida'}",
                f"Publicado em: {published_at or 'desconhecido'}",
                f"Idioma: {language or 'desconhecido'}",
                f"Score de relevancia: {score if score is not None else 'n/a'}",
                f"Resumo: {summary or 'sem resumo'}",
                "",
            ]
        )

    return "\n".join(lines).strip()


def _compute_sentiment_with_llm(crypto: str, news_items: List[Dict]) -> Optional[Dict]:
    if not news_items or LLM_news_sentiment_response is None:
        return None

    try:
        return LLM_news_sentiment_response(
            {
                "context": _build_news_sentiment_context(crypto, news_items),
            }
        )
    except Exception:
        return None


def _build_cache_key(crypto: str, limit: int, lang: str) -> str:
    return f"{str(crypto or '').upper()}::{int(limit)}::{lang}"


def _normalize_request_params(crypto: str, limit: int = 10, lang: str = "mixed") -> tuple[str, int, str]:
    symbol = str(crypto or "").upper().strip()
    safe_limit = max(1, min(int(limit or 10), 20))
    requested_language = str(lang or "mixed").lower().strip()
    if requested_language not in ("pt", "en", "mixed"):
        requested_language = "mixed"
    return symbol, safe_limit, requested_language


def _cache_age_seconds(created_at: Optional[str]) -> Optional[float]:
    parsed = _parse_date(created_at)
    if not parsed:
        return None
    return max((_utc_now() - parsed).total_seconds(), 0.0)


def _sentiment_cache_path(cache_key: str) -> Path:
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", cache_key)
    return _SENTIMENT_CACHE_DIR / f"{safe_name}.json"


def _load_cached_json(file_path: Path) -> Optional[Dict]:
    try:
        if not file_path.exists():
            return None
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _write_cached_json(file_path: Path, payload: Dict) -> None:
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception:
        return None


def _get_cached(cache_key: str) -> Optional[Dict]:
    cached = _NEWS_CACHE.get(cache_key)
    if not cached:
        return None
    if time.time() - cached["created_at"] > _CACHE_TTL_SECONDS:
        _NEWS_CACHE.pop(cache_key, None)
        return None
    return cached["payload"]


def _set_cached(cache_key: str, payload: Dict) -> None:
    _NEWS_CACHE[cache_key] = {
        "created_at": time.time(),
        "payload": payload,
    }


def _get_cached_sentiment_payload(cache_key: str) -> Optional[Dict]:
    cached = _load_cached_json(_sentiment_cache_path(cache_key))
    if not cached:
        return None

    payload = cached.get("payload")
    ttl = _CACHE_TTL_SECONDS
    if not isinstance(payload, dict) or not payload.get("news_count"):
        ttl = _CACHE_TTL_SECONDS_EMPTY

    age_seconds = _cache_age_seconds(cached.get("created_at"))
    if age_seconds is None or age_seconds > ttl:
        try:
            _sentiment_cache_path(cache_key).unlink(missing_ok=True)
        except Exception:
            pass
        return None

    news_payload = cached.get("news_payload")
    if isinstance(news_payload, dict):
        _set_cached(cache_key, news_payload)

    payload = cached.get("payload")
    return payload if isinstance(payload, dict) else None


def _set_cached_sentiment_payload(cache_key: str, payload: Dict, news_payload: Dict) -> None:
    _write_cached_json(
        _sentiment_cache_path(cache_key),
        {
            "created_at": _utc_now().isoformat(),
            "payload": payload,
            "news_payload": news_payload,
        },
    )


def get_crypto_news(crypto: str, limit: int = 10, lang: str = "mixed") -> Dict:
    symbol, safe_limit, requested_language = _normalize_request_params(crypto, limit, lang)

    cache_key = _build_cache_key(symbol, safe_limit, requested_language)
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    coin_info = _coin_metadata(symbol)
    feeds = _build_feed_catalog(symbol, requested_language)
    collected_items: List[Dict] = []
    sources_used = []

    # Feeds são independentes: busca em paralelo e o tempo total vira o do
    # feed mais lento (<= timeout), em vez da soma sequencial de todos.
    max_workers = min(8, max(1, len(feeds)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        feed_results = list(pool.map(lambda f: _fetch_feed_items(f, coin_info["keywords"][0]), feeds))

    for feed, items in zip(feeds, feed_results):
        if not items:
            continue

        matching_items = [
            item for item in items
            if _news_matches_crypto(item, coin_info["keywords"])
        ]
        if not matching_items:
            continue

        sources_used.append(feed["source"])
        collected_items.extend(matching_items)

    scored_items = []
    for item in collected_items:
        item["score"] = round(
            _source_bonus(item.get("source", ""))
            + _recency_bonus(item.get("published_at"))
            + _keyword_bonus(item, coin_info["keywords"])
            + _language_bonus(item.get("language", ""), requested_language),
            2,
        )
        scored_items.append(item)

    deduped_items = _dedupe_news(scored_items)
    top_items = _sort_news(deduped_items)[:safe_limit]

    payload = {
        "crypto": symbol,
        "updated_at": _utc_now().isoformat(),
        "sources_used": list(dict.fromkeys(sources_used)),
        "news_items": [
            {
                "title": item.get("title"),
                "summary": item.get("summary"),
                "url": item.get("url"),
                "source": item.get("source"),
                "published_at": item.get("published_at"),
                "language": item.get("language"),
                "score": item.get("score"),
            }
            for item in top_items
        ],
    }
    _set_cached(cache_key, payload)
    return payload


def get_sentiment_analysis_payload(crypto: str, limit: int = 10, lang: str = "mixed") -> Dict:
    symbol, safe_limit, requested_language = _normalize_request_params(crypto, limit, lang)
    cache_key = _build_cache_key(symbol, safe_limit, requested_language)

    cached_payload = _get_cached_sentiment_payload(cache_key)
    if cached_payload is not None:
        return cached_payload

    news_payload = get_crypto_news(crypto=symbol, limit=safe_limit, lang=requested_language)
    news_items = news_payload.get("news_items", [])
    llm_sentiment = _compute_sentiment_with_llm(news_payload.get("crypto"), news_items)

    sentiment = _compute_sentiment(news_items)
    confidence = None
    rationale = None
    key_drivers: List[str] = []
    sentiment_method = "heuristic"

    if llm_sentiment:
        sentiment = llm_sentiment.get("sentiment", sentiment)
        confidence = llm_sentiment.get("confidence")
        rationale = llm_sentiment.get("answer")
        key_drivers = [
            _normalize_text(item)
            for item in llm_sentiment.get("key_drivers", [])
            if _normalize_text(item)
        ][:5]
        sentiment_method = "llm"

    payload = {
        "Sentiment": sentiment,
        "Top_news": [item.get("title") for item in news_items if item.get("title")],
        "crypto": news_payload.get("crypto"),
        "updated_at": news_payload.get("updated_at"),
        "sources_used": news_payload.get("sources_used", []),
        "news_count": len(news_items),
        "confidence": confidence,
        "rationale": rationale,
        "key_drivers": key_drivers,
        "sentiment_method": sentiment_method,
    }

    # Cacheia inclusive resultado vazio (TTL menor via _CACHE_TTL_SECONDS_EMPTY),
    # senão criptos sem manchetes (ex.: ADA) refazem fetch + LLM a cada request.
    _set_cached_sentiment_payload(cache_key, payload, news_payload)

    return payload
