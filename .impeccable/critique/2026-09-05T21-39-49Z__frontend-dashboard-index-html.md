---
target: frontend/dashboard
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/home/bdutra/projects/advisor_investiment/frontend/dashboard/index.html"
target_fingerprint: "sha256:3cdcd518af37bcb82999884e537178d24b904d3237685c9f645c5f5b388ca013"
target_path: /home/bdutra/projects/advisor_investiment/frontend/dashboard/index.html
timestamp: 2026-09-05T21-39-49Z
slug: frontend-dashboard-index-html
---
# Design Critique — frontend/dashboard (CryptoDash Pro)

Method: dual-agent (A: dc976e87-a0f8-4a3e-b09f-c792e4ea1c83 · B: 7c68f2e9-d180-4f93-8d0d-f11999484053)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Bot pill/lamp/uptime good; $0.00 placeholders masquerade as real zeros, no stale-data indicator, no paper/real mode status, toasts vanish in 3s |
| 2 | Match System / Real World | 3 | pt-BR currency/dates, BUY→SELL cycles, translated close reasons; English profile names, mojibake alerts (indicatorControls.js:29), "Versão Profissional" title |
| 3 | User Control and Freedom | 2 | Esc closes modals; no undo, alert delete without confirm, no manual refresh, no hash routing (F5 loses Trade Bot page) |
| 4 | Consistency and Standards | 1 | Three visual languages (Tailwind rounded cards / olive industrial HMI / gray-800 modals); three feedback channels (toast / native alert() / native confirm()); duplicated roster and profile controls |
| 5 | Error Prevention | 2 | sb_secret_ key detection is real prevention; 50x leverage without warning, estop confirm shows no exposure, invalid config rows silently dropped |
| 6 | Recognition Rather Than Recall | 2 | Excellent authored empty states; zero tooltips for Profit Factor/Expectativa/Drawdown, MA panel assumes period knowledge |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts (only Esc), no bulk close, no deep-linking; history search/sort/CSV is the lone win |
| 8 | Aesthetic and Minimalist Design | 2 | Dashboard clean, desk dense-but-purposeful; 8-KPI overload, duplicated roster, fake market data fallback, double Fear & Greed number |
| 9 | Error Recovery | 2 | Supabase schema errors name the exact SQL fix; everything else is "Falha na requisição" with no retry |
| 10 | Help and Documentation | 1 | No help, no onboarding, no KPI glossary; AI chat is the de facto manual |
| **Total** | | **18/40** | **Poor — major UX overhaul required** |

## Design Specificity Verdict

Half-authored. The Trade Bot page's structure is unmistakably this product (operator blotter: status bar, KPI strip, open-positions roster with SL→TP progress, BUY→SELL cycle closes with pt-BR reasons); its shipped skin is the genre costume the committed direction explicitly refused (tradebot-hmi.css:1 "industrial HMI", beveled fascia :54-59, mushroom e-stop :228-236, olive palette, Titillium/Red Hat Mono — vs DESIGN.md flat #0d1117, hairlines, radius 0, Sora + IBM Plex Mono, "no mushroom e-stop costume", "replaces: Trade Bot HMI"). The DOM already matches the approved mock; the CSS is the only dissenting layer. The main dashboard (five equal hero cards, radius-12 Tailwind, hover-lift) is category-interchangeable.

Deterministic scan (detect.mjs, exit 2, degraded regex-fallback mode — undercount): 9 warnings — side-tab ×3 (marketExit.js:1131,1143; styles.css:1456), layout-transition ×3 (styles.css:691,1345,1603), broken-image ×1 (index.html:259), border-accent-on-rounded ×1 (styles.css:428), gradient-text ×1 (styles.css:659). Likely false positives: broken-image (JS-populated src) and layout-transition (progress bars).

Browser overlay (headless, console evidence only; no persistent user-visible overlay; CDN/APIs blocked so degraded render): 45 anti-patterns — undersized-ui-text ×20 (9.9–10.9px functional text: "Fechar Tudo", "P&L Aberto", "Win Rate", "Profit Factor", "Drawdown Máx."…), cramped-padding ×8 on .crypto-card, low-contrast ×7 incl. #238636 on #21262d at 3.3:1 ×5 (corroborates LLM contrast flags), body-text-viewport-edge ×4, heading-rhythm ×3, all-caps-body ×1, line-length ×1, overused-font ×1 (arial — likely font-loading artifact), nested-cards ×1.

## Overall Impression

The composition is right and the execution betrays it. The operator-desk structure is exactly the committed contract, and chat/auth statecraft shows real care. But the highest-stakes surface ships in a theatrical costume, confirms its nuclear action with a browser confirm(), can't say whether it's holding paper or real money, and lies through dead controls and fabricated fallback prices. Single biggest opportunity: make the money surface trustworthy — visible mode, honest controls, committed skin.

## What's Working

1. Operator-desk structure: status bar → KPI strip → open roster + last closes in first viewport; BUY→SELL cycle closes with humanized pt-BR reasons (tradeBotDashboard.js:462-473).
2. Statecraft in chat and empty states: aria-live session banners, reasoned lock placeholders, example-prompt empty state, authored teaching empty states.
3. Auth guardrails with real copy: sb_secret_ detection explains why it's wrong and what to paste instead (auth.js:168-173); schema errors name the exact SQL file.

## Priority Issues

1. **[P0] Real-money surface can't answer "paper or real?" and confirms its nuclear action with a browser dialog.** No paper/real, spot/futures indicator anywhere; tb-emergency-close fires native confirm() (tradeBotDashboard.js:565) with no position count/exposure; success toast renders blue because 'warning' is unhandled (ui.js:944-957). Fix: persistent mode badge in fascia (PAPER / REAL · USD-M); in-skin modal stating positions + exposure + resulting state; persistent result banner in Logs. Command: /impeccable harden
2. **[P1] Shipped Trade Bot skin is the explicitly refused direction; app speaks three visual languages.** Olive HMI costume vs committed flat night desk; every page transition is a costume change. Fix: rewrite tradebot-hmi.css tokens to committed palette/fonts (structure/IDs stay), flatten fascia, flat danger estop, align modals. Command: /impeccable quieter
3. **[P1] Core flow is keyboard- and screen-reader-inaccessible.** div onclick cards/rows (ui.js:144, ui.js:282); no :focus-visible outside #trade-bot-page; outline:none on selects; modals lack role=dialog/focus trap; tabs lack arrow keys; toasts not announced. Fix: real buttons/links, global focus ring, focus-trapped modals, tab arrow keys, role=status toasts. Command: /impeccable audit
4. **[P1] Dead and misleading controls erode trust.** Theme toggle with no stylesheet; "Mover TP" toasts "em breve"; sound notifications never play; alerts CRUD never fires; Portfolio is a static $10k mock in primary nav; "Mercado agora" falls back to fabricated hardcoded prices (tradeBotDashboard.js:1140-1145). Fix: remove or implement each; explicit "indisponível" state instead of fake data. Command: /impeccable distill
5. **[P2] Operator-facing state traps and illegible readouts.** Dual profile controls drive different state (nav → state.investmentProfile; fetchTargetStop reads state.settings.profile, api.js:483); KPI className overwrite breaks strip typography (tradeBotDashboard.js:1223-1241); 20 functional texts below 11px floor; confidence math can render 8500% (ui.js:471); no hash routing. Fix: unify profile state, patch KPI classes, normalize confidence at API boundary, ≥11px functional text, hash routing. Command: /impeccable typeset

## Persona Red Flags

- **Alex (power user):** spinner cards with no freshness timestamp or refresh-all; 10 chart controls, zero keyboard shortcuts; F5 dumps him off the Trade Bot page; no bulk close (five confirm()s or nuclear); dead "Mover TP". Abandons UI for API within a week.
- **Sam (accessibility-dependent):** blocked at step one — div-onclick cards unreachable by Tab; tabs without arrow-key nav; icon-only row actions with title instead of aria-label; modals don't trap/return focus; toasts silent; white-on-green-gradient ≈3.3:1 and gray HOLD badge fail contrast.
- **Bruno (operator, long sessions, real money):** nav profile vs settings profile split sends wrong target/stop; nothing shows real vs paper armed; 2 a.m. "Mercado agora" may show hardcoded BTC $68,240 as live; KPI typography jitters every refresh; mojibake alert()s; post-estop record is a vanished blue toast.

## Minor Observations

- Fear & Greed number rendered twice (index.html:169,180).
- class="...w-full"" double-quote typo live (ui.js:699).
- repairExitPrice displays inferred exit prices unmarked (tradeBotDashboard.js:1432-1441).
- Chat errors appended as assistant messages, burning the 30-message budget (chat.js:586).
- Log "Limpar" clears DOM only, unbinds after one click; "Próxima" pagination never disables at last page.
- navigation.js:53 calls unimported showNotification (dead duplicate).
- Overlay extras (degraded-render caveat): heading-rhythm above modal h3s, one 158-char line, one nested-cards, one all-caps body.
- Manual cache-busting (?v=20260905spark2) — stale-JS roulette for a money UI.

## Questions to Consider

1. Why isn't operating mode the loudest thing on the page? Should the entire desk skin shift when real mode is armed?
2. Is the "Trades Abertos" tab an admission that the first viewport failed? What does deleting it break?
3. What breaks if tradebot-hmi.css is deleted tomorrow? The DOM already matches the approved mock.
4. How much friction should "Fechar Tudo" have? Consequence-stating modal, or type-to-confirm for real money?
5. Are alerts a feature or a promise? What does the page owe the user who believed the badge?
