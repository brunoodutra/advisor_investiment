"""Factory and message-normalization tests for the OpenAI-compatible LLM client."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from LLM_chat.src.services.llm import (
    DEEPINFRA_BASE_URL,
    GROQ_BASE_URL,
    OPENROUTER_BASE_URL,
    OpenAICompatLLMClient,
    make_llms,
    normalize_messages,
)


def _cfg(provider: str, model: str = "llama-3.1-8b-instant", **llm_extra):
    params = SimpleNamespace(
        temperature=0.5,
        max_new_tokens=1024,
        top_k=40,
        top_p=0.9,
        seed=42,
    )
    llm = SimpleNamespace(
        provider=provider,
        api_key="test-key",
        base_url=None,
        models=SimpleNamespace(chat=model),
        params=params,
        provider_params={"llama-3.1-8b": {"quantizations": ["bf16"]}},
        **llm_extra,
    )
    return SimpleNamespace(llm=llm)


class NormalizeMessagesTests(unittest.TestCase):
    def test_string_becomes_single_user_message(self):
        self.assertEqual(
            normalize_messages("Hello"),
            [{"role": "user", "content": "Hello"}],
        )

    def test_messages_list_preserved(self):
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
            {"role": "user", "content": "a recomendacao e de qual ativo ?"},
        ]
        self.assertEqual(normalize_messages(msgs), msgs)

    def test_tool_message_keeps_tool_call_id(self):
        msgs = [
            {"role": "tool", "tool_call_id": "abc", "name": "get_recommendation", "content": "{}"},
        ]
        out = normalize_messages(msgs)
        self.assertEqual(out[0]["tool_call_id"], "abc")
        self.assertEqual(out[0]["name"], "get_recommendation")

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            normalize_messages([])
        with self.assertRaises(ValueError):
            normalize_messages("   ")


class MakeLlmsTests(unittest.TestCase):
    def test_groq_uses_openai_compat_client(self):
        client = make_llms(_cfg("groq"))
        self.assertIsInstance(client, OpenAICompatLLMClient)
        self.assertEqual(client.base_url, GROQ_BASE_URL)
        self.assertTrue(client.fail_fast_on_rate_limit)
        self.assertEqual(client.extra_body, {})

    def test_openrouter_uses_openai_sdk_endpoint(self):
        client = make_llms(_cfg("openrouter", "meta-llama/llama-3.1-8b-instruct"))
        self.assertIsInstance(client, OpenAICompatLLMClient)
        self.assertEqual(client.base_url, OPENROUTER_BASE_URL)
        self.assertEqual(client.extra_headers["X-Title"], "advisor_investment")
        self.assertEqual(client.extra_body["top_k"], 40)
        self.assertEqual(client.extra_body["provider"]["quantizations"], ["bf16"])

    def test_openrouter_ignores_leftover_groq_base_url(self):
        cfg = _cfg("openrouter", "meta-llama/llama-3.1-8b-instruct")
        cfg.llm.base_url = GROQ_BASE_URL
        client = make_llms(cfg)
        self.assertEqual(client.base_url, OPENROUTER_BASE_URL)

    def test_deepinfra_uses_openai_compat_endpoint(self):
        client = make_llms(_cfg("deepinfra", "meta-llama/Meta-Llama-3.1-8B-Instruct"))
        self.assertIsInstance(client, OpenAICompatLLMClient)
        self.assertEqual(client.base_url, DEEPINFRA_BASE_URL)
        self.assertFalse(client.fail_fast_on_rate_limit)

    def test_deepinfra_ignores_leftover_openrouter_base_url(self):
        cfg = _cfg("deepinfra", "meta-llama/Meta-Llama-3.1-8B-Instruct")
        cfg.llm.base_url = OPENROUTER_BASE_URL
        client = make_llms(cfg)
        self.assertEqual(client.base_url, DEEPINFRA_BASE_URL)

    def test_ollama_rejected(self):
        with self.assertRaises(ValueError):
            make_llms(_cfg("ollama"))


if __name__ == "__main__":
    unittest.main()
