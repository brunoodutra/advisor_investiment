create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = user_id);

create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (user_id) do update
    set email = excluded.email,
        name = excluded.name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "user_settings_select_own"
on public.user_settings
for select
using (auth.uid() = user_id);

create policy "user_settings_upsert_own"
on public.user_settings
for insert
with check (auth.uid() = user_id);

create policy "user_settings_update_own"
on public.user_settings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  crypto_id text not null,
  crypto_symbol text not null,
  operator text not null check (operator in ('gte','lte')),
  target_price numeric not null,
  enabled boolean not null default true,
  note text,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.alerts enable row level security;

create policy "alerts_select_own"
on public.alerts
for select
using (auth.uid() = user_id);

create policy "alerts_insert_own"
on public.alerts
for insert
with check (auth.uid() = user_id);

create policy "alerts_update_own"
on public.alerts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "alerts_delete_own"
on public.alerts
for delete
using (auth.uid() = user_id);
