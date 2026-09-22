-- Fix lead-pool persistence and make the selected buffer self-healing.
-- The previous RPC referenced crm_clients.updated_at, but that column does not exist.
-- Saving the same target again now also repairs/refills an underfilled standard NY pool.

create or replace function public.crm_set_new_lead_pool_limit(
  p_client_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_old_limit integer;
  v_ny integer;
  v_promoted integer := 0;
  v_dispatch_id bigint := null;
begin
  if p_client_id is null then
    raise exception 'Kunde mangler';
  end if;

  if p_limit not in (10,20,30) then
    raise exception 'Lead-puljen skal være 10, 20 eller 30';
  end if;

  if auth.uid() is null or not public.crm_can_manage_workspace(p_client_id) then
    raise exception 'Kun ejer/admin eller Platform Owner kan ændre lead-puljen';
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
       )
     where id=p_client_id;

    insert into public.crm_activities(
      client_id,type,actor_type,actor_name,summary,metadata
    ) values (
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
    -- Increasing the setting fires trg_refill_ny_pool_setting_v1, which first
    -- promotes ready candidates and then dispatches Lead Hunter v3 if required.
  else
    -- Re-saving the same target must still heal an underfilled buffer.
    v_promoted:=public.crm_promote_ready_candidates(p_client_id,p_limit);

    select count(*) into v_ny
    from public.crm_leads
    where client_id=p_client_id
      and status='NY'
      and coalesce(lead_pool,'standard')='standard';

    if v_ny<p_limit then
      v_dispatch_id:=public.dispatch_autonomous_lead_hunter_v3_for_client(
        p_client_id,
        false,
        p_limit
      );
    end if;
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
    'refill_requested',v_ny<p_limit,
    'promoted',v_promoted,
    'dispatch_request_id',v_dispatch_id
  );
end
$$;

revoke all on function public.crm_set_new_lead_pool_limit(uuid,integer) from public;
grant execute on function public.crm_set_new_lead_pool_limit(uuid,integer) to authenticated;

comment on function public.crm_set_new_lead_pool_limit(uuid,integer)
is 'Tenant-scoped 10/20/30 standard NY lead-pool setting. Persists without nonexistent updated_at and self-heals an underfilled pool when the same target is saved again.';
