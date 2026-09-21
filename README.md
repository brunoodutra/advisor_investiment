# advisor_investiment (Docker)

Pipeline CNN → API → dashboard, com Trade Bot opcional (paper/real na Binance).

Serviços via Docker Compose:
- **frontend**: site + dashboard estático (Nginx). Painel do Trade Bot em `/dashboard/` (abas, KPIs, pause, emergency close).
- **api**: FastAPI (porta 8000) — recomendações, sentimento, chat e estado do bot (JSON em `backend/Trade_Bot/data/`).
- **inference**: geração contínua de sinais (Buy/Sell/Hold) em `backend/AI/Classification/Real_Time_Inference/Recommendations/`
- **trade_bot** (profile `bot`): executa sinais. Único processo que envia ordens à exchange. A API só enfileira comandos em `commands.json`.

## Pré-requisitos
- Docker + Docker Compose (plugin `docker compose`)

## Variáveis de ambiente

Crie um `.env` na raiz (mesma pasta do `docker-compose.yml`):

```env
# --- LLM (opcional, /chat) ---
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=
GROQ_API_KEY=
DEEPINFRA_API_KEY=
# DEEPINFRA_TOKEN=   # alias aceito (mesmo valor do token DeepInfra)
DEEPINFRA_BASE_URL=
OLLAMA_HOST=

# --- Trade bot ---
TRADING_MODE=PAPER
MARKET_MODE=FUTURES
PAPER_BALANCE=1000
BINANCE_API_KEY=
BINANCE_SECRET_KEY=

# Protege POST /trade_bot/* (toggle, config, emergency close).
# Sem este valor, as mutações ficam abertas (apenas para dev local).
TRADE_BOT_API_TOKEN=

# Origens do dashboard (CORS). Padrão: localhost:8080
FRONTEND_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

Provedor ativo em `backend/LLM_chat/config/config.yaml` (`llm.provider`: `groq` | `openrouter` | `deepinfra`) + modelo em `llm.models.chat`. DeepInfra usa o endpoint OpenAI-compatible (`https://api.deepinfra.com/v1/openai`).

Não versionar chaves. Se vazou, rotacione.

No dashboard, se `TRADE_BOT_API_TOKEN` estiver definido na API, grave o mesmo valor no browser:

```js
localStorage.setItem('TRADE_BOT_API_TOKEN', 'seu-token')
```

(ou use `?tradeBotToken=` na URL). Detalhes do robô: [backend/Trade_Bot/README.md](backend/Trade_Bot/README.md).

## Subir tudo (servidor/PC)

Sobe **frontend + api + inference**:

```bash
docker compose up -d --build
```

URLs:
- Frontend: http://localhost:8080/
- Dashboard: http://localhost:8080/dashboard/
- API docs: http://localhost:8000/docs

## Subir com o bot (opcional)

```bash
docker compose --profile bot up -d --build
```

O bot só opera enquanto `bot_config.json` estiver `status: running` (toggle no dashboard). Fechamento emergencial e close por ativo são enfileirados e o bot executa **mesmo pausado**.

## Raspberry (inferência com TFLite runtime)

```bash
docker compose -f docker-compose.yml -f docker-compose.rpi.yml up -d --build
```

Com o bot:

```bash
docker compose --profile bot -f docker-compose.yml -f docker-compose.rpi.yml up -d --build
```

## GPU (NVIDIA / WSL2)

Se `nvidia-smi` funciona no WSL:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Com o bot:

```bash
docker compose --profile bot -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

## Logs e diagnóstico

```bash
docker compose ps
docker compose logs -f
docker compose logs -f api
docker compose logs -f inference
docker compose logs -f frontend
docker compose logs -f trade_bot
```

Heartbeat do loop do bot: campo `last_loop_at` em `backend/Trade_Bot/data/bot_config.json`.

## Parar tudo

```bash
docker compose down
```
