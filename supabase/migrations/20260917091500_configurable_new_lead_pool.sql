-- Configurable per-tenant size for the "NY" lead pool.
-- Allowed values: 10, 20, 30. Default: 10.

create or replace function public.crm_new_lead_pool_limit(p_client_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when coalesce((c.settings->>'new_lead_pool_limit')::integer,10) in (10,20,30)
      then coalesce((c.settings->>'new_lead_pool_limit')::integer,10)
    else 10
  end
  from public.crm_clients c
  where c.id=p_client_id;
$function$;

create or replace function public.dispatch_autonomous_lead_hunter_v2_for_client(
  p_client_id uuid,
  p_force_dry_run boolean default false
)
returns bigint
language plpgsql
security definer
set search_path to 'public','vault'
as $function$
declare
  v_secret text;
  v_uncontacted int;
  v_ny int;
  v_pool_limit int;
  v_recent_running boolean;
  v_recent_search boolean;
  v_recent_dispatch boolean;
  v_request_id bigint;
  v_window interval;
begin
  if p_client_id is null then return null; end if;

  v_pool_limit:=coalesce(public.crm_new_lead_pool_limit(p_client_id),10);

  select count(*) into v_ny
  from public.crm_leads
  where client_id=p_client_id and status='NY';

  select count(*) into v_uncontacted
  from public.crm_leads l
  where l.client_id=p_client_id
    and l.status in ('NY','UNDER VURDERING','KLAR TIL KONTAKT')
    and not exists (
      select 1 from public.crm_activities a
      where a.lead_id=l.id
        and (lower(coalesce(a.type,'')) like '%opkald%' or lower(coalesce(a.type,'')) like '%mail%')
    )
    and not exists (
      select 1 from public.crm_mail_messages m
      where m.lead_id=l.id and lower(coalesce(m.direction,''))='outbound'
    );

  if not p_force_dry_run then
    if v_ny < v_pool_limit then
      select exists(
        select 1 from public.crm_usage_events
        where client_id=p_client_id
          and event_type='lead_search_dispatch'
          and occurred_at > now()-interval '2 minutes'
      ) into v_recent_dispatch;
      if v_recent_dispatch then return null; end if;
    else
      v_window := case when v_uncontacted <= greatest(6,v_pool_limit/2) then interval '6 hours' else interval '7 days' end;
      select exists(
        select 1 from public.crm_agent_runs
        where client_id=p_client_id
          and agent_name='Autonomous Lead Hunter v2'
          and coalesce((input->>'force_dry_run')::boolean,false)=false
          and started_at > now()-v_window
      ) into v_recent_search;
      if v_recent_search then return null; end if;
    end if;
  end if;

  select exists(
    select 1 from public.crm_agent_runs
    where client_id=p_client_id
      and agent_name='Autonomous Lead Hunter v2'
      and started_at>now()-interval '30 minutes'
      and status in ('queued','running')
  ) into v_recent_running;
  if v_recent_running then return null; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='autonomous_lead_hunter_v2_secret'
  limit 1;
  if v_secret is null or btrim(v_secret)='' then
    raise exception 'Autonomous Lead Hunter v2 secret missing';
  end if;

  if not p_force_dry_run then
    insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
    values(
      p_client_id,
      'lead_search_dispatch',
      1,
      jsonb_build_object(
        'reason',(case when v_ny<v_pool_limit then 'ny_below_configured_pool' else 'scheduled_or_capacity' end),
        'ny_count',v_ny,
        'new_lead_pool_limit',v_pool_limit
      )
    );
  end if;

  select net.http_post(
    url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/autonomous-lead-hunter-v2',
    body := jsonb_build_object(
      'client_id',p_client_id::text,
      'force_dry_run',p_force_dry_run,
      'new_lead_pool_limit',v_pool_limit
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','x-autonomous-lead-hunter-secret',v_secret),
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
end;
$function$;

create or replace function public.trigger_refill_ny_leads_v2()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ny int;
  v_pool_limit int;
  v_promoted int;
begin
  if old.status='NY' and new.status is distinct from old.status then
    v_pool_limit:=coalesce(public.crm_new_lead_pool_limit(new.client_id),10);

    select count(*) into v_ny
    from public.crm_leads
    where client_id=new.client_id and status='NY';

    if v_ny<v_pool_limit then
      v_promoted:=public.crm_promote_ready_candidates(new.client_id,v_pool_limit);
      select count(*) into v_ny
      from public.crm_leads
      where client_id=new.client_id and status='NY';

      if v_ny<v_pool_limit then
        perform public.dispatch_autonomous_lead_hunter_v2_for_client(new.client_id,false);
      end if;
    end if;
  end if;
  return new;
end;
$function$;

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
  v_old_limit:=case when coalesce((old.settings->>'new_lead_pool_limit')::integer,10) in (10,20,30)
    then coalesce((old.settings->>'new_lead_pool_limit')::integer,10) else 10 end;
  v_new_limit:=case when coalesce((new.settings->>'new_lead_pool_limit')::integer,10) in (10,20,30)
    then coalesce((new.settings->>'new_lead_pool_limit')::integer,10) else 10 end;

  if v_new_limit>v_old_limit then
    perform public.crm_promote_ready_candidates(new.id,v_new_limit);
    select count(*) into v_ny from public.crm_leads where client_id=new.id and status='NY';
    if v_ny<v_new_limit then
      perform public.dispatch_autonomous_lead_hunter_v2_for_client(new.id,false);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_refill_ny_pool_setting_v1 on public.crm_clients;
create trigger trg_refill_ny_pool_setting_v1
after update of settings on public.crm_clients
for each row
when (old.settings is distinct from new.settings)
execute function public.trigger_refill_ny_pool_setting_v1();
