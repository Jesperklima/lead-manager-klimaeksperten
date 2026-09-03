-- Do not add the internal bootstrap client to its own managed-client access list.
do $fix$
declare
  v_def text;
begin
  select pg_get_functiondef('public.crm_skarp_provision_workspace(uuid,uuid,text,boolean,boolean,jsonb)'::regprocedure)
    into v_def;
  if position('where u.client_id=p_bootstrap_client_id and u.active and u.auth_user_id is not null' in v_def)=0 then
    raise exception 'Expected admin access clause was not found in crm_skarp_provision_workspace';
  end if;
  v_def:=replace(
    v_def,
    'where u.client_id=p_bootstrap_client_id and u.active and u.auth_user_id is not null',
    'where u.client_id=p_bootstrap_client_id and v_client_id<>p_bootstrap_client_id and u.active and u.auth_user_id is not null'
  );
  execute v_def;
end
$fix$;

-- Clean up any self-mapping created before this fix.
delete from public.crm_admin_client_access a
using public.crm_users u, public.crm_usage_limits l
where a.auth_user_id=u.auth_user_id
  and a.client_id=u.client_id
  and u.client_id=l.client_id
  and u.active
  and lower(coalesce(u.role,'')) in ('owner','admin')
  and l.plan_code='internal';
