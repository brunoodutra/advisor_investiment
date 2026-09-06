---
name: Trade Bot Operator Desk
description: Private operator blotter for CryptoDash Pro Trade Bot — open risk and last closes first, commands as chrome.
colors:
  ground: "#0d1117"
  panel: "#161b22"
  panel-2: "#1c2128"
  hair: "#30363d"
  ink: "#f0f3f6"
  muted: "#8b949e"
  run: "#238636"
  run-hi: "#3fb950"
  danger: "#da3633"
  danger-hi: "#f85149"
  caution: "#d29922"
  focus: "#58a6ff"
typography:
  body:
    fontFamily: "Sora, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.4
  headline:
    fontFamily: "Sora, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 600
    letterSpacing: "-0.02em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontWeight: 600
rounded:
  none: "0"
spacing:
  page: "1rem 1.25rem 2.5rem"
  panel: "0.9rem 1rem 1rem"
  desk-gap: "1rem"
components:
  status-bar: Slim bar with lamp, name, status pill, RUN / Fechar Tudo / Configurar
  kpi-strip: Dense horizontal metrics, hairline grid, lead cell for open P&L
  open-panel: Primary work surface — roster + detail
  recent-feed: Last closed cycles BUY→SELL with reason and P&L
  equity-panel: Compact cumulative chart under recent feed
  more-tabs: Histórico, Desempenho, Mercado & DD, Logs
named_rules:
  - Open positions and last closes live in the first viewport; never bury opens behind a tab as the only path
  - Side on closed trades is a cycle (BUY→SELL), not a lone BUY badge
  - Color only for P&L sign, BUY/SELL legs, run/pause/error status, and the operating-mode badge
  - Operating mode (PAPER/REAL · SPOT/FUTUROS) is always visible in the fascia, sourced from the API's environment block; REAL is danger-colored, PAPER is caution, unknown says "Modo —" instead of guessing
  - Destructive commands (Fechar Tudo, per-symbol close) confirm in-skin with position count, exposure, open P&L and resulting state — never native confirm()
  - Command outcomes persist as dismissible banners in Logs & Eventos; toasts are ephemeral only
  - Flat panels and 1px hairlines — no industrial bevels, glass, or mushroom e-stop costume
  - Keep every existing JS ID (controls, KPIs, tables, charts, modals)
scope: "#trade-bot-page only; rest of CryptoDash unchanged"
replaces: Trade Bot HMI
---
