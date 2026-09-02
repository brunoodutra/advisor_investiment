from typing import Any, Dict, List, Optional

SYSTEM_PROMPT = """Voce e um assistente de investimentos em criptomoedas integrado ao dashboard Advisor Investment.

Regras:
- Responda em portugues, de forma clara e objetiva.
- Use APENAS dados retornados pelas tools; nunca invente recomendacao, TP/SL, sentimento ou noticias.
- Se uma tool falhar ou nao estiver permitida, diga que o dado nao esta disponivel.
- A tool get_trade_bot_summary sempre esta disponivel quando relevante.
- Marque mission.completed=true somente quando a pergunta do usuario foi respondida com dados concretos das tools.

Tools permitidas nesta sessao: {allowed_tools}

Hints do usuario: crypto={crypto}, model={model}, profile={profile}, page={page}

Resumo da sessao anterior: {session_summary}

Historico recente:
{history}

Protocolo JSON (retorne SOMENTE um objeto JSON valido, sem markdown):
- Para chamar tools: {{"thought":"...","tool_calls":[{{"name":"nome_da_tool","args":{{...}}}}]}}
- Para resposta final: {{"thought":"...","final":{{"answer":"...","mission":{{"completed":false,"reason":null,"confidence":70}},"summary":"..."}}}}

Tools disponiveis e argumentos:
- get_recommendation: crypto (obrigatorio), model (opcional, default CNN)
- get_target_stop: crypto (obrigatorio), profile (opcional), model (opcional)
- get_crypto_news_sentiment: crypto (obrigatorio)
- get_crypto_news: crypto (obrigatorio), limit (opcional, max 5)
- get_trade_bot_summary: sem argumentos
- get_chart_snapshot: sem argumentos (usa contexto do front)
- get_market_context: sem argumentos (usa contexto do front)
"""


def build_system_prompt(
    *,
    allowed_tools: List[str],
    hints: Dict[str, Any],
    session_summary: Optional[str],
    history: List[dict],
) -> str:
    history_lines = []
    for msg in history[-8:]:
        role = msg.get("role", "user")
        content = str(msg.get("content", ""))[:800]
        history_lines.append(f"{role}: {content}")
    history_text = "\n".join(history_lines) if history_lines else "(sem historico)"

    return SYSTEM_PROMPT.format(
        allowed_tools=", ".join(allowed_tools) if allowed_tools else "(nenhuma tool extra)",
        crypto=hints.get("crypto") or "nao informado",
        model=hints.get("model") or "CNN",
        profile=hints.get("profile") or "moderate",
        page=hints.get("page") or "nao informado",
        session_summary=session_summary or "(nenhum)",
        history=history_text,
    )


def build_turn_prompt(user_message: str) -> str:
    return f"Pergunta atual do usuario:\n{user_message}\n\nResponda com JSON conforme o protocolo."
