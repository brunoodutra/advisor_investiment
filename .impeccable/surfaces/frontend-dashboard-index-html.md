---
version: 1
slug: "frontend-dashboard-index-html"
primary_target: "frontend/dashboard/index.html"
related_targets: []
---

# Trade Bot console

Mode: Operate. Audience: Bruno, private operator. Job: see open risk and last closes first, then RUN / STOP / ESTOP. Keep Ligar Bot, Fechar Tudo, Configurar, all KPI/tab/table IDs.

## Direction contract

THESIS: The Trade Bot is an operator desk — open positions and last closed cycles are the work surface; commands and KPIs are chrome, not the story. Refuses industrial HMI fascia, equal KPI card grids as the hero, and burying opens behind a tab.

OWN-WORLD: CryptoDash night ground (`#0d1117` / `#161b22`), ink white, muted `#8b949e`, green/red only for P&L and BUY/SELL legs, amber for caution/status. Sora for UI, IBM Plex Mono for money and times. Flat panels, 1px hairlines, no glass, no bevelled bezels, no mushroom e-stop costume.

STORY: In one glance he sees what is open, what just closed (BUY→SELL + reason + P&L), and whether the bot is live — then he can pause, kill, or dig into full history.

FIRST VIEWPORT: Slim status bar (back, name+status, RUN/STOP/ESTOP/config). Compact KPI strip. Split desk: left = open positions roster; right = last closes feed + equity spark.

FORM: Operator desk / trading blotter; kind redesign replacing Industrial HMI.

FINISH: undocumented is unfinished — update DESIGN.md; keep every JS ID working.
