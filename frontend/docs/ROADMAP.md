# Roadmap e Planejamento (CryptoDash Pro)

Este documento consolida tudo o que falta para deixar o produto “completo” e pronto para colocar no ar com baixo custo, além de um plano de evolução.

## 1) Estado atual (o que já existe)

- Landing unificada na raiz: `/index.html` (CTAs para `/dashboard/`)
- Dashboard em `/dashboard/` (SPA estática)
  - Dados de mercado: Binance + CoinGecko + Fear&Greed
  - Recomendações: integração com sua API (`/last_recommendation`, `/recommendation_history`, `/last_target_stop`, etc.)
  - Proxy para produção: `/api/reco/*` (para evitar CORS e simplificar)
- Guia de deploy inicial: [DEPLOYMENT.md](file:///b:/projects/cryptodash-pro_site/docs/DEPLOYMENT.md)

## 2) Objetivo (definição de “completo”)

Um produto “completo” aqui significa:

- Front (landing + dashboard) publicados com domínio e HTTPS
- API publicada com URL estável, healthcheck, logs e reinício automático
- Dashboard resiliente (sem dados mockados; falhas tratadas e exibidas)
- Base para crescer: usuários, alertas e monetização (quando decidir)

## 3) Decisão estratégica (3 caminhos)

Escolha um caminho como foco de curto prazo (o restante fica no backlog):

### Caminho A — MVP público (sem login)
Objetivo: validar interesse/uso com o menor custo e menos complexidade.

Entrega:
- Landing forte + dashboard aberto
- Limites explícitos (ex.: algumas moedas/timeframes) e aviso legal
- Monitoramento mínimo da API

### Caminho B — MVP com usuários (grátis)
Objetivo: começar a guardar preferências, alertas e histórico por usuário.

Entrega:
- Login/cadastro
- Preferências por usuário (modelo/timeframe/candles/perfil)
- Alertas persistidos

### Caminho C — Produto com pagamento (assinatura)
Objetivo: monetizar e limitar acesso por plano.

Entrega:
- Checkout + status de assinatura
- Feature gates (limites por plano)
- Webhooks e painel básico de conta

## 4) Checklist “pronto para colocar no ar” (go-live)

### 4.1 Infra e domínio
- Definir domínio (ex.: `seudominio.com`)
- Definir subdomínios:
  - `seudominio.com` → landing
  - `seudominio.com/dashboard/` → dashboard
  - `api.seudominio.com` → backend (ou manter tudo via proxy)
- Garantir HTTPS em tudo

### 4.2 API (backend)
- Implementar/confirmar endpoints mínimos:
  - `GET /health`
  - `GET /last_recommendation?model_name=&crypto=`
  - `GET /recommendation_history?model_name=&crypto=`
  - `GET /last_target_stop?model_name=&crypto=&profile=`
  - (opcional) `GET /specific_recommendation?...`
- Padronizar payloads (mesma capitalização e tipos)
- Garantir rate limit básico (mesmo que simples)
- Garantir logs (request + erro) sem vazar dados sensíveis

### 4.3 Dashboard
- Garantir que todas as telas principais funcionam sem depender de dados mockados
- Exibir estado de erro amigável quando a API de recomendações estiver offline
- Revisar limites de rate limit de Binance/CoinGecko no browser

### 4.4 Operação
- Documentar como subir/parar a API (systemd no Raspberry/VPS)
- Backup (se houver banco no futuro)

## 5) Plano de hospedagem (baixo custo)

### Opção recomendada para começar
- Front: Vercel (estático)
- API: Raspberry na sua rede com Cloudflare Tunnel

Motivo:
- custo baixo
- HTTPS fácil
- sem abrir portas no roteador

Alternativa:
- API em VPS barata (mais estabilidade 24/7)

Detalhes operacionais estão em [DEPLOYMENT.md](file:///b:/projects/cryptodash-pro_site/docs/DEPLOYMENT.md).

## 6) Pendências por área (backlog organizado)

### 6.1 Produto/UX
- Landing:
  - Ajustar textos para refletir funcionalidades reais (sem promessas de performance)
  - Páginas: “Como funciona”, “FAQ”, “Contato”, “Termos” e “Privacidade”
- Dashboard:
  - Fluxo claro de erro (API off, rate limit, falhas de rede)
  - “Última atualização” consistente por bloco

### 6.2 Usuários e autenticação (quando entrar no Caminho B/C)
- Escolher solução:
  - Auth pronta (Supabase/Auth0) ou auth própria no backend
- Funções mínimas:
  - cadastro/login/logout
  - reset de senha
  - verificação de email
  - sessão segura
- Autorização:
  - rotas do dashboard protegidas para recursos de conta

### 6.3 Banco de dados (quando entrar no Caminho B/C)
- Modelos sugeridos:
  - `users`
  - `user_settings`
  - `alerts`
  - `subscriptions` (se houver cobrança)
  - `audit_events` (mínimo)

### 6.4 Alertas reais (quando entrar no Caminho B/C)
- Criar backend de alertas:
  - scheduler/worker (cron) para verificar condições
  - canal de notificação (email/Telegram/push)
  - deduplicação e “cooldown”
- UI:
  - CRUD de alertas
  - histórico de disparos

### 6.5 Monetização (Caminho C)
- Checkout e assinatura (Stripe)
- Webhooks (status de pagamento, cancelamento, upgrade)
- Feature gating por plano:
  - limites de moedas/timeframes
  - histórico estendido
  - indicadores premium

### 6.6 Dados e escalabilidade
- Evitar dependência do client para dados de mercado em escala:
  - adicionar cache/proxy server-side para Binance/CoinGecko
  - reduzir chamadas por usuário
- Cache:
  - respostas de recomendações e mercado com TTL

### 6.7 Observabilidade e qualidade
- Logs estruturados no backend
- Métricas simples (latência, taxa de erro)
- Página de status (mínimo interno)
- Smoke tests (scripts simples) para endpoints

### 6.8 Segurança
- Rate limiting
- Proteção contra abuso (user-agent, throttling, ban básico)
- CORS restrito (ou proxy same-origin)
- Nunca expor IP local/segredos no frontend

## 7) Plano de execução (sequência sugerida)

### Fase 0 — Go-live técnico (1–2 dias)
- Domínio + deploy do front
- Publicar API (Raspberry Tunnel ou VPS)
- Ajustar `RECOMMENDATIONS_API_BASE` na Vercel
- Validar dashboard end-to-end

### Fase 1 — MVP público (1–2 semanas)
- Refinar landing (mensagem, provas, FAQ)
- Melhorar UX de erro e loading
- Cache básico no backend

### Fase 2 — Usuários + Alertas (2–4 semanas)
- Auth + DB + settings por usuário
- CRUD de alertas + worker

### Fase 3 — Assinatura (2–4 semanas)
- Stripe + webhooks + feature gates
- Página “Minha conta”

## 8) Critérios de aceite (para dizer “feito”)

- Landing e dashboard abrem com HTTPS sem erros de console
- Recomendações carregam via API (ou UI mostra indisponível com mensagem)
- API tem `/health` e reinicia sozinha em falhas
- Deploy reproduzível seguindo [DEPLOYMENT.md](file:///b:/projects/cryptodash-pro_site/docs/DEPLOYMENT.md)

