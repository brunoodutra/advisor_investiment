"""Tests for the agentic chat module (stdlib unittest, LLM mocked)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from API.chat_agent import memory
from API.chat_agent.prompts import merge_message_histories
from API.chat_agent.schemas import ChatHints, ChatRequest
from API.chat_agent.service import chat_turn, reset_session
from API.chat_agent.tools import (
    execute_tool,
    get_chart_snapshot,
    get_market_context,
    get_openai_tools,
)
from LLM_chat.src.services.llm import ChatCompletionResult, ToolCall


class ChatAgentMemoryTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._sessions_dir = Path(self._tmpdir.name) / "sessions"
        memory._SESSIONS_DIR = self._sessions_dir

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_reset_clears_session(self):
        session_id = "sess_test_reset"
        memory.save_session(session_id, memory._default_session())
        self.assertTrue(memory._session_path(session_id).exists())
        reset_session(session_id)
        self.assertFalse(memory._session_path(session_id).exists())

    def test_turn_limit_blocks_before_llm(self):
        session_id = "sess_turn_limit"
        session = memory._default_session()
        session["turn_count"] = 8
        memory.save_session(session_id, session)

        request = ChatRequest(
            sessionId=session_id,
            messages=[{"role": "user", "content": "Qual a recomendacao?"}],
            hints=ChatHints(crypto="BTC", allowed_tools=["get_recommendation"]),
        )

        with patch("API.chat_agent.service.run_orchestrator") as mock_orch:
            response = chat_turn(request)
            mock_orch.assert_not_called()

        self.assertTrue(response.blocked)
        self.assertEqual(response.blocked_reason, "turn_limit_reached")

    def test_merges_disk_tail_when_request_shorter(self):
        session_id = "sess_merge"
        session = memory._default_session()
        session["messages_tail"] = [
            {"role": "user", "content": "primeira"},
            {"role": "assistant", "content": "ok"},
        ]
        memory.save_session(session_id, session)

        request = ChatRequest(
            sessionId=session_id,
            messages=[{"role": "user", "content": "segunda"}],
            hints=ChatHints(crypto="BTC", allowed_tools=["get_recommendation"]),
        )

        with patch("API.chat_agent.service.run_orchestrator") as mock_orch:
            mock_orch.return_value = MagicMock(
                answer="resp",
                summary=None,
                mission=MagicMock(completed=False),
            )
            # Make pydantic-like response
            from API.chat_agent.schemas import ChatAgentResponse, MissionStatus

            mock_orch.return_value = ChatAgentResponse(
                content="resp",
                answer="resp",
                mission=MissionStatus(),
                tools_used=[],
            )
            chat_turn(request)
            passed = mock_orch.call_args.kwargs["messages"]
            roles = [m["role"] for m in passed]
            self.assertIn("assistant", roles)
            self.assertEqual(passed[-1]["content"], "segunda")


class MergeHistoryTests(unittest.TestCase):
    def test_prefers_longer_request(self):
        req = [
            {"role": "user", "content": "a"},
            {"role": "assistant", "content": "b"},
            {"role": "user", "content": "c"},
        ]
        disk = [{"role": "user", "content": "old"}]
        self.assertEqual(merge_message_histories(req, disk), req)


class ChatAgentToolsTests(unittest.TestCase):
    def test_chart_snapshot_not_in_request(self):
        result = get_chart_snapshot(None)
        self.assertEqual(result.get("error"), "not_in_request")

    def test_market_context_reads_context(self):
        ctx = {"market": {"fearGreed": {"value": 62, "label": "Greed"}}}
        result = get_market_context(ctx)
        self.assertEqual(result["fearGreed"]["value"], 62)

    def test_tool_not_allowed(self):
        result = execute_tool(
            "get_recommendation",
            {"crypto": "BTC"},
            hints={"crypto": "BTC", "model": "CNN", "profile": "moderate"},
            context=None,
            allowed_tools=[],
        )
        self.assertEqual(result.get("error"), "tool_not_allowed")

    def test_get_openai_tools_filters_allow_list(self):
        tools = get_openai_tools(["get_recommendation"])
        names = [t["function"]["name"] for t in tools]
        self.assertIn("get_recommendation", names)
        self.assertIn("get_trade_bot_summary", names)
        self.assertNotIn("get_crypto_news", names)

    def test_list_latest_recommendations_filters_sell(self):
        from API.chat_agent import tools as tools_mod

        with patch.object(tools_mod, "get_recommendation") as mock_get:
            mock_get.side_effect = lambda crypto, model="CNN": {
                "crypto": crypto,
                "recommendation": "Sell" if crypto == "BTC" else "Hold",
                "Date": "2026-09-20",
                "Time": "12:00:00",
                "percentage": 0.5,
                "Price": 1.0,
            }
            result = tools_mod.list_latest_recommendations("CNN", signal="Sell")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["items"][0]["crypto"], "BTC")

    def test_normalize_crypto_typo(self):
        from API.chat_agent.tools import normalize_crypto

        self.assertEqual(normalize_crypto("biticooind"), "BTC")
        self.assertEqual(normalize_crypto("bitcoin"), "BTC")

    @patch("API.chat_agent.tools._api_setup")
    def test_get_recommendation_shape(self, mock_setup):
        mock_setup.return_value.get_last_recommendation.return_value = {
            "Date": "2026-01-01",
            "Time": "12:00:00",
            "recommendation": "Buy",
            "percentage": 0.82,
            "Price": 50000.0,
        }
        from API.chat_agent.tools import get_recommendation

        result = get_recommendation("BTC", "CNN")
        self.assertEqual(result["recommendation"], "Buy")
        self.assertEqual(result["crypto"], "BTC")


class ChatAgentOrchestratorTests(unittest.TestCase):
    @patch("API.chat_agent.orchestrator.complete_llm")
    @patch("API.chat_agent.orchestrator._get_llm_client")
    @patch("API.chat_agent.tools._api_setup")
    def test_orchestrator_native_tool_calls(self, mock_setup, mock_client, mock_complete):
        mock_client.return_value = MagicMock()
        mock_setup.return_value.get_last_recommendation.return_value = {
            "Date": "2026-01-01",
            "Time": "12:00:00",
            "recommendation": "Buy",
            "percentage": 0.82,
            "Price": 50000.0,
        }

        tool_round = ChatCompletionResult(
            content=None,
            tool_calls=[
                ToolCall(
                    id="call_1",
                    name="get_recommendation",
                    arguments={"crypto": "BTC"},
                )
            ],
            finish_reason="tool_calls",
            raw_message={
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "get_recommendation",
                            "arguments": '{"crypto":"BTC"}',
                        },
                    }
                ],
            },
        )
        final_round = ChatCompletionResult(
            content=json.dumps(
                {
                    "answer": "A recomendacao atual para BTC e Buy com 82% de confianca.",
                    "mission": {
                        "completed": True,
                        "reason": "Recomendacao informada",
                        "confidence": 85,
                    },
                    "summary": "BTC Buy",
                }
            ),
            tool_calls=[],
            finish_reason="stop",
            raw_message={
                "role": "assistant",
                "content": "A recomendacao atual para BTC e Buy com 82% de confianca.",
            },
        )
        mock_complete.side_effect = [tool_round, final_round]

        from API.chat_agent.orchestrator import run_orchestrator

        response = run_orchestrator(
            messages=[{"role": "user", "content": "Qual a recomendacao do BTC?"}],
            hints={
                "crypto": "BTC",
                "model": "CNN",
                "profile": "moderate",
                "allowed_tools": ["get_recommendation"],
            },
            context=None,
            allowed_tools=["get_recommendation"],
            session_summary=None,
        )

        self.assertIn("get_recommendation", response.tools_used)
        self.assertTrue(response.mission.completed)
        self.assertIn("Buy", response.answer)

        # Second complete call should include a role=tool message in history
        second_messages = mock_complete.call_args_list[1].args[1]
        tool_msgs = [m for m in second_messages if m.get("role") == "tool"]
        self.assertTrue(tool_msgs)
        self.assertEqual(tool_msgs[0].get("tool_call_id"), "call_1")


if __name__ == "__main__":
    unittest.main()
