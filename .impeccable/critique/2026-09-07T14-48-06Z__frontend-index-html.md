---
target: frontend/index.html
total_score: 23
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 3
target_identity: "file:/home/bdutra/projects/advisor_investiment/frontend/index.html"
target_fingerprint: "sha256:799b52ab2c734a9df5e2c84c4c000e1526287e352ed0af7ca2f049f7a6ead02b"
target_path: /home/bdutra/projects/advisor_investiment/frontend/index.html
timestamp: 2026-09-07T14-48-06Z
slug: frontend-index-html
closed: true
---
Method: dual-agent (A: db1597b0-d138-467e-b725-d202a8432cbf · B: 70d0dae4-7619-4bc6-ba70-61c541b4a26f)

Target: `frontend/index.html` (marketing landing at `/`). Dashboard and Trade Bot out of scope.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live card: `aria-busy`, loading/error states; nav has no current-section state |
| 2 | Match System / Real World | 3 | Natural pt-BR advisor tone; “deep learning”, “alvo e stop” still dense for novices |
| 3 | User Control and Freedom | 3 | Skip link, anchors, exit to dashboard; no traps |
| 4 | Consistency and Standards | 3 | Visual system tight; CTA copy drifts (Criar conta / Criar conta no dashboard / Abrir Dashboard) |
| 5 | Error Prevention | 2 | “Valores em breve” helps; **Recomendado** + plan matrix still imply a buyable ladder |
| 6 | Recognition Rather Than Recall | 3 | Single-page sections + labeled perks |
| 7 | Flexibility and Efficiency | n/a | Persuade landing — no expert accelerators expected |
| 8 | Aesthetic and Minimalist Design | 2 | Clean but redundant CTA band + empty pricing stage dilute the one Persuade job |
| 9 | Error Recovery | 4 | Hardened fetch: plain fail reasons, dashboard link, retry, noscript |
| 10 | Help and Documentation | n/a | Persuade; footer disclaimer is legal hygiene, not task help |
| **Total** | | **23/32** | **Good** |

## Design Specificity Verdict

**LLM assessment**: Mostly category-interchangeable dark fintech SaaS (navy, blue accent, Sora, three features, three plans) with one product-specific spine: the live Bitcoin signal card, advise-not-execute copy, and honest signup unlock (“Sem cadastro você vê só o Bitcoin”). Brand is still nav-level, not hero-level. No invented social proof in this file — aligned with PRODUCT.md. Trade Bot correctly stays off the public pitch.

**Deterministic scan**: `detect.mjs` exited 2 with 36 findings in DEGRADED regex mode (21 font-size, 14 color, 1 em-dash-overuse). All 35 design-system hits are **scope false positives** (`DESIGN.md` is `#trade-bot-page only`). Em-dash count is a real content advisory, not a token FP.

**Visual overlays**: No reliable user-visible overlay. Playwright could not launch (`libnspr4.so` / missing modules). Fallback: static HTML + CLI scan. A11y static: 1 h1, lang=pt-BR, 0 images, 0 unnamed controls.

## Overall Impression

The page climbed from the old hype template into an honest advisor door: live signal, real signup value, no fake stars. The biggest remaining drag is **selling a plan ladder you cannot buy** while the primary job is create account — and a visual world that still reads as generic navy SaaS.

## What's Working

1. **Honesty matches Brand Commitments** — no +5.000 / 4.9★; educational footer; “Nenhuma ordem sai daqui.”
2. **Product proof in the hero** — `#signal-card` (sinal / alvo / stop / perfil moderado) is the only block that could not be swapped for a stock hero.
3. **Hardened failure UX** — timeout, offline, 404/5xx copy, retry, dashboard fallback, reduced-motion / contrast care.

## Priority Issues

**[P1] Brand and silhouette still category-generic**
- **What**: Navy SaaS shell; CryptoDash Pro only in nav; H1 is portable “sinais de IA.”
- **Why**: Persuade needs ownership; fails “could this be another brand?”
- **Fix**: Make CryptoDash Pro a hero-level signal; one motif tied to the owned signal artifact, not another equal three-up card row.
- **Suggested command**: `/impeccable bolder` or `/impeccable layout`

**[P1] Plan cards sell a ladder you cannot buy**
- **What**: Iniciante / Pro **Recomendado** / Institucional after “A assinatura ainda não está à venda,” with “Valores em breve.”
- **Why**: PRODUCT.md pricing undecided; theater burns trust when the real ask is create account.
- **Fix**: One waitlist/early-access story, or a single “conta libera o advisor” strip; keep Institucional mailto without a fake SKU grid.
- **Suggested command**: `/impeccable distill`

**[P1] Split / duplicated primary action**
- **What**: Many “Criar conta” plus closing “Criar conta” | “Abrir Dashboard” (same `/dashboard/`).
- **Why**: Dilutes the one Persuade decision; Jordan/Casey parse two products.
- **Fix**: One primary label sitewide; secondary = scroll to proof (`#recursos` / signal), not a twin dashboard link.
- **Suggested command**: `/impeccable clarify`

**[P2] Hero proof depends on fragile live fetch**
- **What**: Reco/target from API; Binance for price — peak collapses to “Indisponível.”
- **Why**: Recovery is good; persuasion is not when the proof is empty.
- **Fix**: Static last-known sample + “ao vivo quando API up,” or a skeleton that still teaches the artifact.
- **Suggested command**: `/impeccable harden`

**[P3] Features as equal cards**
- **What**: Three `.feature` panels with equal weight.
- **Why**: Weakens “Own the signal”; sentimento/chat should orbit the signal.
- **Fix**: One dominant sinal block; other two as supporting rows.
- **Suggested command**: `/impeccable layout`

## Persona Red Flags

**Jordan**: Jargon in H1/lede; nav **Cadastro** vs button **Criar conta**; **Recomendado** without price; final twin CTAs confuse first step.

**Riley**: Can kill API and see price update while sinal is Indisponível; three plan CTAs mostly go to dashboard despite “valores em breve”; `contato@aiinvestadvisor.com` vs brand CryptoDash Pro.

**Casey**: Long scroll; nav wraps into a crowded top cluster; near-duplicate bottom CTAs invite mis-tap.

**Bruno (PRODUCT.md)**: Landing correctly omits Trade Bot; plan theater is ahead of “success today” — he’d rather a sharp door to the advisor he already runs.

## Cognitive Load

5 of 8 checklist items fail (high): single focus, visual hierarchy, one thing at a time, progressive disclosure; nav at the 4-option edge; closing dual CTA is a false choice.

## Emotional Journey

Entry is calm and professional. Peak is the live signal. Valley risk is an empty card. Mid-page signup perks are clear; **Planos** drains momentum. End soft-thuds with duplicate CTAs + disclaimer — peak-end favors the signal earlier, not the close.

## Minor Observations

- Skip link and focus-visible are solid.
- Source line on Binance/CoinGecko builds legitimacy without fake metrics.
- Inline `margin-top` on vantagens CTA is a craft nit.
- Em-dash overuse (detector warning) — stylistic, not blocking.
- Meta description is accurate.

## Questions to Consider

- If pricing is undecided, why is **Planos** a primary nav destination?
- Should the first viewport sell **CryptoDash Pro** by name, or only “sinais de IA”?
- When the live sinal fails, may the page still Persuade — or must proof be static?
- Are **Criar conta** and **Abrir Dashboard** different jobs, or twin doors?
