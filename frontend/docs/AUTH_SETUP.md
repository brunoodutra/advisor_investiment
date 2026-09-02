# Caminho B (MVP com usuários) — Setup de Auth + DB (Supabase)

Este projeto é um frontend estático. Para ter cadastro/login + banco de dados (preferências e alertas), a opção mais simples é usar Supabase (Auth + Postgres) direto no browser com RLS.

## 1) Criar o projeto no Supabase

- Crie um projeto no Supabase
- Em Authentication:
  - Habilite Email/Password
  - Configure o Site URL (ex.: `https://seudominio.com`)
  - Configure Redirect URLs (ex.: `https://seudominio.com/dashboard/`)

## 2) Criar tabelas e políticas (RLS)

- Abra o SQL Editor
- Cole e execute o arquivo [schema.sql](file:///b:/projects/cryptodash-pro_site/supabase/schema.sql)

O arquivo cria:
- `profiles` (espelho de dados básicos do usuário)
- `user_settings` (preferências do dashboard por usuário)
- `alerts` (alertas persistidos)
- RLS para cada usuário acessar apenas os próprios dados

## 3) Conectar o dashboard ao Supabase

No dashboard, você pode salvar de 2 formas:

- arquivo local: [supabase.local.js](file:///b:/projects/cryptodash-pro_site/dashboard/supabase.local.js)
- painel “Configurar Supabase” na tela de login

Se quiser deixar salvo em arquivo, preencha `dashboard/supabase.local.js` com:

```js
window.SUPABASE_LOCAL_CONFIG = {
  url: 'https://seu-projeto.supabase.co',
  anonKey: 'SUA_ANON_PUBLIC_KEY'
};
```

Esse arquivo está no `.gitignore` do dashboard e nao deve ir para o repositório.

Campos:

- `url`: Project URL do Supabase
- `anonKey`: anon public key (Settings → API → anon)

Importante: nunca use chave `sb_secret_*` no frontend. Se aparecer `sb_secret_...`, você copiou a service role key.

## 4) Validar localmente

- Abra `http://localhost:4173/dashboard/`
- Clique em “Entrar” → “Criar conta”
- Depois do login:
  - “Configurações” passa a sincronizar para `user_settings`
  - “Alertas” permite criar/listar/pausar/excluir (tabela `alerts`)

