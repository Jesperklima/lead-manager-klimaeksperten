create table if not exists public.crm_marketing_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  partner_id uuid not null references public.crm_marketing_partners(id) on delete cascade,
  platform text not null check (platform in ('generic','website','google','meta','linkedin')),
  label text not null,
  status text not null default 'ready' check (status in ('ready','needs_credentials','connected','error','disabled')),
  external_account_id text,
  external_page_id text,
  external_form_id text,
  default_campaign_id uuid references public.crm_marketing_campaigns(id) on delete set null,
  webhook_secret_hash text not null,
  access_secret_id uuid,
  app_secret_id uuid,
  config jsonb not null default '{}'::jsonb,
  last_event_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_marketing_connections_client_idx on public.crm_marketing_connections(client_id,platform,status);
create index if not exists crm_marketing_connections_partner_idx on public.crm_marketing_connections(partner_id,platform);

create table if not exists public.crm_marketing_inbound_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  connection_id uuid not null references public.crm_marketing_connections(id) on delete cascade,
  platform text not null,
  external_event_id text,
  event_type text,
  status text not null default 'received' check (status in ('received','processed','pending_credentials','duplicate','ignored','error')),
  prospect_id uuid references public.crm_marketing_prospects(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists crm_marketing_inbound_events_dedupe_uq on public.crm_marketing_inbound_events(connection_id,external_event_id) where external_event_id is not null and external_event_id<>'';
create index if not exists crm_marketing_inbound_events_client_idx on public.crm_marketing_inbound_events(client_id,received_at desc);

alter table public.crm_marketing_connections enable row level security;
alter table public.crm_marketing_inbound_events enable row level security;
drop policy if exists crm_marketing_connections_tenant_all on public.crm_marketing_connections;
create policy crm_marketing_connections_tenant_all on public.crm_marketing_connections for all using (public.crm_has_client_access(client_id)) with check (public.crm_has_client_access(client_id));
drop policy if exists crm_marketing_inbound_events_tenant_select on public.crm_marketing_inbound_events;
create policy crm_marketing_inbound_events_tenant_select on public.crm_marketing_inbound_events for select using (public.crm_has_client_access(client_id));
grant select,insert,update,delete on public.crm_marketing_connections to authenticated;
grant select on public.crm_marketing_inbound_events to authenticated;
drop trigger if exists trg_crm_marketing_connections_touch on public.crm_marketing_connections;
create trigger trg_crm_marketing_connections_touch before update on public.crm_marketing_connections for each row execute function public.crm_touch_updated_at();

create or replace function public.crm_marketing_create_connection(p_partner_id uuid,p_platform text,p_label text,p_default_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_partner public.crm_marketing_partners%rowtype;v_secret text;v_id uuid;v_status text;
begin
 select * into v_partner from public.crm_marketing_partners where id=p_partner_id;
 if not found then raise exception 'Marketing partner not found'; end if;
 if not public.crm_has_client_access(v_partner.client_id) then raise exception 'Access denied'; end if;
 if p_platform not in ('generic','website','google','meta','linkedin') then raise exception 'Unsupported platform'; end if;
 if p_default_campaign_id is not null and not exists(select 1 from public.crm_marketing_campaigns where id=p_default_campaign_id and client_id=v_partner.client_id) then raise exception 'Campaign mismatch'; end if;
 v_secret:=encode(gen_random_bytes(24),'hex');
 v_status:=case when p_platform in ('meta','linkedin') then 'needs_credentials' else 'connected' end;
 insert into public.crm_marketing_connections(client_id,partner_id,platform,label,status,default_campaign_id,webhook_secret_hash)
 values(v_partner.client_id,p_partner_id,p_platform,coalesce(nullif(btrim(p_label),''),initcap(p_platform)||' forbindelse'),v_status,p_default_campaign_id,encode(digest(v_secret,'sha256'),'hex')) returning id into v_id;
 return jsonb_build_object('id',v_id,'webhook_key',v_secret,'status',v_status,'platform',p_platform);
end;$$;
grant execute on function public.crm_marketing_create_connection(uuid,text,text,uuid) to authenticated;

create or replace function public.crm_marketing_rotate_webhook_key(p_connection_id uuid)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare v_client uuid;v_secret text;
begin
 select client_id into v_client from public.crm_marketing_connections where id=p_connection_id;
 if v_client is null then raise exception 'Connection not found'; end if;
 if not public.crm_has_client_access(v_client) then raise exception 'Access denied'; end if;
 v_secret:=encode(gen_random_bytes(24),'hex');
 update public.crm_marketing_connections set webhook_secret_hash=encode(digest(v_secret,'sha256'),'hex'),updated_at=now() where id=p_connection_id;
 return v_secret;
end;$$;
grant execute on function public.crm_marketing_rotate_webhook_key(uuid) to authenticated;

create or replace function public.crm_marketing_store_secret(p_connection_id uuid,p_kind text,p_value text)
returns void language plpgsql security definer set search_path=public,vault as $$
declare v_conn public.crm_marketing_connections%rowtype;v_existing uuid;v_new uuid;v_name text;
begin
 select * into v_conn from public.crm_marketing_connections where id=p_connection_id;
 if not found then raise exception 'Connection not found'; end if;
 if not public.crm_has_client_access(v_conn.client_id) then raise exception 'Access denied'; end if;
 if p_kind not in ('access_token','app_secret') then raise exception 'Unsupported secret kind'; end if;
 if nullif(btrim(p_value),'') is null then raise exception 'Secret cannot be empty'; end if;
 v_existing:=case when p_kind='access_token' then v_conn.access_secret_id else v_conn.app_secret_id end;
 v_name:='marketing_'||p_connection_id::text||'_'||p_kind;
 if v_existing is null then v_new:=vault.create_secret(p_value,v_name,'Lead Manager marketing connection secret'); else perform vault.update_secret(v_existing,p_value,v_name,'Lead Manager marketing connection secret');v_new:=v_existing;end if;
 if p_kind='access_token' then update public.crm_marketing_connections set access_secret_id=v_new,status=case when platform='linkedin' and app_secret_id is null then 'needs_credentials' else 'connected' end,last_error=null where id=p_connection_id;
 else update public.crm_marketing_connections set app_secret_id=v_new,status=case when platform='linkedin' and access_secret_id is null then 'needs_credentials' else 'connected' end,last_error=null where id=p_connection_id;end if;
end;$$;
grant execute on function public.crm_marketing_store_secret(uuid,text,text) to authenticated;

create or replace function public.crm_marketing_connection_has_credentials(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.crm_marketing_connections%rowtype;
begin select * into v from public.crm_marketing_connections where id=p_connection_id;if not found then raise exception 'Connection not found';end if;if not public.crm_has_client_access(v.client_id) then raise exception 'Access denied';end if;return jsonb_build_object('access_token',v.access_secret_id is not null,'app_secret',v.app_secret_id is not null);end;$$;
grant execute on function public.crm_marketing_connection_has_credentials(uuid) to authenticated;

create or replace function public.crm_marketing_service_get_secret(p_secret_id uuid)
returns text language sql security definer set search_path=vault,public as $$select decrypted_secret from vault.decrypted_secrets where id=p_secret_id limit 1$$;
revoke all on function public.crm_marketing_service_get_secret(uuid) from public,anon,authenticated;
grant execute on function public.crm_marketing_service_get_secret(uuid) to service_role;
