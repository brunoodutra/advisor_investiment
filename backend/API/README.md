# API (FastAPI)

Serviço em `API_setup.py` (no Docker: `uvicorn API.API_setup:app`, porta 8000).

## Endpoints principais

- `GET /last_recommendation`, `/last_target_stop`, `/recommendation_history`
- `GET /crypto_news`, `/sentiment_analysis`
- `POST /chat` — agente com tools (reco, TP/SL, sentimento, news, trade bot)
- `POST /chat/reset` — limpa sessão server-side (`sessionId`)
- `GET /trade_bot/dashboard`, `GET /trade_bot/config`
- `POST /trade_bot/config`, `/trade_bot/toggle` — config runtime (`bot_config.json`)
- `POST /trade_bot/emergency_close` — pausa o bot e enfileira `CLOSE_ALL` (o **trade_bot** fecha na exchange)
- `POST /trade_bot/positions/close` — enfileira `CLOSE_SYMBOL`

Mutações `/trade_bot` e `POST /chat`, `POST /chat/reset` exigem `X-Trade-Bot-Token` quando `TRADE_BOT_API_TOKEN` está definido. CORS: `FRONTEND_ORIGINS`.

## Chat agêntico (`POST /chat`)

Request (`ChatRequest`):

```json
{
  "sessionId": "sess_abc",
  "messages": [{"role": "user", "content": "Qual a recomendação do BTC?"}],
  "hints": {
    "crypto": "BTC",
    "model": "CNN",
    "profile": "moderate",
    "page": "crypto",
    "allowed_tools": ["get_recommendation", "get_chart_snapshot"]
  },
  "context": {
    "chart": {"candlesSummary": {}, "candlesTail": [{"time": 1, "close": 50000}]},
    "market": {"fearGreed": {"value": 62, "label": "Greed"}, "btcDominance": 54.2}
  },
  "highlights": []
}
```

Checkboxes do modal mapeiam para `hints.allowed_tools`. `get_trade_bot_summary` é sempre permitida no backend (sem checkbox).

Response (`ChatAgentResponse`):

```json
{
  "content": "...",
  "answer": "...",
  "mission": {"completed": false, "reason": null, "confidence": 70},
  "blocked": false,
  "blocked_reason": null,
  "summary": "...",
  "tools_used": ["get_recommendation"]
}
```

- Sessão em disco: `API/cache/chat_sessions/{sessionId}.json` (TTL 1h, máx. 8 turnos).
- `POST /chat/reset` com `{ "sessionId": "..." }` apaga a sessão (`{"status":"ok"}`).
- `blocked_reason`: `turn_limit_reached` | `llm_unavailable` | null.
- Endpoint roda em thread pool (`asyncio.to_thread`) para não bloquear outras rotas.
- Invocações Groq serializadas via lock em `API/cache/llm.lock`.

## Docker

O compose já sobe este serviço. Logs: `docker compose logs -f api`. Docs: http://localhost:8000/docs

## Local (sem compose)

A partir de `backend/`:

```bash
uvicorn API.API_setup:app --reload --host 0.0.0.0 --port 8000
```

`PYTHONPATH` deve incluir `backend` para importar `Trade_Bot` e `LLM_chat`.
