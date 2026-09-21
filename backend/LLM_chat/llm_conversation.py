import os
import sys
import json
import ast

# Ensure the current directory is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.config.settings import load_settings
settings = load_settings()
from src.prompts.templates import (
    PROMPT_NEWS_SENTIMENT_ANALYSIS,
    prompt_asset_conversation,
)

from src.services.llm import make_llms
from API.chat_agent.llm_budget import invoke_llm

llm_chat = make_llms(settings)

_SENTIMENT_SYSTEM = (
    "Voce e um assistente especializado em analise de sentimento de mercado para criptomoedas. "
    "Retorne SOMENTE JSON valido."
)


def _to_payload(input_data: dict):
    return input_data if isinstance(input_data, dict) else ast.literal_eval(input_data)


def _parse_llm_json_response(response):
    if isinstance(response, dict):
        return response

    if isinstance(response, str):
        raw_response = response.strip()

        try:
            return json.loads(raw_response)
        except Exception:
            pass

        try:
            return ast.literal_eval(raw_response)
        except Exception:
            pass

        start = raw_response.find("{")
        end = raw_response.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw_response[start : end + 1])
            except Exception:
                pass

    raise ValueError(f"Resposta da LLM em formato inesperado: {type(response)}")


def LLM_chat_response(input: dict):
    data_dict = _to_payload(input)
    print("================================Input recebido no LLM_chat_response:", data_dict)
    history = data_dict.get("messages") or []
    user_input = history[-1]["content"] if history else ""
    prior = history[:-1] if history else []

    messages = [
        {
            "role": "system",
            "content": (
                "Voce e um assistente de investimentos. Use o contexto fornecido. "
                "Responda em portugues de forma objetiva."
            ),
        }
    ]
    context = data_dict.get("context")
    if context is not None:
        messages.append(
            {
                "role": "user",
                "content": f"Contexto do dashboard:\n{context}",
            }
        )
    for msg in prior:
        if isinstance(msg, dict) and msg.get("role") in {"user", "assistant"} and msg.get("content") is not None:
            messages.append({"role": msg["role"], "content": str(msg["content"])})
    messages.append({"role": "user", "content": str(user_input)})

    # Fallback to legacy template if history shape is unexpected
    if not user_input:
        llm_prompt_asset_conversation = prompt_asset_conversation.format(
            context=data_dict["context"],
            history=prior,
            user_input="",
        )
        return invoke_llm(llm_chat, llm_prompt_asset_conversation)

    return invoke_llm(llm_chat, messages)


def LLM_news_sentiment_response(input: dict):
    data_dict = _to_payload(input)
    print("================================Input recebido no LLM_news_sentiment_response:", data_dict)

    context = data_dict.get("context")
    # Keep template body as user content (includes formatting rules).
    user_content = PROMPT_NEWS_SENTIMENT_ANALYSIS.format(context=context)
    messages = [
        {"role": "system", "content": _SENTIMENT_SYSTEM},
        {"role": "user", "content": user_content},
    ]

    try:
        response = invoke_llm(
            llm_chat,
            messages,
            response_format={"type": "json_object"},
        )
    except Exception:
        response = invoke_llm(llm_chat, messages)

    parsed = _parse_llm_json_response(response)

    parsed["sentiment"] = str(parsed.get("sentiment", "middle")).strip().lower()
    if parsed["sentiment"] not in {"positive", "negative", "middle"}:
        parsed["sentiment"] = "middle"

    try:
        parsed["confidence"] = int(parsed.get("confidence", 0))
    except Exception:
        parsed["confidence"] = 0

    if not isinstance(parsed.get("key_drivers"), list):
        parsed["key_drivers"] = []

    parsed["answer"] = str(parsed.get("answer", "")).strip()
    return parsed
