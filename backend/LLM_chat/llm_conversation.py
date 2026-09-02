import os
import sys
import json, ast

# Ensure the current directory is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.config.settings import load_settings
settings = load_settings()
from src.prompts.templates import (
    prompt_asset_conversation,
    prompt_news_sentiment_analysis,
)

from src.services.llm import make_llms
from API.chat_agent.llm_budget import invoke_llm
llm_chat= make_llms(settings)

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

    raise ValueError(f"Resposta da LLM em formato inesperado: {type(response)}")


#TODO: add ascy option and error handling and logging to the function
def LLM_chat_response(input: dict):
    data_dict = _to_payload(input)
    print('================================Input recebido no LLM_chat_response:', data_dict)
    llm_prompt_asset_conversation = prompt_asset_conversation.format(
                                context=data_dict["context"], 
                                history=data_dict["messages"][:-1], 
                                user_input=data_dict["messages"][-1]["content"])
    response = invoke_llm(llm_chat, llm_prompt_asset_conversation)
    return response


def LLM_news_sentiment_response(input: dict):
    data_dict = _to_payload(input)
    print('================================Input recebido no LLM_news_sentiment_response:', data_dict)

    llm_prompt_news_sentiment = prompt_news_sentiment_analysis.format(
        context=data_dict["context"],
    )
    response = invoke_llm(llm_chat, llm_prompt_news_sentiment)
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
