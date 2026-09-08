---
target: frontend/index.html
total_score: 13
max_score: 32
na_heuristics: 7,10
p0_count: 2
p1_count: 2
target_identity: "file:/home/bdutra/projects/advisor_investiment/frontend/index.html"
target_fingerprint: "sha256:5d5c0e4e22685c33e0dc03df8313f4bd0bfa298232a35a595bf4d375f65f8eeb"
target_path: /home/bdutra/projects/advisor_investiment/frontend/index.html
timestamp: 2026-09-06T16-53-58Z
slug: frontend-index-html
closed: true
---
Method: dual-agent (A: 1744a087-b32d-4786-8407-f14ff41ad70d · B: 07796765-dd9b-4950-9fd0-f8a52023423e)

Target: `frontend/index.html` (marketing landing at `/`). Dashboard and Trade Bot out of scope.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Hero can show `INDISPONÍVEL` / `API indisponível`; pricing `Quero ser avisado` / `Falar comigo` and feature cards give zero feedback; sticky nav has no active section |
| 2 | Match System / Real World | 1 | Mixed EN/PT (`buy/sell/hold`, `Timeframe`, `Starter`/`Pro`, `POPULAR`); headings like `Resultados e narrativa de produto` address the builder; public copy sells execução against advisor positioning |
| 3 | User Control and Freedom | 2 | Desktop anchors work; mobile hamburger does not open a menu — it navigates to `/dashboard/` |
| 4 | Consistency and Standards | 2 | `Abrir Dashboard` / `Ver Demo` / `Abrir Demo` / `Abrir` all go to `/dashboard/`; cards use `cursor-pointer` but are not links; English `<title>` vs pt-BR body; TradingView logo is not a confirmed integration |
| 5 | Error Prevention | 1 | Fake social proof and live-looking prices invite a trust error; waitlist/contact buttons are inert; hamburger promises a menu and is a navigation trap |
| 6 | Recognition Rather Than Recall | 2 | Desktop nav is labeled; mobile hides Recursos/Cases/Planos/Demo; chart mock is an icon; CNN is never named |
| 7 | Flexibility and Efficiency | n/a | Persuade landing; single primary act, no expert-path expectation |
| 8 | Aesthetic and Minimalist Design | 1 | Duplicate dashboard chrome, blink, fake avatars/stars, three empty pricing columns, six same-weight sections |
| 9 | Error Recovery | 2 | Reco failure is plain but offers no next step; dead buttons and third-party images have no recovery |
| 10 | Help and Documentation | n/a | Persuade page; footer disclaimer is legal honesty, not help |
| **Total** | | **13/32** | **Poor** |

## Design Specificity Verdict

**LLM assessment**: This page is a category-interchangeable Tailwind crypto-SaaS template, not a professional advisor site authored for CryptoDash Pro. Stock `gray-900`/`blue-600`, Font Awesome `fa-brain`/`fa-robot`, macOS traffic-light chrome, Clearbit logos, RandomUser avatars, a blinking `NOVO` pill, and a chart that is an icon in a gray box. The owned CNN Buy/Sell/Hold + target/stop by profile, sentiment, and chat are almost absent; “execução” leaks into public copy. Invented proof (`+5.000 investidores`, `4.9/5`, named quotes) and placeholder `R$99`/`R$299`/`R$999` cards contradict Brand Commitments.

**Deterministic scan**: `detect.mjs --json frontend/index.html` exited 2 with 9 findings (8 `design-system-color`, 1 `design-system-radius`) in DEGRADED regex mode (htmlparser2/css-tree unavailable). All 9 are scope false positives: DESIGN.md is `#trade-bot-page only`. Tailwind utilities were not scanned (undercount). Additional source a11y facts the detector missed: 2 `<h1>`s, 5 images without `alt`, 1 unnamed hamburger button.

**Visual overlays**: No reliable user-visible overlay. Playwright could not launch (missing `libnspr4.so` / `libnss3.so`); mutation preflight and `detect.js` injection were not attempted. Fallback: static HTML + CLI scan.

## Overall Impression

The landing looks like a purchased SaaS kit with the product name pasted on. The single real artifact is the hero widget that actually fetches BTC and a CNN last-recommendation — and even that sits next to fake investors and a fake chart. The biggest opportunity is to stop selling a bot storefront and show one honest dated signal.

## What's Working

1. **Hero widget talks to the real stack** — Binance `BTCUSDT` + `last_recommendation?model_name=CNN&crypto=BTC`, with a real failure string (`INDISPONÍVEL` / `API indisponível`) instead of a frozen screenshot.
2. **Footer disclaimer** matches Brand Commitments: `Conteúdo educacional, não é recomendação financeira.`
3. **Desktop primary act is obvious** — `Abrir Dashboard` in nav and hero is the right conversion if the public product is the advisor dashboard.

## Priority Issues

**[P0] Invented social proof**
- **What**: Hero `Junte-se a +5.000 investidores` + `4.9/5` stars; RandomUser faces; `#cases` “Mariana R.” / “Ricardo T.” quotes about consistência and executar.
- **Why it matters**: PRODUCT.md forbids fabricated users, ratings, testimonials. For a site that later sells advice, fake proof is a trust-killer and a compliance smell. The honest footer makes the stars look like a lie.
- **Fix**: Delete every avatar, count, rating, and named quote. Replace `#cases` with one real CNN example (BTC, timeframe, buy/sell/hold, target/stop, as-of time) plus the educational frame.
- **Suggested command**: `/impeccable distill`

**[P0] Public story sells execution; the product pitch is advisor-only**
- **What**: Features H2 `Feito para análise e execução`; sub `transformar sinais em ação`; Ricardo’s “executar”; robot icon on `Recomendação IA`. Sentiment, chat, and the name CNN never appear. Logo strip claims TradingView.
- **Why it matters**: Positioning is advise in public, execute in private. Visitors infer a trading bot. The differentiator is invisible.
- **Fix**: Rewrite to recomendações CNN, sentimento, (later) forecast, chat. Drop execução. Drop TradingView. Feature tiles: Sinal CNN · Sentimento · Chat — not `Configurações`.
- **Suggested command**: `/impeccable clarify`

**[P1] Pricing theater**
- **What**: `Starter R$99/mês`, `Pro R$299/mês` + `POPULAR`, `Institucional R$999/mês`; buttons `Quero ser avisado` / `Falar comigo` with no handler; intro `Estrutura pronta para você evoluir para assinaturas.`
- **Why it matters**: Undecided commercial offers are presented as SKUs. Dead buttons feel broken. Meta copy talks to the builder.
- **Fix**: Remove numbers and the three-tier grid until pricing is real. One line: access not for sale yet + one working waitlist or mailto.
- **Suggested command**: `/impeccable distill`

**[P1] Mobile nav is a trap, not a menu**
- **What**: `md:hidden` bars button; JS sets `window.location.href = '/dashboard/'`. No drawer, overlay, or anchors. Button has no accessible name.
- **Why it matters**: Casey cannot reach Recursos/Cases/Planos/Demo. Control and freedom fail on the default phone path.
- **Fix**: Actual menu (or in-page links). Never bind hamburger to dashboard. Add `aria-label`.
- **Suggested command**: `/impeccable harden`

**[P2] Generic template chrome, duplicated and empty**
- **What**: Two macOS `/dashboard/` frames; chart = `fa-chart-line` + placeholder copy; `NOVO` `.blink`; hover lift/scale on non-links.
- **Why it matters**: Zero specificity; the demo promise is unpaid.
- **Fix**: One live (or honest static) recommendation artifact. Kill the second mock, the blink, and pointer-on-dead-cards.
- **Suggested command**: `/impeccable quieter`

## Persona Red Flags

**Jordan (first-timer)**: Hero `recomendações (buy/sell/hold)` and demo `Perfil (conservative/moderate/aggressive)` / `Binance (klines)` with no gloss. `NOVO` does not say what is new. `Ver Demo` is the same `/dashboard/` as `Abrir Dashboard`. `#cases` heading `Resultados e narrativa de produto` is not visitor language. `Configurações` as a marketed feature looks like admin. `Quero ser avisado` confirms nothing.

**Riley (stress tester)**: Pricing buttons and `cursor-pointer` cards click to silence. Hamburger icon ≠ menu. Price `--` stays `text-green-400`. `recommendationsBase` query/localStorage override on a marketing page. Third-party faces/logos with no fallback. TradingView vs confirmed integrations. `4.9/5` next to the educational disclaimer.

**Casey (mobile)**: Only persistent control is a top-right hamburger that leaves the page. Primary CTA is mid-hero, not thumb-zone; no sticky bottom CTA. Hover effects do nothing on touch. Long same-weight scroll. Tailwind + FA CDNs are a single unstyled-failure point.

**Bruno (operator / future seller, from PRODUCT.md)**: The page pitches the private Trade Bot story (`execução`, `executar`) and fake commercial SKUs he has not decided to sell. It does not show the CNN pipeline he actually owns.

## Cognitive Load

5 of 8 checklist items fail (high): single focus, grouping, visual hierarchy, one thing at a time, progressive disclosure. Desktop nav is 5 destinations. Pricing is 3 options but they are false commercial decisions.

## Emotional Journey

Open is urgency theater (blink `NOVO`, `+5.000`, gold stars). Valley is fake cases, a non-live “Demonstração ao vivo”, and pricing copy aimed at the developer. The high-stakes money moment is fabricated people and prices, not CNN mechanics. The footer is the most honest line and it contradicts everything above it.

## Minor Observations

- `<title>` is English; `lang="pt-BR"`.
- Two `<h1>`s; five avatars lack `alt`.
- Reco styling is color-only.
- Pro card `scale-105` unbalances the trio.
- Sentiment, chat, Fear & Greed unused; Settings is a feature tile.
- Demo tip about API offline is operator talk.
- Landing has no visual system of its own (DESIGN.md is Trade Bot only).
- Footer incomplete vs header.

## Questions to Consider

- If every fake human, star, and `R$` vanished, would anyone still know this is an owned CNN advisor?
- Why does the first H2 sell `execução` when Trade Bot must stay off this page?
- What would a confident advisor hero be: one dated BTC signal (ação, alvo, stop, perfil), not a blinking `NOVO`?
- Who is `#pricing` for — a future customer, or the template reassuring itself it has plans?
