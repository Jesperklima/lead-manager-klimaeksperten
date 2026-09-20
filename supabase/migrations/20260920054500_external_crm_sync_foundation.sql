-- Provider-neutral external CRM sync foundation.
-- Passive until a crm_* integration is connected for a workspace.

create table if not exists public.crm_external_entity_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  integration_id uuid not null references public.crm_integrations(id) on delete cascade,
  entity_type text not null check (entity_type in ('company','contact','lead')),
  local_id uuid not null,
  remote_id text not null,
  remote_url text,
  sync_hash text,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, entity_type, local_id),
  unique (integration_id, entity_type, remote_id)
);

create table if not exists public.crm_external_sync_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  integration_id uuid not null references public.crm_integrations(id) on delete cascade,
  entity_type text not null check (entity_type in ('company','contact','lead')),
  local_id uuid not null,
  operation text not null default 'upsert' check (operation in ('upsert','delete','status_update')),
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  status text not null default 'queued' check (status in ('queued','running','done','error','dead')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_external_sync_queue_one_queued
  on public.crm_external_sync_queue(integration_id, entity_type, local_id, operation)
  where status='queued';

create index if not exists crm_external_sync_queue_drain_idx
  on public.crm_external_sync_queue(status, available_at, created_at)
  where status in ('queued','error');

create index if not exists crm_external_sync_queue_client_idx
  on public.crm_external_sync_queue(client_id, created_at desc);

create table if not exists public.crm_external_sync_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  integration_id uuid references public.crm_integrations(id) on delete set null,
  queue_id uuid references public.crm_external_sync_queue(id) on delete set null,
  entity_type text not null check (entity_type in ('company','contact','lead')),
  local_id uuid,
  remote_id text,
  operation text not null,
  direction text not null check (direction in ('outbound','inbound')),
  status text not null,
  http_status integer,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_external_sync_log_client_idx
  on public.crm_external_sync_log(client_id, created_at desc);

alter table public.crm_external_entity_links enable row level security;
alter table public.crm_external_sync_queue enable row level security;
alter table public.crm_external_sync_log enable row level security;

drop policy if exists crm_external_entity_links_tenant_select on public.crm_external_entity_links;
create policy crm_external_entity_links_tenant_select
  on public.crm_external_entity_links
  for select
  to authenticated
  using (public.crm_has_client_access(client_id));

drop policy if exists crm_external_sync_queue_tenant_select on public.crm_external_sync_queue;
create policy crm_external_sync_queue_tenant_select
  on public.crm_external_sync_queue
  for select
  to authenticated
  using (public.crm_has_client_access(client_id));

drop policy if exists crm_external_sync_log_tenant_select on public.crm_external_sync_log;
create policy crm_external_sync_log_tenant_select
  on public.crm_external_sync_log
  for select
  to authenticated
  using (public.crm_has_client_access(client_id));

revoke all on table public.crm_external_entity_links from anon, authenticated;
revoke all on table public.crm_external_sync_queue from anon, authenticated;
revoke all on table public.crm_external_sync_log from anon, authenticated;
grant select on table public.crm_external_entity_links to authenticated;
grant select on table public.crm_external_sync_queue to authenticated;
grant select on table public.crm_external_sync_log to authenticated;
grant all on table public.crm_external_entity_links to service_role;
grant all on table public.crm_external_sync_queue to service_role;
grant all on table public.crm_external_sync_log to service_role;

create or replace function public.crm_is_external_crm_provider(p_provider text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_provider,'')) in (
    'crm_webhook',
    'hubspot',
    'pipedrive',
    'dynamics365',
    'salesforce'
  );
$$;

revoke all on function public.crm_is_external_crm_provider(text) from public, anon, authenticated;
grant execute on function public.crm_is_external_crm_provider(text) to service_role;

create or replace function public.crm_enqueue_external_sync_internal(
  p_client_id uuid,
  p_entity_type text,
  p_local_id uuid,
  p_operation text default 'upsert',
  p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_integration record;
  v_count integer:=0;
begin
  if p_client_id is null or p_local_id is null then
    return 0;
  end if;
  if p_entity_type not in ('company','contact','lead') then
    raise exception 'Ukendt CRM-entitet: %', p_entity_type;
  end if;
  if p_operation not in ('upsert','delete','status_update') then
    raise exception 'Ukendt CRM-sync handling: %', p_operation;
  end if;

  for v_integration in
    select i.id
    from public.crm_integrations i
    where i.client_id=p_client_id
      and i.status='connected'
      and public.crm_is_external_crm_provider(i.provider)
  loop
    insert into public.crm_external_sync_queue(
      client_id,integration_id,entity_type,local_id,operation,direction,status,payload,available_at,updated_at
    )
    values(
      p_client_id,v_integration.id,p_entity_type,p_local_id,p_operation,'outbound','queued',
      coalesce(p_payload,'{}'::jsonb),now(),now()
    )
    on conflict (integration_id,entity_type,local_id,operation) where status='queued'
    do update set
      payload=excluded.payload,
      available_at=least(public.crm_external_sync_queue.available_at,excluded.available_at),
      updated_at=now(),
      error_text=null;
    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.crm_enqueue_external_sync_internal(uuid,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.crm_enqueue_external_sync_internal(uuid,text,uuid,text,jsonb) to service_role;

create or replace function public.crm_external_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_client_id uuid;
  v_local_id uuid;
  v_entity_type text;
  v_operation text;
begin
  v_client_id:=coalesce(new.client_id,old.client_id);
  v_local_id:=coalesce(new.id,old.id);
  v_entity_type:=case tg_table_name
    when 'crm_companies' then 'company'
    when 'crm_contacts' then 'contact'
    when 'crm_leads' then 'lead'
    else null
  end;
  v_operation:=case when tg_op='DELETE' then 'delete' else 'upsert' end;

  if v_entity_type is null then
    return coalesce(new,old);
  end if;

  perform public.crm_enqueue_external_sync_internal(
    v_client_id,
    v_entity_type,
    v_local_id,
    v_operation,
    jsonb_build_object(
      'source_table',tg_table_name,
      'source_operation',tg_op,
      'queued_at',now()
    )
  );

  return coalesce(new,old);
end;
$$;

revoke all on function public.crm_external_sync_trigger() from public, anon, authenticated, service_role;

drop trigger if exists crm_companies_external_sync on public.crm_companies;
create trigger crm_companies_external_sync
after insert or update or delete on public.crm_companies
for each row execute function public.crm_external_sync_trigger();

drop trigger if exists crm_contacts_external_sync on public.crm_contacts;
create trigger crm_contacts_external_sync
after insert or update or delete on public.crm_contacts
for each row execute function public.crm_external_sync_trigger();

drop trigger if exists crm_leads_external_sync on public.crm_leads;
create trigger crm_leads_external_sync
after insert or update or delete on public.crm_leads
for each row execute function public.crm_external_sync_trigger();

create or replace function public.crm_request_external_sync(
  p_client_id uuid,
  p_entity_type text,
  p_local_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_exists boolean:=false;
  v_queued integer:=0;
begin
  if auth.uid() is null or not public.crm_has_client_access(p_client_id) then
    raise exception 'Adgang nægtet';
  end if;

  if not (
    public.crm_is_platform_admin()
    or exists(
      select 1 from public.crm_users u
      where u.client_id=p_client_id
        and u.auth_user_id=auth.uid()
        and u.active
        and lower(coalesce(u.role,'')) in ('owner','admin')
    )
  ) then
    raise exception 'Kun ejer/admin kan starte CRM-sync';
  end if;

  if p_entity_type='company' then
    select exists(select 1 from public.crm_companies where id=p_local_id and client_id=p_client_id) into v_exists;
  elsif p_entity_type='contact' then
    select exists(select 1 from public.crm_contacts where id=p_local_id and client_id=p_client_id) into v_exists;
  elsif p_entity_type='lead' then
    select exists(select 1 from public.crm_leads where id=p_local_id and client_id=p_client_id) into v_exists;
  else
    raise exception 'Ukendt CRM-entitet';
  end if;

  if not v_exists then
    raise exception 'CRM-entiteten findes ikke i dette workspace';
  end if;

  v_queued:=public.crm_enqueue_external_sync_internal(
    p_client_id,p_entity_type,p_local_id,'upsert',
    jsonb_build_object('requested_by',coalesce(auth.jwt()->>'email',auth.uid()::text),'requested_at',now())
  );

  return jsonb_build_object('ok',true,'queued',v_queued,'entity_type',p_entity_type,'local_id',p_local_id);
end;
$$;

revoke all on function public.crm_request_external_sync(uuid,text,uuid) from public, anon;
grant execute on function public.crm_request_external_sync(uuid,text,uuid) to authenticated, service_role;

create or replace function public.crm_external_sync_status(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.crm_has_client_access(p_client_id) then
    raise exception 'Adgang nægtet';
  end if;

  return jsonb_build_object(
    'connections',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,
        'provider',i.provider,
        'account',i.account,
        'status',i.status,
        'last_sync_at',i.last_sync_at,
        'last_error',i.last_error
      ) order by i.provider,i.created_at)
      from public.crm_integrations i
      where i.client_id=p_client_id
        and public.crm_is_external_crm_provider(i.provider)
    ),'[]'::jsonb),
    'queue',jsonb_build_object(
      'queued',(select count(*) from public.crm_external_sync_queue q where q.client_id=p_client_id and q.status='queued'),
      'running',(select count(*) from public.crm_external_sync_queue q where q.client_id=p_client_id and q.status='running'),
      'error',(select count(*) from public.crm_external_sync_queue q where q.client_id=p_client_id and q.status='error'),
      'dead',(select count(*) from public.crm_external_sync_queue q where q.client_id=p_client_id and q.status='dead')
    ),
    'links',(select count(*) from public.crm_external_entity_links l where l.client_id=p_client_id),
    'last_event',(select max(created_at) from public.crm_external_sync_log l where l.client_id=p_client_id)
  );
end;
$$;

revoke all on function public.crm_external_sync_status(uuid) from public, anon;
grant execute on function public.crm_external_sync_status(uuid) to authenticated, service_role;
