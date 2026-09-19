-- Lead-pool UI backend
-- Tenant owners/admins can choose 10, 20 or 30 standard NY leads.
-- Increasing the pool refills through Lead Hunter v3; decreasing/same value does not dispatch.

create or replace function public.crm_set_new_lead_pool_limit(
  p_client_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','auth'
as $function$
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
$function$;

revoke all on function public.crm_set_new_lead_pool_limit(uuid,integer) from public, anon;
grant execute on function public.crm_set_new_lead_pool_limit(uuid,integer) to authenticated;

create or replace function public.trigger_refill_ny_pool_setting_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_limit int;
  v_new_limit int;
  v_ny int;
begin
  v_old_limit:=case
    when coalesce(old.settings->>'new_lead_pool_limit','') ~ '^(10|20|30)$'
      then (old.settings->>'new_lead_pool_limit')::integer
    else 10
  end;

  v_new_limit:=case
    when coalesce(new.settings->>'new_lead_pool_limit','') ~ '^(10|20|30)$'
      then (new.settings->>'new_lead_pool_limit')::integer
    else 10
  end;

  if v_new_limit>v_old_limit then
    perform public.crm_promote_ready_candidates(new.id,v_new_limit);

    select count(*) into v_ny
    from public.crm_leads
    where client_id=new.id
      and status='NY'
      and coalesce(lead_pool,'standard')='standard';

    if v_ny<v_new_limit then
      perform public.dispatch_autonomous_lead_hunter_v3_for_client(new.id,false,v_new_limit);
    end if;
  end if;

  return new;
end;
$function$;

comment on function public.crm_set_new_lead_pool_limit(uuid,integer)
is 'Tenant-scoped owner/admin RPC for selecting the standard NY lead pool size: 10, 20 or 30.';

comment on function public.trigger_refill_ny_pool_setting_v1()
is 'Refills the standard NY pool only when the configured limit increases; uses Lead Hunter v3.';
