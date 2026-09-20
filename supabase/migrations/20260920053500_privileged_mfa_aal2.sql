-- Require MFA (AAL2) for privileged Lead Manager sessions.
-- Ordinary workspace members remain compatible with AAL1.

create or replace function public.crm_privileged_mfa_required()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and (
      public.crm_is_platform_admin()
      or exists (
        select 1
        from public.crm_users u
        where u.auth_user_id = auth.uid()
          and u.active
          and lower(coalesce(u.role,'')) in ('owner','admin')
      )
    );
$$;

create or replace function public.crm_mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    not public.crm_privileged_mfa_required()
    or coalesce(auth.jwt()->>'aal','aal1') = 'aal2';
$$;

revoke all on function public.crm_privileged_mfa_required() from public, anon;
revoke all on function public.crm_mfa_satisfied() from public, anon;
grant execute on function public.crm_privileged_mfa_required() to authenticated, service_role;
grant execute on function public.crm_mfa_satisfied() to authenticated, service_role;

create or replace function public.crm_has_client_access(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    public.crm_mfa_satisfied()
    and (
      (
        public.crm_workspace_lifecycle(p_client_id)='ACTIVE'
        and (
          exists(
            select 1 from public.crm_users u
            where u.client_id=p_client_id
              and u.active
              and u.auth_user_id=auth.uid()
          )
          or exists(
            select 1 from public.crm_admin_client_access a
            where a.client_id=p_client_id
              and a.auth_user_id=auth.uid()
          )
        )
      )
      or public.crm_is_platform_admin()
    );
$$;

create or replace function public.crm_internal_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    public.crm_mfa_satisfied()
    and exists(
      select 1
      from public.crm_users u
      join public.crm_usage_limits l on l.client_id=u.client_id
      where u.active
        and u.auth_user_id=auth.uid()
        and lower(coalesce(u.role,'')) in ('owner','admin')
        and l.plan_code='internal'
    );
$$;

create or replace function public.crm_session_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  uid uuid:=auth.uid();
  adm boolean;
  m record;
  life text;
  plan_ctx jsonb;
  current_aal text:=coalesce(auth.jwt()->>'aal','aal1');
  privileged boolean:=false;
  mapped_role text;
begin
  if uid is null then
    return jsonb_build_object('authenticated',false,'next_route','login');
  end if;

  select public.crm_is_platform_admin() into adm;
  if adm then
    if current_aal <> 'aal2' then
      return jsonb_build_object(
        'authenticated',true,
        'role','platform_admin',
        'platform_admin',true,
        'mfa_required',true,
        'mfa_satisfied',false,
        'aal',current_aal,
        'next_route','mfa'
      );
    end if;

    return jsonb_build_object(
      'authenticated',true,
      'role','platform_admin',
      'platform_admin',true,
      'mfa_required',true,
      'mfa_satisfied',true,
      'aal',current_aal,
      'next_route','app'
    );
  end if;

  select
    u.client_id,
    u.role,
    u.email,
    u.active,
    u.created_at,
    u.auth_user_id,
    c.name,
    to_jsonb(c) as client_ctx
  into m
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
      'mfa_required',false,
      'mfa_satisfied',true,
      'aal',current_aal,
      'next_route','denied'
    );
  end if;

  mapped_role:=case
    when m.role='owner' then 'workspace_owner'
    when m.role='admin' then 'workspace_admin'
    else 'workspace_user'
  end;
  privileged:=lower(coalesce(m.role,'')) in ('owner','admin');

  if privileged and current_aal <> 'aal2' then
    return jsonb_build_object(
      'authenticated',true,
      'role',mapped_role,
      'platform_admin',false,
      'workspace_id',m.client_id,
      'workspace_name',m.name,
      'mfa_required',true,
      'mfa_satisfied',false,
      'aal',current_aal,
      'next_route','mfa'
    );
  end if;

  select to_jsonb(l)-'client_id'
    into plan_ctx
  from public.crm_usage_limits l
  where l.client_id=m.client_id;

  life:=public.crm_workspace_lifecycle(m.client_id);

  return jsonb_build_object(
    'authenticated',true,
    'role',mapped_role,
    'platform_admin',false,
    'workspace_id',m.client_id,
    'workspace_name',m.name,
    'workspace_status',life,
    'plan',plan_ctx,
    'client',m.client_ctx,
    'membership',jsonb_build_object(
      'email',m.email,
      'client_id',m.client_id,
      'role',m.role,
      'active',m.active,
      'created_at',m.created_at,
      'auth_user_id',m.auth_user_id
    ),
    'mfa_required',privileged,
    'mfa_satisfied',true,
    'aal',current_aal,
    'next_route',case when life='ACTIVE' then 'app' else 'onboarding' end
  );
end
$$;

create or replace function public.crm_set_new_lead_pool_limit(p_client_id uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_old_limit integer;
  v_ny integer;
begin
  if p_client_id is null then
    raise exception 'Kunde mangler';
  end if;

  if p_limit not in (10,20,30) then
    raise exception 'Lead-puljen skal være 10, 20 eller 30';
  end if;

  if auth.uid() is null then
    raise exception 'Login kræves';
  end if;

  if not public.crm_mfa_satisfied() then
    raise exception 'MFA-verifikation kræves for ejer/admin';
  end if;

  if not exists (
    select 1
    from public.crm_users u
    where u.client_id=p_client_id
      and u.auth_user_id=auth.uid()
      and u.active
      and lower(coalesce(u.role,'')) in ('owner','admin')
  ) then
    raise exception 'Kun ejer/admin kan ændre lead-puljen';
  end if;

  select public.crm_new_lead_pool_limit(p_client_id)
    into v_old_limit;

  if v_old_limit is distinct from p_limit then
    update public.crm_clients
       set settings=jsonb_set(
         coalesce(settings,'{}'::jsonb),
         '{new_lead_pool_limit}',
         to_jsonb(p_limit),
         true
       ),
       updated_at=now()
     where id=p_client_id;

    insert into public.crm_activities(
      client_id,type,actor_type,actor_name,summary,metadata
    )
    values(
      p_client_id,
      'Lead settings',
      'user',
      coalesce(auth.jwt()->>'email',auth.uid()::text),
      format('Ny lead-pulje ændret fra %s til %s',v_old_limit,p_limit),
      jsonb_build_object(
        'setting','new_lead_pool_limit',
        'old_value',v_old_limit,
        'new_value',p_limit
      )
    );
  end if;

  select count(*) into v_ny
  from public.crm_leads
  where client_id=p_client_id
    and status='NY'
    and coalesce(lead_pool,'standard')='standard';

  return jsonb_build_object(
    'ok',true,
    'client_id',p_client_id,
    'old_limit',v_old_limit,
    'new_limit',p_limit,
    'current_ny',v_ny,
    'refill_requested',p_limit>v_old_limit
  );
end;
$$;
