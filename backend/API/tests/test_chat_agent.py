"""Tests for the agentic chat module (stdlib unittest, LLM mocked)."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from API.chat_agent import memory
from API.chat_agent.schemas import ChatHints, ChatRequest
from API.chat_agent.service import chat_turn, reset_session
from API.chat_agent.tools import execute_tool, get_chart_snapshot, get_market_context


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
    @patch("API.chat_agent.orchestrator.invoke_llm")
    @patch("API.chat_agent.orchestrator._get_llm_client")
    @patch("API.chat_agent.tools._api_setup")
    def test_orchestrator_records_tools_used(self, mock_setup, mock_client, mock_invoke):
        mock_client.return_value = MagicMock()
        mock_setup.return_value.get_last_recommendation.return_value = {
            "Date": "2026-01-01",
            "Time": "12:00:00",
            "recommendation": "Buy",
            "percentage": 0.82,
            "Price": 50000.0,
        }

        plan = json.dumps(
            {
                "thought": "preciso da reco",
                "tool_calls": [{"name": "get_recommendation", "args": {"crypto": "BTC"}}],
            }
        )
        final = json.dumps(
            {
                "thought": "respondendo",
                "final": {
                    "answer": "A recomendacao atual para BTC e Buy com 82% de confianca.",
                    "mission": {"completed": True, "reason": "Recomendacao informada", "confidence": 85},
                    "summary": "BTC Buy",
                },
            }
        )
        mock_invoke.side_effect = [plan, final]

        from API.chat_agent.orchestrator import run_orchestrator

        response = run_orchestrator(
            messages=[{"role": "user", "content": "Qual a recomendacao do BTC?"}],
            hints={"crypto": "BTC", "model": "CNN", "profile": "moderate", "allowed_tools": ["get_recommendation"]},
            context=None,
            allowed_tools=["get_recommendation"],
            session_summary=None,
        )

        self.assertIn("get_recommendation", response.tools_used)
        self.assertTrue(response.mission.completed)
        self.assertIn("Buy", response.answer)


if __name__ == "__main__":
    unittest.main()
