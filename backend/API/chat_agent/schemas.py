from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatHints(BaseModel):
    crypto: Optional[str] = None
    model: str = "CNN"
    profile: str = "moderate"
    page: Optional[str] = None
    allowed_tools: List[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    sessionId: str
    messages: List[Dict[str, Any]]
    hints: Optional[ChatHints] = None
    context: Optional[Dict[str, Any]] = None
    highlights: Optional[List[Any]] = Field(default_factory=list)


class ChatResetRequest(BaseModel):
    sessionId: str


class ChatResetResponse(BaseModel):
    status: str = "ok"


class ChatReloadLLMResponse(BaseModel):
    status: str = "ok"
    provider: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


class MissionStatus(BaseModel):
    completed: bool = False
    reason: Optional[str] = None
    confidence: Optional[int] = None


class TraceStep(BaseModel):
    step: str
    detail: Optional[str] = None
    tool: Optional[str] = None
    args: Optional[Dict[str, Any]] = None
    ok: Optional[bool] = None
    error: Optional[str] = None


class ChatAgentResponse(BaseModel):
    content: str
    answer: str
    mission: MissionStatus
    blocked: bool = False
    blocked_reason: Optional[str] = None
    summary: Optional[str] = None
    tools_used: List[str] = Field(default_factory=list)
    trace: List[TraceStep] = Field(default_factory=list)
