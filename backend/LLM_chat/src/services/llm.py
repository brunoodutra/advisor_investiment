from dataclasses import dataclass, field
import json
import logging
import random
import time
from typing import Any, Dict, List, Optional, Sequence, Union

logger = logging.getLogger(__name__)

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai"

ChatMessage = Dict[str, Any]
MessagesInput = Union[str, Sequence[Dict[str, Any]]]


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass
class ChatCompletionResult:
    content: Optional[str]
    tool_calls: List[ToolCall]
    finish_reason: Optional[str]
    raw_message: Dict[str, Any]


def _estimate_tokens(text: Any) -> int:
    if text is None:
        return 0
    if isinstance(text, (list, tuple)):
        text = " ".join(
            str(item.get("content", item) if isinstance(item, dict) else item)
            for item in text
        )
    elif not isinstance(text, str):
        text = str(text)
    if not text:
        return 0
    words = len(text.split())
    by_words = int(words * 1.3)
    by_chars = int(len(text) / 4)
    return max(1, max(by_words, by_chars))


def _is_rate_limit(exc: Exception) -> bool:
    try:
        from openai import RateLimitError

        if isinstance(exc, RateLimitError):
            return True
    except Exception:
        pass
    msg = str(exc).lower()
    return "429" in msg or "rate limit" in msg or "ratelimit" in msg


def _is_auth_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "401" in msg or "invalid api key" in msg or "403" in msg


def _is_unsupported_response_format(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "response_format" in msg or "json_object" in msg or "unsupported" in msg


def _provider_prefs_for_model(provider_params: Dict[str, Any], model: str) -> Optional[dict]:
    if not provider_params:
        return None
    if model in provider_params:
        return provider_params[model]
    model_lower = model.lower()
    for key, value in provider_params.items():
        if str(key).lower() in model_lower:
            return value
    return None


def _resolve_base_url(provider: str, configured: Optional[str]) -> str:
    configured = (configured or "").strip()
    defaults = {
        "groq": GROQ_BASE_URL,
        "openrouter": OPENROUTER_BASE_URL,
        "deepinfra": DEEPINFRA_BASE_URL,
    }
    default = defaults[provider]
    if not configured:
        return default
    markers = {
        "groq": ("groq.com",),
        "openrouter": ("openrouter.ai",),
        "deepinfra": ("deepinfra.com",),
    }
    if any(marker in configured for marker in markers[provider]):
        return configured
    logger.warning(
        "base_url %r nao combina com provider %r; usando %s",
        configured,
        provider,
        default,
    )
    return default


def _parse_tool_arguments(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if raw is None:
        return {}
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def normalize_messages(messages: MessagesInput) -> List[ChatMessage]:
    """Normalize invoke input to OpenAI Chat Completions messages."""
    if isinstance(messages, str):
        content = messages.strip()
        if not content:
            raise ValueError("prompt_vazio")
        return [{"role": "user", "content": content}]

    if not isinstance(messages, Sequence) or isinstance(messages, (bytes, bytearray)):
        raise TypeError("messages deve ser str ou lista de {role, content}")

    normalized: List[ChatMessage] = []
    allowed_roles = {"system", "user", "assistant", "tool"}
    for idx, item in enumerate(messages):
        if not isinstance(item, dict):
            raise TypeError(f"messages[{idx}] deve ser dict")
        role = str(item.get("role") or "").strip().lower()
        if role not in allowed_roles:
            raise ValueError(f"messages[{idx}].role invalido: {role!r}")

        msg: ChatMessage = {"role": role}

        if role == "assistant" and item.get("tool_calls"):
            msg["content"] = item.get("content")
            msg["tool_calls"] = item["tool_calls"]
        elif role == "tool":
            content = item.get("content")
            if content is None:
                raise ValueError(f"messages[{idx}].content ausente")
            msg["content"] = content if isinstance(content, str) else str(content)
            tool_call_id = item.get("tool_call_id") or item.get("toolCallId")
            if not tool_call_id:
                raise ValueError(f"messages[{idx}].tool_call_id ausente")
            msg["tool_call_id"] = str(tool_call_id)
            if item.get("name"):
                msg["name"] = str(item["name"])
        else:
            content = item.get("content")
            if content is None:
                raise ValueError(f"messages[{idx}].content ausente")
            msg["content"] = content if isinstance(content, str) else str(content)

        normalized.append(msg)

    if not normalized:
        raise ValueError("messages_vazio")
    return normalized


def _message_to_raw_dict(message: Any) -> Dict[str, Any]:
    raw: Dict[str, Any] = {
        "role": getattr(message, "role", "assistant"),
        "content": getattr(message, "content", None),
    }
    tool_calls = getattr(message, "tool_calls", None) or []
    if tool_calls:
        serialized = []
        for tc in tool_calls:
            fn = getattr(tc, "function", None)
            serialized.append(
                {
                    "id": getattr(tc, "id", ""),
                    "type": getattr(tc, "type", "function") or "function",
                    "function": {
                        "name": getattr(fn, "name", "") if fn else "",
                        "arguments": getattr(fn, "arguments", "{}") if fn else "{}",
                    },
                }
            )
        raw["tool_calls"] = serialized
    return raw


def _extract_tool_calls(message: Any) -> List[ToolCall]:
    out: List[ToolCall] = []
    for tc in getattr(message, "tool_calls", None) or []:
        fn = getattr(tc, "function", None)
        name = getattr(fn, "name", "") if fn else ""
        args_raw = getattr(fn, "arguments", "{}") if fn else "{}"
        out.append(
            ToolCall(
                id=str(getattr(tc, "id", "") or ""),
                name=str(name or ""),
                arguments=_parse_tool_arguments(args_raw),
            )
        )
    return out


@dataclass
class OpenAICompatLLMClient:
    """Chat Completions via SDK da OpenAI (Groq e OpenRouter são compatíveis)."""

    api_key: str
    model: str
    base_url: str
    temperature: float = 0.0
    max_new_tokens: int = 8192
    top_p: float = 0.95
    seed: int = 42
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    retries: int = 3
    timeout: float = 60.0
    extra_headers: Dict[str, str] = field(default_factory=dict)
    extra_body: Dict[str, Any] = field(default_factory=dict)
    fail_fast_on_rate_limit: bool = False
    _client: Any = field(default=None, init=False, repr=False)

    def _get_client(self):
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=0,
            )
        return self._client

    def complete(
        self,
        messages: MessagesInput,
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Any = None,
        response_format: dict | None = None,
        **kwargs,
    ) -> ChatCompletionResult:
        normalized = normalize_messages(messages)
        total_chars = sum(len(str(m.get("content") or "")) for m in normalized)

        logger.debug(
            "Prompt tokens(est.): %d | msgs: %d | chars: %d | model: %s | tools: %s",
            _estimate_tokens(normalized),
            len(normalized),
            total_chars,
            self.model,
            bool(tools),
        )

        client = self._get_client()
        create_kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": normalized,
            "temperature": self.temperature,
            "top_p": self.top_p,
            "max_tokens": self.max_new_tokens,
            "seed": self.seed,
        }
        if self.frequency_penalty:
            create_kwargs["frequency_penalty"] = self.frequency_penalty
        if self.presence_penalty:
            create_kwargs["presence_penalty"] = self.presence_penalty
        if tools:
            create_kwargs["tools"] = tools
            if tool_choice is not None:
                create_kwargs["tool_choice"] = tool_choice
        if response_format:
            create_kwargs["response_format"] = response_format
        if self.extra_headers:
            create_kwargs["extra_headers"] = self.extra_headers
        if self.extra_body:
            create_kwargs["extra_body"] = self.extra_body

        last_error: Exception | None = None
        attempts_total = max(1, self.retries)
        used_response_format = bool(response_format)

        for attempt in range(attempts_total):
            try:
                response = client.chat.completions.create(**create_kwargs)
                choice = response.choices[0] if response.choices else None
                if choice is None or choice.message is None:
                    return ChatCompletionResult(
                        content="",
                        tool_calls=[],
                        finish_reason=None,
                        raw_message={"role": "assistant", "content": ""},
                    )
                message = choice.message
                return ChatCompletionResult(
                    content=message.content,
                    tool_calls=_extract_tool_calls(message),
                    finish_reason=getattr(choice, "finish_reason", None),
                    raw_message=_message_to_raw_dict(message),
                )
            except Exception as exc:
                last_error = exc
                if used_response_format and _is_unsupported_response_format(exc):
                    logger.warning(
                        "response_format nao suportado pelo modelo; retry sem ele | model=%s",
                        self.model,
                    )
                    create_kwargs.pop("response_format", None)
                    used_response_format = False
                    continue
                if _is_auth_error(exc):
                    raise RuntimeError(str(exc)) from exc
                if _is_rate_limit(exc):
                    if self.fail_fast_on_rate_limit or attempt == attempts_total - 1:
                        logger.warning("Rate limit na API. model=%s err=%s", self.model, exc)
                        raise RuntimeError(str(exc)) from exc
                    delay = 60.0
                else:
                    delay = min((2 ** attempt) + random.uniform(0, 1), 5.0)

                logger.warning(
                    "Erro na chamada LLM. Retrying in %.2fs | attempt %d/%d | model: %s | err: %s",
                    delay,
                    attempt + 1,
                    attempts_total,
                    self.model,
                    exc,
                )
                time.sleep(delay)

        raise RuntimeError(str(last_error))

    def invoke(
        self,
        messages: MessagesInput,
        response_format: dict | None = None,
        **kwargs,
    ) -> str:
        """Compat: retorna apenas o content textual."""
        result = self.complete(messages, response_format=response_format, **kwargs)
        return result.content or ""


def make_llms(cfg):
    provider = str(getattr(cfg.llm, "provider", "") or "").strip().lower()
    params = cfg.llm.params
    model = cfg.llm.models.chat
    api_key = (getattr(cfg.llm, "api_key", None) or "").strip()
    if not api_key:
        raise ValueError(
            f"API key ausente para provider {provider!r}. "
            "Defina GROQ_API_KEY, OPENROUTER_API_KEY ou DEEPINFRA_API_KEY no ambiente."
        )

    if provider == "groq":
        return OpenAICompatLLMClient(
            api_key=api_key,
            model=model,
            base_url=_resolve_base_url(provider, getattr(cfg.llm, "base_url", None)),
            temperature=params.temperature,
            max_new_tokens=params.max_new_tokens,
            top_p=params.top_p,
            seed=params.seed,
            retries=3,
            fail_fast_on_rate_limit=True,
        )

    if provider == "openrouter":
        provider_prefs = _provider_prefs_for_model(
            getattr(cfg.llm, "provider_params", None) or {},
            model,
        )
        extra_body: Dict[str, Any] = {}
        if getattr(params, "top_k", None) is not None:
            extra_body["top_k"] = params.top_k
        if provider_prefs:
            extra_body["provider"] = provider_prefs
            if provider_prefs.get("quantizations"):
                logger.warning(
                    "[CONFIG] Quantizacao aplicada para modelo '%s': %s",
                    model,
                    provider_prefs.get("quantizations"),
                )

        return OpenAICompatLLMClient(
            api_key=api_key,
            model=model,
            base_url=_resolve_base_url(provider, getattr(cfg.llm, "base_url", None)),
            temperature=params.temperature,
            max_new_tokens=params.max_new_tokens,
            top_p=params.top_p,
            seed=params.seed,
            retries=2,
            extra_headers={
                "HTTP-Referer": "http://localhost",
                "X-Title": "advisor_investment",
            },
            extra_body=extra_body,
            fail_fast_on_rate_limit=False,
        )

    if provider == "deepinfra":
        # OpenAI-compatible: https://api.deepinfra.com/v1/openai
        extra_body = {}
        if getattr(params, "top_k", None) is not None:
            # DeepInfra may ignore top_k on some models; harmless if unsupported
            extra_body["top_k"] = params.top_k

        return OpenAICompatLLMClient(
            api_key=api_key,
            model=model,
            base_url=_resolve_base_url(provider, getattr(cfg.llm, "base_url", None)),
            temperature=params.temperature,
            max_new_tokens=params.max_new_tokens,
            top_p=params.top_p,
            seed=params.seed,
            retries=3,
            extra_body=extra_body,
            fail_fast_on_rate_limit=False,
        )

    raise ValueError(
        f"Provedor LLM nao suportado: {cfg.llm.provider!r}. "
        "Use 'groq', 'openrouter' ou 'deepinfra'."
    )
