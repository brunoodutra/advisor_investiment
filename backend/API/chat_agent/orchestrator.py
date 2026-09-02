import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from API.chat_agent.llm_budget import invoke_llm
from API.chat_agent.prompts import build_system_prompt, build_turn_prompt
from API.chat_agent.schemas import ChatAgentResponse, MissionStatus
from API.chat_agent.tools import ALWAYS_ALLOWED_TOOLS, execute_tool

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 2
_llm_client = None


def _get_llm_client():
    global _llm_client
    if _llm_client is not None:
        return _llm_client
    from LLM_chat.src.config.settings import load_settings
    from LLM_chat.src.services.llm import make_llms

    settings = load_settings()
    _llm_client = make_llms(settings)
    return _llm_client


def _extract_json_object(text: str) -> Dict[str, Any]:
    raw = str(text or "").strip()
    if not raw:
        raise ValueError("empty_llm_response")

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = raw.find("{")
    if start == -1:
        raise ValueError("no_json_object_found")

    depth = 0
    for idx in range(start, len(raw)):
        char = raw[idx]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                block = raw[start : idx + 1]
                parsed = json.loads(block)
                if isinstance(parsed, dict):
                    return parsed
                raise ValueError("json_not_object")
    raise ValueError("unbalanced_json")


def _normalize_mission(raw: Optional[dict], tools_used: List[str]) -> MissionStatus:
    completed = False
    reason = None
    confidence = None
    if isinstance(raw, dict):
        completed = bool(raw.get("completed"))
        reason_val = raw.get("reason")
        reason = str(reason_val).strip() if reason_val else None
        conf = raw.get("confidence")
        if conf is not None:
            try:
                confidence = int(conf)
            except (TypeError, ValueError):
                confidence = None

    relevant_tools = [t for t in tools_used if t not in ALWAYS_ALLOWED_TOOLS]
    if completed and not relevant_tools:
        completed = False
        if not reason:
            reason = "Nenhuma ferramenta de dados foi utilizada nesta resposta."

    return MissionStatus(completed=completed, reason=reason, confidence=confidence)


def _heuristic_answer(tool_results: List[Tuple[str, dict]]) -> str:
    if not tool_results:
        return "Nao foi possivel obter uma resposta da IA no momento. Tente novamente em instantes."
    lines = ["Resumo com base nos dados disponiveis:"]
    for name, result in tool_results:
        if result.get("error"):
            lines.append(f"- {name}: indisponivel ({result.get('error')})")
            continue
        snippet = json.dumps(result, ensure_ascii=False)[:400]
        lines.append(f"- {name}: {snippet}")
    return "\n".join(lines)


def run_orchestrator(
    *,
    messages: List[dict],
    hints: Dict[str, Any],
    context: Optional[Dict[str, Any]],
    allowed_tools: List[str],
    session_summary: Optional[str],
) -> ChatAgentResponse:
    user_messages = [m for m in messages if m.get("role") == "user"]
    last_user = user_messages[-1]["content"] if user_messages else ""
    history = messages[:-1] if messages else []

    effective_allowed = list(allowed_tools or [])
    system = build_system_prompt(
        allowed_tools=effective_allowed + sorted(ALWAYS_ALLOWED_TOOLS),
        hints=hints,
        session_summary=session_summary,
        history=history,
    )

    try:
        llm = _get_llm_client()
    except Exception as exc:
        logger.warning("LLM client init failed: %s", exc)
        fallback = (
            "A IA não está configurada neste ambiente (chave/provedor ausente ou config.yaml não encontrado). "
            "Defina GROQ_API_KEY ou OPENROUTER_API_KEY e reinicie a API."
        )
        return ChatAgentResponse(
            content=fallback,
            answer=fallback,
            mission=MissionStatus(),
            blocked=True,
            blocked_reason="llm_unavailable",
            summary=None,
            tools_used=[],
        )
    tools_used: List[str] = []
    tool_results: List[Tuple[str, dict]] = []
    conversation = f"{system}\n\n{build_turn_prompt(last_user)}"

    llm_failed = False
    blocked_reason = None

    for round_idx in range(MAX_TOOL_ROUNDS + 1):
        try:
            raw_response = invoke_llm(llm, conversation)
            parsed = _extract_json_object(raw_response)
        except Exception as exc:
            logger.warning("LLM invoke/parse failed on round %s: %s", round_idx, exc)
            llm_failed = True
            msg = str(exc).lower()
            if "429" in msg or "rate limit" in msg or "ratelimit" in msg:
                blocked_reason = "llm_unavailable"
            break

        if "final" in parsed and isinstance(parsed["final"], dict):
            final = parsed["final"]
            answer = str(final.get("answer") or "").strip()
            summary = final.get("summary")
            summary_str = str(summary).strip() if summary else None
            mission = _normalize_mission(final.get("mission"), tools_used)
            if not answer:
                answer = _heuristic_answer(tool_results)
            return ChatAgentResponse(
                content=answer,
                answer=answer,
                mission=mission,
                blocked=False,
                blocked_reason=None,
                summary=summary_str,
                tools_used=tools_used,
            )

        tool_calls = parsed.get("tool_calls") or []
        if not isinstance(tool_calls, list) or not tool_calls:
            answer = str(parsed.get("answer") or parsed.get("thought") or "").strip()
            if not answer:
                answer = _heuristic_answer(tool_results)
            return ChatAgentResponse(
                content=answer,
                answer=answer,
                mission=MissionStatus(),
                blocked=False,
                blocked_reason=None,
                summary=None,
                tools_used=tools_used,
            )

        if round_idx >= MAX_TOOL_ROUNDS:
            break

        round_outputs = []
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            name = call.get("name")
            if not name:
                continue
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            result = execute_tool(
                name,
                args,
                hints=hints,
                context=context,
                allowed_tools=effective_allowed,
            )
            if name not in tools_used:
                tools_used.append(name)
            tool_results.append((name, result))
            round_outputs.append(
                f'Tool "{name}" args={json.dumps(args, ensure_ascii=False)} result={json.dumps(result, ensure_ascii=False)}'
            )

        conversation = (
            f"{system}\n\n{build_turn_prompt(last_user)}\n\n"
            f"Resultados das tools (rodada {round_idx + 1}):\n"
            + "\n".join(round_outputs)
            + "\n\nAgora responda com JSON final (chave final) ou chame mais tools se necessario."
        )

    answer = _heuristic_answer(tool_results)
    return ChatAgentResponse(
        content=answer,
        answer=answer,
        mission=MissionStatus(),
        blocked=False,
        blocked_reason=blocked_reason if not tool_results else None,
        summary=None,
        tools_used=tools_used,
    )
