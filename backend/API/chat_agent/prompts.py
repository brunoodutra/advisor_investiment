from typing import Any, Dict, List, Optional

SYSTEM_PROMPT = """Voce e um assistente de investimentos em criptomoedas integrado ao dashboard Advisor Investment.

Regras:
- Responda em portugues, de forma clara e objetiva.
- Use APENAS dados retornados pelas tools; nunca invente recomendacao, TP/SL, sentimento ou noticias.
- Se uma tool falhar ou nao estiver permitida, diga que o dado nao esta disponivel.
- A tool get_trade_bot_summary sempre esta disponivel quando relevante.
- Quando a pergunta for respondida com dados concretos das tools, indique isso no JSON final.
- Para perguntas sobre "recomendacoes de venda/compra" ou panorama de varios ativos, use list_latest_recommendations (com signal=Sell|Buy|Hold se aplicavel).
- Para historico de um ativo, use get_recommendation_history.
- Aceite nomes informais (bitcoin, ethereum, etc.) — as tools normalizam para o simbolo.

Hints do usuario: crypto={crypto}, model={model}, profile={profile}, page={page}

Resumo da sessao anterior: {session_summary}

Tools permitidas nesta sessao (via function calling): {allowed_tools}
"""

FINAL_JSON_INSTRUCTION = (
    "Responda SOMENTE um objeto JSON valido (sem markdown) no formato:\n"
    '{"answer":"...","mission":{"completed":false,"reason":null,"confidence":70},"summary":"..."}\n'
    "Use mission.completed=true apenas se respondeu com dados concretos das tools."
)

HISTORY_MAX_MESSAGES = 8
HISTORY_MAX_CHARS = 800


def build_system_prompt(
    *,
    allowed_tools: List[str],
    hints: Dict[str, Any],
    session_summary: Optional[str],
) -> str:
    return SYSTEM_PROMPT.format(
        allowed_tools=", ".join(allowed_tools) if allowed_tools else "(nenhuma tool extra)",
        crypto=hints.get("crypto") or "nao informado",
        model=hints.get("model") or "CNN",
        profile=hints.get("profile") or "moderate",
        page=hints.get("page") or "nao informado",
        session_summary=session_summary or "(nenhum)",
    )


def build_turn_prompt(user_message: str) -> str:
    return f"Pergunta atual do usuario:\n{user_message}"


def build_chat_messages(
    *,
    system: str,
    history: List[dict],
    user_message: str,
) -> List[Dict[str, str]]:
    """Monta messages no formato nativo OpenAI Chat Completions."""
    messages: List[Dict[str, str]] = [{"role": "system", "content": system}]

    for msg in (history or [])[-HISTORY_MAX_MESSAGES:]:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = str(msg.get("content") or "")[:HISTORY_MAX_CHARS].strip()
        if not content:
            continue
        messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": build_turn_prompt(user_message)})
    return messages


def merge_message_histories(
    request_messages: List[dict],
    disk_tail: List[dict],
) -> List[dict]:
    """Prefere o array do request se for mais completo; senao funde com o tail do disco."""
    req = [m for m in (request_messages or []) if isinstance(m, dict) and m.get("role") and m.get("content") is not None]
    disk = [m for m in (disk_tail or []) if isinstance(m, dict) and m.get("role") and m.get("content") is not None]

    if not disk:
        return req
    if not req:
        return disk
    if len(req) >= len(disk):
        return req

    merged: List[dict] = []
    seen = set()
    for msg in disk + req:
        role = str(msg.get("role"))
        content = str(msg.get("content"))
        key = (role, content)
        if key in seen:
            continue
        seen.add(key)
        merged.append({"role": role, "content": content})
    return merged
