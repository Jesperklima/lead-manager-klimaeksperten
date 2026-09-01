-- Keep each tenant's NY lead pool replenished without reusing the old global dispatcher.

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
  v_recent_running boolean;
  v_recent_search boolean;
  v_recent_dispatch boolean;
  v_request_id bigint;
  v_window interval;
begin
  if p_client_id is null then return null; end if;

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
    if v_ny < 12 then
      select exists(
        select 1 from public.crm_usage_events
        where client_id=p_client_id
          and event_type='lead_search_dispatch'
          and occurred_at > now()-interval '2 minutes'
      ) into v_recent_dispatch;
      if v_recent_dispatch then return null; end if;
    else
      v_window := case when v_uncontacted <= 8 then interval '6 hours' else interval '7 days' end;
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
        'reason',(case when v_ny<12 then 'ny_below_12' else 'scheduled_or_capacity' end),
        'ny_count',v_ny
      )
    );
  end if;

  select net.http_post(
    url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/autonomous-lead-hunter-v2',
    body := jsonb_build_object('client_id',p_client_id::text,'force_dry_run',p_force_dry_run),
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
  v_promoted int;
begin
  if old.status='NY' and new.status is distinct from old.status then
    select count(*) into v_ny
    from public.crm_leads
    where client_id=new.client_id and status='NY';

    if v_ny<12 then
      v_promoted:=public.crm_promote_ready_candidates(new.client_id,12);
      select count(*) into v_ny
      from public.crm_leads
      where client_id=new.client_id and status='NY';

      if v_ny<12 then
        perform public.dispatch_autonomous_lead_hunter_v2_for_client(new.client_id,false);
      end if;
    end if;
  end if;
  return new;
end;
$function$;
