# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user today: Bruno — researcher and software engineer operating CryptoDash Pro for his own paper or real Binance trading, using the dashboard, CNN signals, market sentiment, and conversational AI to decide, and the Trade Bot privately to execute.

Intended later audience (not yet served): retail crypto investors who would buy access to a professional advisor site — recommendations, market sentiment, and (next) price forecast. The Trade Bot is not for them today; exposing it to other users is a future decision.

## Product Purpose

CryptoDash Pro is a Portuguese web advisor: live market data, owned CNN buy/sell/hold signals (with target/stop by risk profile), market sentiment, and an agentic chat over those tools — so Bruno can read, ask, and decide in one place.

Success today: the advisory product (dashboard + chat + recommendations + sentiment) works well enough to sell access later from a professional advisor site.

Success later: sell access to recommendations, sentiment, and price forecast; optionally open the Trade Bot to other users after that.

## Positioning

Neighboring dashboards show prices. Neighboring bots trade. CryptoDash Pro’s distinct mechanism is the owned CNN classification pipeline (Buy/Sell/Hold, target/stop by conservative/moderate/aggressive profile) plus an agentic chat that can call those tools, sentiment, news, and chart context in the same product. Automated execution exists, but it is Bruno’s private operator path — not the public offering.

## Operating Context

- Docker Compose stack: static frontend (Nginx, `localhost:8080`), FastAPI (`localhost:8000`), continuous CNN inference writing signals, optional `trade_bot` profile.
- Surfaces: marketing landing at `/`, dashboard SPA at `/dashboard/` (market overview, asset detail, Trade Bot panel, portfolio, alerts, settings, auth, AI chat).
- Market data: Binance, CoinGecko, Fear & Greed. Recommendations and target/stop from the local API. Chat via Groq / OpenRouter / Ollama. Optional Supabase auth, settings, and alerts.
- Inference can run on Raspberry Pi (TFLite) or GPU. The API never sends exchange orders; it queues commands. Only the `trade_bot` process talks to Binance (paper or real; spot or USD-M futures).
- Risk is sized from stop distance (`risk_per_trade` is approximate loss if stop hits, not notional fraction). Mutations to bot and chat are token-gated when `TRADE_BOT_API_TOKEN` is set.

## Capabilities and Constraints

Confirmed today:

- Landing + dashboard: prices, global market, Fear & Greed, candlestick charts, technical indicators, ruler, CNN recommendations and history, target/stop, news/sentiment, investment profile selector, AI chat with tools, alerts, settings, optional login.
- Trade Bot panel (pause, limits, emergency close, per-symbol close) is operator-only for Bruno. Paper-first; real Binance keys are a real capability, not a mock.
- Next planned public feature: price forecast.
- Public site may sell access to recommendations, sentiment, and (later) forecast. Trade Bot stays private until Bruno opens it.
- UI language is Portuguese (pt-BR). Product name is CryptoDash Pro.
- Existing terms copy: informational/educational; the user owns investment decisions; no performance guarantee.

Undecided (do not invent):

- When the public offering goes live, actual pricing/plans, domain, and billing.
- Whether the public site should hide the Trade Bot UI entirely until it is offered to others.
- Accessibility standard beyond ordinary web expectations.

## Brand Commitments

- Name: CryptoDash Pro.
- Primary language: Portuguese (pt-BR).
- Positioning as a professional advisor site that can later sell service access — not a consumer hype brand and not a public trading-bot product today.
- Footer/terms already state educational/informational use and that this is not financial advice; keep that honesty.

## Evidence on Hand

Real and on this repo: CNN recommendation files and API, live market integrations, agentic chat, paper/real Binance bot for Bruno, dashboard and landing implementations.

Must not fabricate: user counts, ratings, testimonials, invented customers, or performance/accuracy claims. Landing copy currently includes unverifiable social proof (e.g. “+5.000 investidores”, 4.9/5) and is not product evidence. Pricing cards on the landing are placeholders, not confirmed commercial offers.

## Product Principles

1. Advise in public, execute in private — the sellable product is signals, sentiment, chat, and later forecast; the Trade Bot stays Bruno-only until he opens it.
2. Own the signal — the CNN pipeline (and later forecast) is the reason to use this instead of a generic market dashboard.
3. Chat is part of the job, not a gadget — the advisor should answer from the same recommendations, sentiment, chart, and (operator) bot state the dashboard shows.
4. No invented proof — never fabricate users, ratings, testimonials, or edge over the market.
5. Honest enough to sell later — professional advisor tone, educational disclaimer, and real Binance capability as facts, without promising results.
