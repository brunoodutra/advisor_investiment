from typing import Any, Callable, Optional

from API.chat_agent import memory
from API.chat_agent.orchestrator import run_orchestrator
from API.chat_agent.prompts import merge_message_histories
from API.chat_agent.schemas import ChatAgentResponse, ChatHints, ChatRequest, MissionStatus


def reset_session(session_id: str) -> None:
    memory.reset_session(session_id)


def chat_turn(
    request: ChatRequest,
    on_event: Optional[Callable[[dict], None]] = None,
) -> ChatAgentResponse:
    session = memory.load_session(request.sessionId)

    if session.get("turn_count", 0) >= session.get("max_turns", 8):
        blocked_msg = (
            "Limite de interacoes desta sessao foi atingido. "
            "Limpe o historico para iniciar uma nova conversa."
        )
        return ChatAgentResponse(
            content=blocked_msg,
            answer=blocked_msg,
            mission=MissionStatus(
                completed=bool(session.get("mission_completed")),
                reason=None,
                confidence=None,
            ),
            blocked=True,
            blocked_reason="turn_limit_reached",
            summary=session.get("summary"),
            tools_used=[],
            trace=[],
        )

    hints_model = request.hints or ChatHints()
    hints = hints_model.dict()
    allowed_tools = list(hints.get("allowed_tools") or [])

    request_messages = request.messages if isinstance(request.messages, list) else []
    messages = merge_message_histories(request_messages, session.get("messages_tail") or [])

    user_msgs = [m for m in messages if isinstance(m, dict) and m.get("role") == "user"]
    if user_msgs:
        memory.append_messages_tail(session, [user_msgs[-1]])

    response = run_orchestrator(
        messages=messages,
        hints=hints,
        context=request.context,
        allowed_tools=allowed_tools,
        session_summary=session.get("summary"),
        on_event=on_event,
    )

    session["turn_count"] = int(session.get("turn_count", 0)) + 1
    if response.summary:
        session["summary"] = response.summary
    if response.mission.completed:
        session["mission_completed"] = True

    if response.answer:
        memory.append_messages_tail(session, [{"role": "assistant", "content": response.answer}])

    memory.save_session(request.sessionId, session)
    return response
