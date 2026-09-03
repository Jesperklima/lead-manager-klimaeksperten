-- Skarp Studio managed clients v1
-- Each Skarp workspace gets its own isolated Lead Manager client + marketing connection.

create table if not exists public.crm_admin_client_access (
  auth_user_id uuid not null,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  primary key(auth_user_id, client_id)
);
create index if not exists crm_admin_client_access_client_idx on public.crm_admin_client_access(client_id);
alter table public.crm_admin_client_access enable row level security;
revoke all on table public.crm_admin_client_access from public, anon, authenticated;

create table if not exists public.crm_skarp_workspaces (
  workspace_id uuid primary key,
  client_id uuid not null unique references public.crm_clients(id) on delete cascade,
  connection_id uuid unique references public.crm_marketing_connections(id) on delete set null,
  workspace_name text not null,
  marketing_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists crm_skarp_workspaces_active_idx on public.crm_skarp_workspaces(marketing_active,last_seen_at desc);
alter table public.crm_skarp_workspaces enable row level security;
revoke all on table public.crm_skarp_workspaces from public, anon, authenticated;

create or replace function public.crm_internal_admin()
returns boolean
language sql stable security definer
set search_path=public,auth as $$
  select exists(
    select 1
    from public.crm_users u
    join public.crm_usage_limits l on l.client_id=u.client_id
    where u.active
      and u.auth_user_id=auth.uid()
      and lower(coalesce(u.role,'')) in ('owner','admin')
      and l.plan_code='internal'
  );
$$;
revoke all on function public.crm_internal_admin() from public,anon;
grant execute on function public.crm_internal_admin() to authenticated,service_role;

create or replace function public.crm_has_client_access(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path=public,auth as $$
  select exists(
    select 1 from public.crm_users u
    where u.client_id=p_client_id and u.active and u.auth_user_id=auth.uid()
  )
  or public.crm_confirmed_invite_access(p_client_id)
  or exists(
    select 1 from public.crm_admin_client_access a
    where a.client_id=p_client_id and a.auth_user_id=auth.uid()
  );
$$;
revoke all on function public.crm_has_client_access(uuid) from public,anon;
grant execute on function public.crm_has_client_access(uuid) to authenticated,service_role;

create or replace function public.crm_admin_list_managed_clients()
returns table(
  client_id uuid,
  client_name text,
  source text,
  workspace_id uuid,
  marketing_active boolean,
  is_home boolean
)
language plpgsql stable security definer
set search_path=public,auth as $$
begin
  if not public.crm_internal_admin() then
    raise exception 'Kun intern ejer/admin kan skifte kundeprofil';
  end if;

  return query
  select c.id,c.name,'internal'::text,null::uuid,true,true
  from public.crm_clients c
  join public.crm_users u on u.client_id=c.id
  join public.crm_usage_limits l on l.client_id=c.id
  where u.auth_user_id=auth.uid() and u.active
    and lower(coalesce(u.role,'')) in ('owner','admin') and l.plan_code='internal'

  union all

  select c.id,c.name,a.source,w.workspace_id,coalesce(w.marketing_active,true),false
  from public.crm_admin_client_access a
  join public.crm_clients c on c.id=a.client_id
  left join public.crm_skarp_workspaces w on w.client_id=c.id
  where a.auth_user_id=auth.uid()
  order by is_home desc,client_name;
end;
$$;
revoke all on function public.crm_admin_list_managed_clients() from public,anon;
grant execute on function public.crm_admin_list_managed_clients() to authenticated;

create or replace function public.crm_skarp_provision_workspace(
  p_bootstrap_client_id uuid,
  p_workspace_id uuid,
  p_workspace_name text,
  p_marketing_active boolean default true,
  p_force_rotate boolean default false,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path=public,vault,extensions as $$
declare
  v_name text:=left(nullif(btrim(coalesce(p_workspace_name,'')),''),240);
  v_client_id uuid;
  v_partner_id uuid;
  v_connection_id uuid;
  v_secret text;
  v_secret_id uuid;
  v_existing_secret_id uuid;
  v_created_client boolean:=false;
  v_created_connection boolean:=false;
  v_rotated boolean:=false;
begin
  if p_workspace_id is null then raise exception 'workspace_id mangler'; end if;
  if v_name is null then raise exception 'workspace_name mangler'; end if;
  if not exists(
    select 1 from public.crm_usage_limits l where l.client_id=p_bootstrap_client_id and l.plan_code='internal'
  ) then raise exception 'Bootstrap client er ikke intern'; end if;

  select w.client_id,w.connection_id into v_client_id,v_connection_id
  from public.crm_skarp_workspaces w where w.workspace_id=p_workspace_id;

  if v_client_id is null then
    insert into public.crm_clients(name,geography,services,settings)
    values(
      v_name,null,'{}'::text[],
      jsonb_build_object(
        'managed_source','skarp_studio',
        'skarp_workspace_id',p_workspace_id,
        'marketing_managed',true,
        'saas',jsonb_build_object('onboarding_completed',true,'managed_profile',true)
      )
    ) returning id into v_client_id;
    v_created_client:=true;
    insert into public.crm_skarp_workspaces(workspace_id,client_id,workspace_name,marketing_active,metadata)
    values(p_workspace_id,v_client_id,v_name,p_marketing_active,coalesce(p_metadata,'{}'::jsonb));
  else
    update public.crm_skarp_workspaces
      set workspace_name=v_name,marketing_active=p_marketing_active,
          metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),last_seen_at=now()
      where workspace_id=p_workspace_id;
    update public.crm_clients
      set name=v_name,
          settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object(
            'managed_source','skarp_studio','skarp_workspace_id',p_workspace_id,
            'marketing_managed',true
          )
      where id=v_client_id;
  end if;

  select p.id into v_partner_id
  from public.crm_marketing_partners p
  where p.client_id=v_client_id and lower(p.name)='skarp studio'
  order by p.created_at asc limit 1;
  if v_partner_id is null then
    insert into public.crm_marketing_partners(client_id,name,partner_type,active,metadata)
    values(v_client_id,'Skarp Studio','agency',true,jsonb_build_object('workspace_id',p_workspace_id,'managed',true))
    returning id into v_partner_id;
  else
    update public.crm_marketing_partners set active=true,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('workspace_id',p_workspace_id,'managed',true) where id=v_partner_id;
  end if;

  if v_connection_id is not null then
    select webhook_secret_id into v_existing_secret_id from public.crm_marketing_connections where id=v_connection_id;
  end if;

  if v_connection_id is null then
    v_secret:=encode(gen_random_bytes(24),'hex');
    insert into public.crm_marketing_connections(
      client_id,partner_id,platform,label,status,webhook_secret_hash,config
    ) values(
      v_client_id,v_partner_id,'generic','Skarp Studio · '||v_name,
      case when p_marketing_active then 'connected' else 'disabled' end,
      encode(digest(v_secret,'sha256'),'hex'),
      jsonb_build_object('managed_source','skarp_studio','workspace_id',p_workspace_id)
    ) returning id into v_connection_id;
    v_secret_id:=vault.create_secret(v_secret,'marketing_'||v_connection_id::text||'_webhook_key','Skarp Studio workspace webhook HMAC key');
    update public.crm_marketing_connections set webhook_secret_id=v_secret_id where id=v_connection_id;
    update public.crm_skarp_workspaces set connection_id=v_connection_id where workspace_id=p_workspace_id;
    v_existing_secret_id:=v_secret_id;
    v_created_connection:=true;
  elsif p_force_rotate then
    v_secret:=encode(gen_random_bytes(24),'hex');
    if v_existing_secret_id is null then
      v_existing_secret_id:=vault.create_secret(v_secret,'marketing_'||v_connection_id::text||'_webhook_key','Skarp Studio workspace webhook HMAC key');
    else
      perform vault.update_secret(v_existing_secret_id,v_secret,'marketing_'||v_connection_id::text||'_webhook_key','Skarp Studio workspace webhook HMAC key');
    end if;
    update public.crm_marketing_connections
      set webhook_secret_id=v_existing_secret_id,webhook_secret_hash=encode(digest(v_secret,'sha256'),'hex'),last_error=null,updated_at=now()
      where id=v_connection_id;
    v_rotated:=true;
  end if;

  update public.crm_marketing_connections
    set partner_id=v_partner_id,status=case when p_marketing_active then 'connected' else 'disabled' end,
        config=coalesce(config,'{}'::jsonb)||jsonb_build_object('managed_source','skarp_studio','workspace_id',p_workspace_id),updated_at=now()
    where id=v_connection_id;

  insert into public.crm_admin_client_access(auth_user_id,client_id,source)
  select distinct u.auth_user_id,v_client_id,'skarp_studio'
  from public.crm_users u
  join public.crm_usage_limits l on l.client_id=u.client_id
  where u.client_id=p_bootstrap_client_id and u.active and u.auth_user_id is not null
    and lower(coalesce(u.role,'')) in ('owner','admin') and l.plan_code='internal'
  on conflict(auth_user_id,client_id) do update set source=excluded.source;

  if v_secret is null then
    select decrypted_secret into v_secret from vault.decrypted_secrets where id=v_existing_secret_id limit 1;
  end if;
  if nullif(v_secret,'') is null then raise exception 'Workspace webhook nøgle kunne ikke hentes'; end if;

  return jsonb_build_object(
    'client_id',v_client_id,
    'partner_id',v_partner_id,
    'connection_id',v_connection_id,
    'webhook_key',v_secret,
    'workspace_id',p_workspace_id,
    'workspace_name',v_name,
    'marketing_active',p_marketing_active,
    'created_client',v_created_client,
    'created_connection',v_created_connection,
    'rotated',v_rotated
  );
end;
$$;
revoke all on function public.crm_skarp_provision_workspace(uuid,uuid,text,boolean,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.crm_skarp_provision_workspace(uuid,uuid,text,boolean,boolean,jsonb) to service_role;
