import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from Trade_Bot.src.json_store import load_json, save_json
except Exception:
    load_json = None
    save_json = None

_API_DIR = Path(__file__).resolve().parent.parent
_SESSIONS_DIR = _API_DIR / "cache" / "chat_sessions"
_SESSION_TTL_SECONDS = 3600
_MAX_TURNS_DEFAULT = 8
_MESSAGES_TAIL_MAX = 12


def _safe_session_id(session_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(session_id or "").strip())
    return safe or "anonymous"


def _session_path(session_id: str) -> Path:
    return _SESSIONS_DIR / f"{_safe_session_id(session_id)}.json"


def _default_session() -> Dict[str, Any]:
    return {
        "turn_count": 0,
        "max_turns": _MAX_TURNS_DEFAULT,
        "mission_completed": False,
        "summary": None,
        "messages_tail": [],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _load_json_file(path: Path, default: dict) -> dict:
    if load_json:
        payload = load_json(path, default)
        return payload if isinstance(payload, dict) else default.copy()
    try:
        if not path.exists():
            return default.copy()
        import json

        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else default.copy()
    except Exception:
        return default.copy()


def _save_json_file(path: Path, data: dict) -> None:
    if save_json:
        save_json(path, data)
        return
    import json

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _session_expired(session: dict) -> bool:
    updated_at = session.get("updated_at")
    if not updated_at:
        return True
    try:
        normalized = str(updated_at).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()
        return age > _SESSION_TTL_SECONDS
    except Exception:
        return True


def load_session(session_id: str) -> Dict[str, Any]:
    path = _session_path(session_id)
    session = _load_json_file(path, _default_session())
    if _session_expired(session):
        session = _default_session()
    return session


def save_session(session_id: str, session: dict) -> None:
    session = dict(session)
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_json_file(_session_path(session_id), session)


def reset_session(session_id: str) -> None:
    path = _session_path(session_id)
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass


def append_messages_tail(session: dict, messages: List[dict]) -> None:
    tail = list(session.get("messages_tail") or [])
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content")
        if role and content is not None:
            tail.append({"role": role, "content": str(content)})
    session["messages_tail"] = tail[-_MESSAGES_TAIL_MAX:]
