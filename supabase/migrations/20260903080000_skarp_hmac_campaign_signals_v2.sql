alter table public.crm_marketing_connections
  add column if not exists webhook_secret_id uuid;

create table if not exists public.crm_marketing_campaign_signals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  connection_id uuid not null references public.crm_marketing_connections(id) on delete cascade,
  campaign_id uuid references public.crm_marketing_campaigns(id) on delete set null,
  platform text not null default 'Partner/Web',
  event_type text not null,
  external_event_id text,
  post_id text,
  source_url text,
  content text,
  metrics jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists crm_marketing_campaign_signals_dedupe_uq
  on public.crm_marketing_campaign_signals(connection_id, external_event_id)
  where external_event_id is not null and external_event_id <> '';
create index if not exists crm_marketing_campaign_signals_client_idx
  on public.crm_marketing_campaign_signals(client_id, occurred_at desc);
create index if not exists crm_marketing_campaign_signals_campaign_idx
  on public.crm_marketing_campaign_signals(campaign_id, occurred_at desc);

alter table public.crm_marketing_campaign_signals enable row level security;
drop policy if exists crm_marketing_campaign_signals_tenant_select on public.crm_marketing_campaign_signals;
create policy crm_marketing_campaign_signals_tenant_select
  on public.crm_marketing_campaign_signals for select
  using (public.crm_has_client_access(client_id));

grant select on public.crm_marketing_campaign_signals to authenticated;

create or replace function public.crm_marketing_create_connection(
  p_partner_id uuid,
  p_platform text,
  p_label text,
  p_default_campaign_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','vault','extensions'
as $$
declare
  v_partner public.crm_marketing_partners%rowtype;
  v_secret text;
  v_secret_id uuid;
  v_id uuid;
  v_status text;
begin
  select * into v_partner from public.crm_marketing_partners where id=p_partner_id;
  if not found then raise exception 'Marketing partner not found'; end if;
  if not public.crm_has_client_access(v_partner.client_id) then raise exception 'Access denied'; end if;
  if p_platform not in ('generic','website','google','meta','linkedin') then raise exception 'Unsupported platform'; end if;
  if p_default_campaign_id is not null and not exists(
    select 1 from public.crm_marketing_campaigns where id=p_default_campaign_id and client_id=v_partner.client_id
  ) then raise exception 'Campaign mismatch'; end if;

  v_secret:=encode(gen_random_bytes(24),'hex');
  v_status:=case when p_platform in ('meta','linkedin') then 'needs_credentials' else 'connected' end;

  insert into public.crm_marketing_connections(
    client_id,partner_id,platform,label,status,default_campaign_id,webhook_secret_hash
  ) values(
    v_partner.client_id,p_partner_id,p_platform,
    coalesce(nullif(btrim(p_label),''),initcap(p_platform)||' forbindelse'),
    v_status,p_default_campaign_id,encode(digest(v_secret,'sha256'),'hex')
  ) returning id into v_id;

  v_secret_id:=vault.create_secret(
    v_secret,
    'marketing_'||v_id::text||'_webhook_key',
    'Lead Manager marketing webhook HMAC key'
  );
  update public.crm_marketing_connections set webhook_secret_id=v_secret_id where id=v_id;

  return jsonb_build_object('id',v_id,'webhook_key',v_secret,'status',v_status,'platform',p_platform);
end;
$$;

create or replace function public.crm_marketing_rotate_webhook_key(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public','vault','extensions'
as $$
declare
  v_conn public.crm_marketing_connections%rowtype;
  v_secret text;
  v_secret_id uuid;
begin
  select * into v_conn from public.crm_marketing_connections where id=p_connection_id;
  if not found then raise exception 'Connection not found'; end if;
  if not public.crm_has_client_access(v_conn.client_id) then raise exception 'Access denied'; end if;

  v_secret:=encode(gen_random_bytes(24),'hex');
  if v_conn.webhook_secret_id is null then
    v_secret_id:=vault.create_secret(
      v_secret,
      'marketing_'||p_connection_id::text||'_webhook_key',
      'Lead Manager marketing webhook HMAC key'
    );
  else
    perform vault.update_secret(
      v_conn.webhook_secret_id,
      v_secret,
      'marketing_'||p_connection_id::text||'_webhook_key',
      'Lead Manager marketing webhook HMAC key'
    );
    v_secret_id:=v_conn.webhook_secret_id;
  end if;

  update public.crm_marketing_connections
    set webhook_secret_hash=encode(digest(v_secret,'sha256'),'hex'),
        webhook_secret_id=v_secret_id,
        updated_at=now(),
        last_error=null
  where id=p_connection_id;
  return v_secret;
end;
$$;

comment on column public.crm_marketing_connections.webhook_secret_id is
  'Vault secret used to validate signed partner webhooks such as Skarp Studio. The plaintext is never exposed after create or rotate.';
comment on table public.crm_marketing_campaign_signals is
  'Anonymous campaign and content signals that must not create CRM prospects, e.g. post.published and engagement.snapshot.';
