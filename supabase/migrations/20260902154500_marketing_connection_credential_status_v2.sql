create or replace function public.crm_marketing_store_secret(p_connection_id uuid,p_kind text,p_value text)
returns void
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  v_conn public.crm_marketing_connections%rowtype;
  v_existing uuid;
  v_new uuid;
  v_name text;
  v_other_present boolean;
begin
  select * into v_conn from public.crm_marketing_connections where id=p_connection_id;
  if not found then raise exception 'Connection not found'; end if;
  if not public.crm_has_client_access(v_conn.client_id) then raise exception 'Access denied'; end if;
  if p_kind not in ('access_token','app_secret') then raise exception 'Unsupported secret kind'; end if;
  if nullif(btrim(p_value),'') is null then raise exception 'Secret cannot be empty'; end if;
  v_existing:=case when p_kind='access_token' then v_conn.access_secret_id else v_conn.app_secret_id end;
  v_name:='marketing_'||p_connection_id::text||'_'||p_kind;
  if v_existing is null then
    v_new:=vault.create_secret(p_value,v_name,'Lead Manager marketing connection secret');
  else
    perform vault.update_secret(v_existing,p_value,v_name,'Lead Manager marketing connection secret');
    v_new:=v_existing;
  end if;
  if p_kind='access_token' then
    v_other_present := v_conn.app_secret_id is not null;
    update public.crm_marketing_connections
    set access_secret_id=v_new,
        status=case when platform in ('meta','linkedin') and not v_other_present then 'needs_credentials' else 'connected' end,
        last_error=null
    where id=p_connection_id;
  else
    v_other_present := v_conn.access_secret_id is not null;
    update public.crm_marketing_connections
    set app_secret_id=v_new,
        status=case when platform in ('meta','linkedin') and not v_other_present then 'needs_credentials' else 'connected' end,
        last_error=null
    where id=p_connection_id;
  end if;
end;
$$;
grant execute on function public.crm_marketing_store_secret(uuid,text,text) to authenticated;
