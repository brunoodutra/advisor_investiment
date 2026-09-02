# Trade Bot

Bot de trading para Binance: lê sinais da API local, opera em `PAPER` ou `REAL`, mercado `FUTURES` ou `SPOT`. O dashboard em `/dashboard/` controla pause, limites e fechamento emergencial.

## Visão geral

Loop contínuo:

1. Heartbeat (`last_loop_at`) e consumo da fila `data/commands.json` (mesmo se o bot estiver pausado).
2. Sincronizar estado local com a exchange (fills de entrada, SL e TP).
3. Buscar a última recomendação + alvo/stop no perfil configurado (`conservative` / `moderate` / `aggressive`).
4. Abrir, manter ou fechar posição **somente se o sinal for novo** (`Date|Time|recommendation`).
5. Persistir trades, eventos e config com lock de arquivo.

Sinais: `RECOMMENDATION_API_URL` (no Docker, `http://api:8000`). Código da API: `backend/API/API_setup.py`.

A API **não envia ordens**. `POST /trade_bot/emergency_close` e `POST /trade_bot/positions/close` apenas enfileiram `CLOSE_ALL` / `CLOSE_SYMBOL`. O processo `trade_bot` é o único writer na Binance.

## Arquitetura

- `src/main.py` — entrada, loop, heartbeat, comandos
- `src/config.py` — `.env` + `bot_settings.yaml`
- `src/json_store.py` — lock (`fcntl`) + escrita atômica dos JSON
- `src/command_queue.py` — fila `data/commands.json`
- `src/exchange_client.py` — ccxt Binance (spot / USD-M futures); paper com saldo e SL/TP simulados
- `src/signal_reader.py` — `last_recommendation` + `last_target_stop`
- `src/trade_manager.py` — sizing pelo stop, proteções, P&L no fill
- `src/state_manager.py` — `active_trades.json`, `order_history.json`, `bot_config.json`
- `run_bot.py` — launcher

## Modos

### Trading

- `TRADING_MODE=PAPER` — sem ordens reais; SL/TP fecham quando o ticker cruza o preço; saldo em `data/paper_account.json`
- `TRADING_MODE=REAL` — Binance; exige `BINANCE_API_KEY` e `BINANCE_SECRET_KEY`

### Mercado

- `MARKET_MODE=FUTURES` — USD-M; Buy = long, Sell = short; `set_leverage` antes da entrada; SL e TP separados. Se a proteção falhar, a posição é fechada (`PROTECTION_FAILED`).
- `MARKET_MODE=SPOT` — só long; Sell fecha; OCO quando a compra confirma.

## Risco

`risk_per_trade` é a **perda máxima aproximada se o stop bater**, não a fração nocional da carteira.

`quantidade ≈ (capital_efetivo × risk_per_trade) / |preço − stop|`, limitada por `max_allocation_per_crypto` e saldo (em futures, alavancagem entra no teto nocional).

Perfil de alvo/stop: `risk_profile` em `bot_settings.yaml` / `bot_config.json` (o dashboard pode gravar o mesmo campo).

## Persistência (`data/`)

- `active_trades.json` — PENDING / OPEN / CLOSED (inclui `stop_loss_price`, `take_profit_price`, `signal_key`)
- `order_history.json` — eventos
- `bot_config.json` — status, limites, `last_signal_keys`, `last_loop_at`, `risk_profile`
- `commands.json` — fila da API para o bot
- `paper_account.json` — saldo e ordens paper
- `logs/` — logs diários

Eventos: `ENTRY_SUBMITTED`, `ENTRY_ACCEPTED`, `ENTRY_FILLED`, `ENTRY_FAILED`, `FUTURES_PROTECTION_CREATED`, `FUTURES_PROTECTION_FAILED`, `SPOT_PROTECTION_CREATED`, `STOP_LOSS_TRIGGERED`, `TAKE_PROFIT_TRIGGERED`, `REVERSAL_SIGNAL`, `TRADE_CLOSED`, `TRADE_SKIPPED`, `STALE_PAPER_STATE_CLOSED`.

## Configuração

No Docker, use o `.env` da **raiz do repositório**. Fora do Docker, pode existir `.env` em `backend/Trade_Bot/`.

Paper:

```env
TRADING_MODE=PAPER
MARKET_MODE=FUTURES
PAPER_BALANCE=1000
RECOMMENDATION_API_URL=http://127.0.0.1:8000
RECOMMENDATION_MODEL_NAME=CNN
```

Futures real:

```env
TRADING_MODE=REAL
MARKET_MODE=FUTURES
BINANCE_API_KEY=
BINANCE_SECRET_KEY=
RECOMMENDATION_API_URL=http://127.0.0.1:8000
```

Defaults de risco/símbolos: `bot_settings.yaml`. Runtime: `data/bot_config.json`.

## Segurança da API

Se `TRADE_BOT_API_TOKEN` estiver definido, `POST /trade_bot/*` exige header `X-Trade-Bot-Token` (o dashboard lê `localStorage.TRADE_BOT_API_TOKEN`). CORS limitado a `FRONTEND_ORIGINS`.

## Como rodar (sem Docker)

1. Suba a API de recomendações.
2. `pip install -r requirements.txt`
3. `python run_bot.py`

No compose: `docker compose --profile bot up -d`.

## Observações

- REAL: chave com permissão do mercado escolhido; **sem saque**.
- Whitelist de IP na Binance, se houver.
- JSON, não banco. OCO spot depende da Binance/ccxt.
- Idempotência: o mesmo candle (mesma `Date`+`Time`+recomendação) não reabre após um close.

## Fase atual (Fase 1)

Operação segura do bot: lock, fila de comandos, paper com SL/TP, sizing pelo stop, leverage na conta, P&L no fill, token nas mutações.

Ainda **não** (Fase 2+): payload completo do dashboard (`closed_trades`, contexto de mercado, max drawdown no summary). O painel 2.0 já existe no frontend, mas parte dos gráficos/histórico ainda depende desses campos.
