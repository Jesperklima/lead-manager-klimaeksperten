-- Shared Microsoft identity platform app + tenant-isolated refresh tokens.
-- The platform app credentials are stored once in Supabase Vault.
-- Each customer receives its own refresh token, bound to its configured sender address.

create table if not exists public.crm_microsoft_oauth_states (
  state_token text primary key,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  user_email text not null,
  return_url text not null default 'https://lead-manager-klimaeksperten.vercel.app/',
  requested_scope text not null,
  code_verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz
);

alter table public.crm_microsoft_oauth_states enable row level security;
revoke all on public.crm_microsoft_oauth_states from public, anon, authenticated;
grant select,insert,update,delete on public.crm_microsoft_oauth_states to service_role;

create or replace function public.crm_set_microsoft_platform_app(
  p_app_id text,
  p_client_secret text
) returns jsonb
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  v_app_name text := 'microsoft_platform_client_id';
  v_secret_name text := 'microsoft_platform_client_secret';
  v_app_secret_id uuid;
  v_client_secret_id uuid;
  v_redirect text := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/microsoft-oauth-callback';
begin
  if p_app_id is null or trim(p_app_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Microsoft Application (client) ID er ikke gyldig';
  end if;
  if p_client_secret is null or length(trim(p_client_secret)) < 8 then
    raise exception 'Microsoft Client Secret mangler eller er for kort';
  end if;

  select id into v_app_secret_id from vault.secrets where name=v_app_name limit 1;
  if v_app_secret_id is null then
    perform vault.create_secret(trim(p_app_id),v_app_name,'Lead Manager shared Microsoft OAuth Application (client) ID');
  else
    perform vault.update_secret(v_app_secret_id,trim(p_app_id),v_app_name,'Lead Manager shared Microsoft OAuth Application (client) ID');
  end if;

  select id into v_client_secret_id from vault.secrets where name=v_secret_name limit 1;
  if v_client_secret_id is null then
    perform vault.create_secret(trim(p_client_secret),v_secret_name,'Lead Manager shared Microsoft OAuth client secret');
  else
    perform vault.update_secret(v_client_secret_id,trim(p_client_secret),v_secret_name,'Lead Manager shared Microsoft OAuth client secret');
  end if;

  return jsonb_build_object('stored',true,'redirect_uri',v_redirect,'tenant','common');
end;
$$;

create or replace function public.crm_get_microsoft_platform_app()
returns jsonb
language sql
security definer
set search_path=public,vault
as $$
  select jsonb_build_object(
    'client_id',(select decrypted_secret from vault.decrypted_secrets where name='microsoft_platform_client_id' limit 1),
    'client_secret',(select decrypted_secret from vault.decrypted_secrets where name='microsoft_platform_client_secret' limit 1),
    'redirect_uri','https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/microsoft-oauth-callback',
    'tenant','common'
  );
$$;

create or replace function public.crm_get_microsoft_oauth_material(p_client_id uuid)
returns jsonb
language sql
security definer
set search_path=public,vault
as $$
  select jsonb_build_object(
    'client_id',(select decrypted_secret from vault.decrypted_secrets where name='microsoft_platform_client_id' limit 1),
    'client_secret',(select decrypted_secret from vault.decrypted_secrets where name='microsoft_platform_client_secret' limit 1),
    'refresh_token',(select decrypted_secret from vault.decrypted_secrets where name='microsoft_refresh_token_' || p_client_id::text limit 1),
    'account',coalesce(
      (select account from public.crm_integrations where client_id=p_client_id and provider='microsoft' order by updated_at desc limit 1),
      (select settings->>'mail' from public.crm_clients where id=p_client_id)
    ),
    'scope',coalesce(
      (select config->'oauth'->>'scope' from public.crm_integrations where client_id=p_client_id and provider='microsoft' order by updated_at desc limit 1),''
    )
  );
$$;

create or replace function public.crm_set_microsoft_refresh_token(
  p_client_id uuid,
  p_refresh_token text,
  p_account text,
  p_scope text
) returns jsonb
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  v_name text := 'microsoft_refresh_token_' || p_client_id::text;
  v_id uuid;
  v_expected text;
  v_scope text := trim(coalesce(p_scope,''));
  v_redirect text := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/microsoft-oauth-callback';
begin
  if p_refresh_token is null or length(trim(p_refresh_token)) < 20 then
    raise exception 'Microsoft refresh token mangler';
  end if;
  select nullif(lower(trim(settings->>'mail')),'') into v_expected from public.crm_clients where id=p_client_id;
  if v_expected is null then raise exception 'Kundens afsendermail er ikke konfigureret'; end if;
  if lower(trim(coalesce(p_account,''))) <> v_expected then
    raise exception 'Forkert Microsoft-konto: forventede %, fik %',v_expected,p_account;
  end if;

  select id into v_id from vault.secrets where name=v_name limit 1;
  if v_id is null then
    perform vault.create_secret(trim(p_refresh_token),v_name,'Microsoft OAuth refresh token for Lead Manager tenant');
  else
    perform vault.update_secret(v_id,trim(p_refresh_token),v_name,'Microsoft OAuth refresh token for Lead Manager tenant');
  end if;

  insert into public.crm_integrations(client_id,provider,account,status,config,last_error,updated_at)
  values(
    p_client_id,'microsoft',v_expected,'connected',
    jsonb_build_object(
      'mode','microsoft_graph',
      'oauth',jsonb_build_object(
        'status','connected','scope',v_scope,'connected_account',v_expected,
        'connected_at',now(),'refresh_token_stored',true,'redirect_uri',v_redirect
      ),
      'direct_send',jsonb_build_object('status','connected'),
      'history_read',position('Mail.Read' in v_scope)>0
    ),null,now()
  )
  on conflict (client_id,provider,account) do update set
    status='connected',
    config=coalesce(public.crm_integrations.config,'{}'::jsonb) || jsonb_build_object(
      'mode','microsoft_graph',
      'oauth',coalesce(public.crm_integrations.config->'oauth','{}'::jsonb) || jsonb_build_object(
        'status','connected','scope',v_scope,'connected_account',v_expected,
        'connected_at',now(),'refresh_token_stored',true,'redirect_uri',v_redirect
      ),
      'direct_send',jsonb_build_object('status','connected'),
      'history_read',position('Mail.Read' in v_scope)>0
    ),
    last_error=null,
    updated_at=now();

  return jsonb_build_object('stored',true,'account',v_expected,'status','connected','scope',v_scope);
end;
$$;

create or replace function public.crm_get_microsoft_status(p_client_id uuid)
returns jsonb
language sql
security definer
set search_path=public,vault
as $$
  select jsonb_build_object(
    'account',coalesce(
      (select account from public.crm_integrations where client_id=p_client_id and provider='microsoft' order by updated_at desc limit 1),
      (select settings->>'mail' from public.crm_clients where id=p_client_id)
    ),
    'platform_app_stored',
      exists(select 1 from vault.secrets where name='microsoft_platform_client_id') and
      exists(select 1 from vault.secrets where name='microsoft_platform_client_secret'),
    'refresh_token_stored',exists(select 1 from vault.secrets where name='microsoft_refresh_token_' || p_client_id::text),
    'status',coalesce((select status from public.crm_integrations where client_id=p_client_id and provider='microsoft' order by updated_at desc limit 1),'not_configured'),
    'scope',coalesce((select config->'oauth'->>'scope' from public.crm_integrations where client_id=p_client_id and provider='microsoft' order by updated_at desc limit 1),''),
    'history_read',coalesce((select (config->>'history_read')::boolean from public.crm_integrations where client_id=p_client_id and provider='microsoft' order by updated_at desc limit 1),false),
    'redirect_uri','https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/microsoft-oauth-callback',
    'ready',
      exists(select 1 from vault.secrets where name='microsoft_platform_client_id') and
      exists(select 1 from vault.secrets where name='microsoft_platform_client_secret') and
      exists(select 1 from vault.secrets where name='microsoft_refresh_token_' || p_client_id::text)
  );
$$;

revoke all on function public.crm_set_microsoft_platform_app(text,text) from public,anon,authenticated;
revoke all on function public.crm_get_microsoft_platform_app() from public,anon,authenticated;
revoke all on function public.crm_get_microsoft_oauth_material(uuid) from public,anon,authenticated;
revoke all on function public.crm_set_microsoft_refresh_token(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.crm_get_microsoft_status(uuid) from public,anon,authenticated;

grant execute on function public.crm_set_microsoft_platform_app(text,text) to service_role;
grant execute on function public.crm_get_microsoft_platform_app() to service_role;
grant execute on function public.crm_get_microsoft_oauth_material(uuid) to service_role;
grant execute on function public.crm_set_microsoft_refresh_token(uuid,text,text,text) to service_role;
grant execute on function public.crm_get_microsoft_status(uuid) to service_role;
