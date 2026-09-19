create or replace function public.crm_session_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
declare
  uid uuid:=auth.uid();
  adm boolean;
  m record;
  life text;
  plan_ctx jsonb;
begin
  if uid is null then
    return jsonb_build_object('authenticated',false,'next_route','login');
  end if;

  select public.crm_is_platform_admin() into adm;
  if adm then
    return jsonb_build_object(
      'authenticated',true,
      'role','platform_admin',
      'platform_admin',true,
      'next_route','app'
    );
  end if;

  select u.client_id,u.role,u.email,c.name into m
  from public.crm_users u
  join public.crm_clients c on c.id=u.client_id
  where u.auth_user_id=uid and u.active
  order by u.created_at
  limit 1;

  if m.client_id is null then
    return jsonb_build_object(
      'authenticated',true,
      'role','none',
      'platform_admin',false,
      'next_route','denied'
    );
  end if;

  select to_jsonb(l)-'client_id'
    into plan_ctx
  from public.crm_usage_limits l
  where l.client_id=m.client_id;

  life:=public.crm_workspace_lifecycle(m.client_id);

  return jsonb_build_object(
    'authenticated',true,
    'role',case when m.role='owner' then 'workspace_owner' when m.role='admin' then 'workspace_admin' else 'workspace_user' end,
    'platform_admin',false,
    'workspace_id',m.client_id,
    'workspace_name',m.name,
    'workspace_status',life,
    'plan',plan_ctx,
    'next_route',case when life='ACTIVE' then 'app' else 'onboarding' end
  );
end
$function$;
