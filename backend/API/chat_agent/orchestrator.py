import hashlib
import json
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from API.chat_agent.llm_budget import complete_llm
from API.chat_agent.prompts import (
    FINAL_JSON_INSTRUCTION,
    build_chat_messages,
    build_system_prompt,
)
from API.chat_agent.schemas import ChatAgentResponse, MissionStatus, TraceStep
from API.chat_agent.tools import ALWAYS_ALLOWED_TOOLS, execute_tool, get_openai_tools

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 2
_llm_client = None
_llm_fingerprint: Optional[str] = None

EventCallback = Optional[Callable[[Dict[str, Any]], None]]


def _settings_fingerprint(settings: Any) -> str:
    llm = settings.llm
    raw = "|".join(
        [
            str(getattr(llm, "provider", "")),
            str(getattr(getattr(llm, "models", None), "chat", "")),
            str(getattr(llm, "base_url", "") or ""),
            hashlib.sha256(str(getattr(llm, "api_key", "") or "").encode("utf-8")).hexdigest()[:16],
        ]
    )
    return raw


def reload_llm_client() -> Dict[str, str]:
    """Force reload of the cached LLM client from config/env."""
    global _llm_client, _llm_fingerprint
    from LLM_chat.src.config.settings import load_settings
    from LLM_chat.src.services.llm import make_llms

    settings = load_settings()
    _llm_client = make_llms(settings)
    _llm_fingerprint = _settings_fingerprint(settings)
    return {
        "provider": str(settings.llm.provider),
        "model": str(settings.llm.models.chat),
        "base_url": str(settings.llm.base_url or ""),
    }


def _get_llm_client():
    global _llm_client, _llm_fingerprint
    from LLM_chat.src.config.settings import load_settings
    from LLM_chat.src.services.llm import make_llms

    settings = load_settings()
    fingerprint = _settings_fingerprint(settings)
    if _llm_client is None or fingerprint != _llm_fingerprint:
        _llm_client = make_llms(settings)
        _llm_fingerprint = fingerprint
    return _llm_client


def _emit(on_event: EventCallback, payload: Dict[str, Any]) -> None:
    if not on_event:
        return
    try:
        on_event(payload)
    except Exception as exc:
        logger.debug("on_event failed: %s", exc)


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


def _heuristic_mission(tools_used: List[str], answer: str) -> MissionStatus:
    relevant = [t for t in tools_used if t not in ALWAYS_ALLOWED_TOOLS]
    if relevant and answer.strip():
        return MissionStatus(
            completed=True,
            reason="Resposta baseada em dados das tools.",
            confidence=70,
        )
    return MissionStatus(completed=False, reason=None, confidence=None)


def _heuristic_answer(
    tool_results: List[Tuple[str, dict]],
    *,
    llm_error: Optional[str] = None,
) -> str:
    if tool_results:
        lines = ["Resumo com base nos dados disponiveis:"]
        for name, result in tool_results:
            if result.get("error"):
                lines.append(f"- {name}: indisponivel ({result.get('error')})")
                continue
            snippet = json.dumps(result, ensure_ascii=False)[:400]
            lines.append(f"- {name}: {snippet}")
        return "\n".join(lines)

    if llm_error:
        return (
            "Nao foi possivel obter uma resposta da IA no momento "
            f"(erro: {llm_error}). Tente novamente em instantes."
        )
    return "Nao foi possivel obter uma resposta da IA no momento. Tente novamente em instantes."


def _parse_final_payload(
    content: Optional[str],
    tools_used: List[str],
    tool_results: List[Tuple[str, dict]],
    trace: List[TraceStep],
) -> ChatAgentResponse:
    text = (content or "").strip()
    summary_str = None
    mission = MissionStatus()
    answer = text

    if text:
        try:
            parsed = _extract_json_object(text)
            if isinstance(parsed.get("answer"), str) and parsed.get("answer").strip():
                answer = parsed["answer"].strip()
            summary = parsed.get("summary")
            summary_str = str(summary).strip() if summary else None
            mission = _normalize_mission(parsed.get("mission"), tools_used)
        except Exception:
            answer = text
            mission = _heuristic_mission(tools_used, answer)

    if not answer:
        answer = _heuristic_answer(tool_results)
        if not mission.completed:
            mission = _heuristic_mission(tools_used, answer)

    return ChatAgentResponse(
        content=answer,
        answer=answer,
        mission=mission,
        blocked=False,
        blocked_reason=None,
        summary=summary_str,
        tools_used=tools_used,
        trace=trace,
    )


def run_orchestrator(
    *,
    messages: List[dict],
    hints: Dict[str, Any],
    context: Optional[Dict[str, Any]],
    allowed_tools: List[str],
    session_summary: Optional[str],
    on_event: EventCallback = None,
) -> ChatAgentResponse:
    user_messages = [m for m in messages if m.get("role") == "user"]
    last_user = user_messages[-1]["content"] if user_messages else ""
    history = messages[:-1] if messages else []

    effective_allowed = list(allowed_tools or [])
    openai_tools = get_openai_tools(effective_allowed)
    system = build_system_prompt(
        allowed_tools=[t["function"]["name"] for t in openai_tools],
        hints=hints,
        session_summary=session_summary,
    )

    tools_used: List[str] = []
    tool_results: List[Tuple[str, dict]] = []
    trace: List[TraceStep] = []

    def push_trace(**kwargs: Any) -> TraceStep:
        step = TraceStep(**kwargs)
        trace.append(step)
        _emit(
            on_event,
            {
                "type": "trace",
                "step": step.step,
                "detail": step.detail,
                "tool": step.tool,
                "args": step.args,
                "ok": step.ok,
                "error": step.error,
                "tools_used": list(tools_used),
            },
        )
        return step

    try:
        llm = _get_llm_client()
    except Exception as exc:
        logger.warning("LLM client init failed: %s", exc)
        fallback = (
            "A IA não está configurada neste ambiente (chave/provedor ausente ou config.yaml não encontrado). "
            "Defina GROQ_API_KEY, OPENROUTER_API_KEY ou DEEPINFRA_API_KEY e reinicie a API."
        )
        return ChatAgentResponse(
            content=fallback,
            answer=fallback,
            mission=MissionStatus(),
            blocked=True,
            blocked_reason="llm_unavailable",
            summary=None,
            tools_used=[],
            trace=[TraceStep(step="error", detail=str(exc), ok=False)],
        )

    chat_messages: List[Dict[str, Any]] = build_chat_messages(
        system=system,
        history=history,
        user_message=last_user,
    )

    blocked_reason = None
    llm_error: Optional[str] = None

    push_trace(step="start", detail="Iniciando consulta a LLM")

    for round_idx in range(MAX_TOOL_ROUNDS + 1):
        want_tools = bool(openai_tools) and round_idx < MAX_TOOL_ROUNDS
        try:
            if want_tools:
                push_trace(
                    step="llm_planning",
                    detail=f"Rodada {round_idx + 1}: decidindo tools",
                )
                result = complete_llm(
                    llm,
                    chat_messages,
                    tools=openai_tools,
                    tool_choice="auto",
                )
            else:
                push_trace(step="llm_final", detail="Gerando resposta final JSON")
                final_messages = list(chat_messages)
                final_messages.append({"role": "user", "content": FINAL_JSON_INSTRUCTION})
                result = complete_llm(
                    llm,
                    final_messages,
                    response_format={"type": "json_object"},
                )
        except Exception as exc:
            logger.warning("LLM complete failed on round %s: %s", round_idx, exc)
            llm_error = str(exc)[:200]
            push_trace(step="llm_error", detail=llm_error, ok=False, error=llm_error)
            msg = str(exc).lower()
            if "429" in msg or "rate limit" in msg or "ratelimit" in msg:
                blocked_reason = "llm_unavailable"
            elif "401" in msg or "invalid api key" in msg:
                blocked_reason = "llm_unavailable"
            else:
                blocked_reason = blocked_reason or "llm_error"
            break

        if result.tool_calls and want_tools:
            chat_messages.append(result.raw_message)
            for call in result.tool_calls:
                name = call.name
                if not name:
                    continue
                push_trace(
                    step="tool_call",
                    tool=name,
                    args=call.arguments,
                    detail=f"Chamando {name}",
                )
                tool_result = execute_tool(
                    name,
                    call.arguments,
                    hints=hints,
                    context=context,
                    allowed_tools=effective_allowed,
                )
                ok = not bool(tool_result.get("error"))
                push_trace(
                    step="tool_result",
                    tool=name,
                    args=call.arguments,
                    ok=ok,
                    error=str(tool_result.get("error")) if tool_result.get("error") else None,
                    detail=f"{name}: {'ok' if ok else tool_result.get('error')}",
                )
                if name not in tools_used:
                    tools_used.append(name)
                tool_results.append((name, tool_result))
                chat_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "name": name,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    }
                )
            continue

        # Model stopped calling tools: ensure structured final JSON when needed.
        if want_tools:
            already_structured = False
            if result.content:
                try:
                    parsed = _extract_json_object(result.content)
                    already_structured = isinstance(parsed.get("answer"), str) and bool(
                        parsed.get("answer").strip()
                    )
                except Exception:
                    already_structured = False
            if not already_structured:
                try:
                    push_trace(step="llm_final", detail="Formatando resposta final")
                    final_messages = list(chat_messages)
                    if result.content:
                        final_messages.append(
                            {
                                "role": "assistant",
                                "content": result.content,
                            }
                        )
                    final_messages.append({"role": "user", "content": FINAL_JSON_INSTRUCTION})
                    result = complete_llm(
                        llm,
                        final_messages,
                        response_format={"type": "json_object"},
                    )
                except Exception as exc:
                    logger.warning("LLM final JSON turn failed: %s", exc)
                    llm_error = str(exc)[:200]
                    push_trace(step="llm_error", detail=llm_error, ok=False, error=llm_error)

        response = _parse_final_payload(result.content, tools_used, tool_results, trace)
        push_trace(step="done", detail="Resposta pronta", ok=True)
        _emit(
            on_event,
            {
                "type": "final",
                "payload": response.dict(),
            },
        )
        return response

    answer = _heuristic_answer(tool_results, llm_error=llm_error)
    response = ChatAgentResponse(
        content=answer,
        answer=answer,
        mission=_heuristic_mission(tools_used, answer),
        blocked=bool(blocked_reason) and not tool_results,
        blocked_reason=blocked_reason if not tool_results else None,
        summary=None,
        tools_used=tools_used,
        trace=trace,
    )
    push_trace(step="done", detail="Fallback heuristico", ok=False)
    _emit(on_event, {"type": "final", "payload": response.dict()})
    return response
