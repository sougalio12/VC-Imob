-- Execute manualmente no SQL Editor do Supabase antes de publicar a Edge Function site-lead.
-- Mantém a tabela leads inacessível ao papel anon: somente a Edge Function usa esta proteção.
-- Não execute automaticamente sem revisar os limites e a configuração da função.

create table if not exists public.site_lead_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.site_lead_rate_limits enable row level security;

revoke all on table public.site_lead_rate_limits from anon, authenticated;

create or replace function public.consume_site_lead_rate_limit(
  target_key text,
  max_requests integer default 5,
  window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if target_key is null or char_length(target_key) < 16 then
    return false;
  end if;

  insert into public.site_lead_rate_limits as limits (
    rate_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (target_key, now(), 1, now())
  on conflict (rate_key) do update
  set
    request_count = case
      when limits.window_started_at < now() - make_interval(secs => window_seconds) then 1
      else limits.request_count + 1
    end,
    window_started_at = case
      when limits.window_started_at < now() - make_interval(secs => window_seconds) then now()
      else limits.window_started_at
    end,
    updated_at = now()
  returning request_count <= max_requests into allowed;

  return allowed;
end;
$$;

revoke all on function public.consume_site_lead_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_site_lead_rate_limit(text, integer, integer) to service_role;
