# Deploy (baixo custo)

Este repositório publica dois frontends estáticos e um backend separado (sua API de recomendações).

## Componentes

- Landing: `/index.html`
- Dashboard: `/dashboard/`
- Proxy da API (para deploy estático): `/api/reco/*`

O dashboard faz chamadas para `CONFIG.apis.recommendations` e, em produção, usa `/api/reco` por padrão.

## Caminho B (MVP com usuários)

Para cadastro/login + dados por usuário (preferências e alertas), o dashboard pode usar Supabase (Auth + Postgres) direto do browser com RLS.

- Setup completo: [AUTH_SETUP.md](file:///b:/projects/cryptodash-pro_site/docs/AUTH_SETUP.md)

## Opção A (recomendada): Vercel (front) + Raspberry (API) via Cloudflare Tunnel

### 1) Deploy do front na Vercel

- Importe o repositório na Vercel
- Configure a variável de ambiente `RECOMMENDATIONS_API_BASE` com a URL interna do seu backend (ex.: `http://127.0.0.1:8000` se o Tunnel estiver no mesmo host, ou `http://SEU_HOST:8000` na rede)
- Faça o deploy

URLs esperadas:

- `https://seudominio.com/` (landing)
- `https://seudominio.com/dashboard/` (dashboard)
- `https://seudominio.com/api/reco/last_recommendation?...` (proxy)

### 2) Expor a API no Raspberry sem abrir portas

- Instale e autentique o Cloudflare Tunnel
- Crie um hostname `api.seudominio.com` apontando para `http://127.0.0.1:8000`
- Garanta que sua API responda em `0.0.0.0:8000` (para aceitar conexões locais do tunnel)

Resultado:

- Sua API fica em `https://api.seudominio.com`
- A Vercel encaminha `/api/reco/*` para `RECOMMENDATIONS_API_BASE`

## Opção B: Vercel (front) + VPS barata (API)

- Suba a API em um VPS (Ubuntu) com `systemd` + `nginx` (reverse proxy) e SSL
- Aponte `api.seudominio.com` para o VPS
- Defina `RECOMMENDATIONS_API_BASE=https://api.seudominio.com` na Vercel

## Desenvolvimento local

Por padrão, ao abrir o dashboard em `localhost`, ele usa `http://127.0.0.1:8000`.

Overrides:

- querystring: `http://localhost:PORT/dashboard/?recommendationsBase=http://127.0.0.1:8000`
- localStorage: `localStorage.setItem('recommendationsBase', 'http://127.0.0.1:8000')`

## Observações importantes

- Evite IP hardcoded no frontend; use subdomínio (`api.seudominio.com`) + proxy `/api/reco`.
- Se a API for pública, implemente rate limit e restrinja CORS (ou prefira o proxy same-origin).
