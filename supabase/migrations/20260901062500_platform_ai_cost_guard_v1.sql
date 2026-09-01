-- Global OpenAI cost guard for Lead Manager SaaS.
-- This is an application-level hard stop in addition to per-plan fair-use limits.

create table if not exists public.crm_platform_ai_limits (
  id smallint primary key default 1 check (id = 1),
  paused boolean not null default false,
  hard_daily_ai_work_units integer not null default 60 check (hard_daily_ai_work_units >= 0),
  hard_monthly_ai_work_units integer not null default 1000 check (hard_monthly_ai_work_units >= 0),
  lead_hunter_daily_dispatch_cap integer not null default 12 check (lead_hunter_daily_dispatch_cap >= 0),
  lead_hunter_monthly_dispatch_cap integer not null default 200 check (lead_hunter_monthly_dispatch_cap >= 0),
  lead_hunter_cooldown_minutes integer not null default 10 check (lead_hunter_cooldown_minutes >= 0),
  note text,
  updated_at timestamptz not null default now()
);

insert into public.crm_platform_ai_limits(
  id,paused,hard_daily_ai_work_units,hard_monthly_ai_work_units,
  lead_hunter_daily_dispatch_cap,lead_hunter_monthly_dispatch_cap,
  lead_hunter_cooldown_minutes,note
) values (
  1,false,60,1000,12,200,10,
  'Launch safety cap. 1 Lead Hunter dispatch reserves 4 AI work units; enrichment and AI-mail each count as 1.'
) on conflict (id) do nothing;

alter table public.crm_platform_ai_limits enable row level security;
revoke all on table public.crm_platform_ai_limits from anon, authenticated;

create or replace function public.crm_platform_ai_budget_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cfg public.crm_platform_ai_limits%rowtype;
  v_day_search int:=0; v_month_search int:=0;
  v_day_enrich int:=0; v_month_enrich int:=0;
  v_day_mail int:=0; v_month_mail int:=0;
  v_pending_enrich int:=0; v_running_mail int:=0;
  v_day_units int:=0; v_month_units int:=0;
begin
  select * into v_cfg from public.crm_platform_ai_limits where id=1;
  if not found then
    v_cfg.id:=1; v_cfg.paused:=false; v_cfg.hard_daily_ai_work_units:=60; v_cfg.hard_monthly_ai_work_units:=1000;
    v_cfg.lead_hunter_daily_dispatch_cap:=12; v_cfg.lead_hunter_monthly_dispatch_cap:=200; v_cfg.lead_hunter_cooldown_minutes:=10;
  end if;

  select
    greatest(
      coalesce(sum(quantity) filter(where event_type='lead_search_dispatch' and occurred_at>=date_trunc('day',now())),0),
      coalesce(sum(quantity) filter(where event_type='lead_search_run' and occurred_at>=date_trunc('day',now())),0)
    )::int,
    greatest(
      coalesce(sum(quantity) filter(where event_type='lead_search_dispatch' and occurred_at>=date_trunc('month',now())),0),
      coalesce(sum(quantity) filter(where event_type='lead_search_run' and occurred_at>=date_trunc('month',now())),0)
    )::int,
    coalesce(sum(quantity) filter(where event_type='lead_enrichment' and occurred_at>=date_trunc('day',now())),0)::int,
    coalesce(sum(quantity) filter(where event_type='lead_enrichment' and occurred_at>=date_trunc('month',now())),0)::int,
    coalesce(sum(quantity) filter(where event_type='ai_mail_draft' and occurred_at>=date_trunc('day',now())),0)::int,
    coalesce(sum(quantity) filter(where event_type='ai_mail_draft' and occurred_at>=date_trunc('month',now())),0)::int
  into v_day_search,v_month_search,v_day_enrich,v_month_enrich,v_day_mail,v_month_mail
  from public.crm_usage_events;

  select count(*)::int into v_pending_enrich
  from public.crm_agent_requests
  where payload->>'action'='contact_enrichment' and status='queued';

  select count(*)::int into v_running_mail
  from public.crm_agent_runs
  where agent_name='AI Mail Assistant' and status='running';

  v_day_units := v_day_search*4 + v_day_enrich + v_day_mail + v_pending_enrich + v_running_mail;
  v_month_units := v_month_search*4 + v_month_enrich + v_month_mail + v_pending_enrich + v_running_mail;

  return jsonb_build_object(
    'paused',v_cfg.paused,
    'daily_units',v_day_units,
    'monthly_units',v_month_units,
    'daily_unit_cap',v_cfg.hard_daily_ai_work_units,
    'monthly_unit_cap',v_cfg.hard_monthly_ai_work_units,
    'lead_hunter_dispatches_today',v_day_search,
    'lead_hunter_dispatches_month',v_month_search,
    'lead_hunter_daily_dispatch_cap',v_cfg.lead_hunter_daily_dispatch_cap,
    'lead_hunter_monthly_dispatch_cap',v_cfg.lead_hunter_monthly_dispatch_cap,
    'pending_enrichments',v_pending_enrich,
    'running_ai_mail',v_running_mail
  );
end;
$function$;
revoke all on function public.crm_platform_ai_budget_snapshot() from public, anon, authenticated;
grant execute on function public.crm_platform_ai_budget_snapshot() to service_role;

create or replace function public.get_openai_api_secret(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public','vault'
as $function$
declare
  v_cfg public.crm_platform_ai_limits%rowtype;
  v_budget jsonb;
  v_secret text;
begin
  select * into v_cfg from public.crm_platform_ai_limits where id=1;
  if found and v_cfg.paused then return null; end if;

  v_budget := public.crm_platform_ai_budget_snapshot();
  if coalesce((v_budget->>'daily_units')::int,0) > coalesce((v_budget->>'daily_unit_cap')::int,60)
     or coalesce((v_budget->>'monthly_units')::int,0) > coalesce((v_budget->>'monthly_unit_cap')::int,1000) then
    return null;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='openai_api_' || p_client_id::text
  limit 1;
  return v_secret;
end;
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
  v_uncontacted int:=0;
  v_ny int:=0;
  v_recent_running boolean:=false;
  v_recent_search boolean:=false;
  v_recent_dispatch boolean:=false;
  v_request_id bigint;
  v_window interval;
  v_client_daily int:=0;
  v_client_daily_cap int:=4;
  v_global_day int:=0;
  v_global_month int:=0;
  v_cfg public.crm_platform_ai_limits%rowtype;
  v_budget jsonb;
begin
  if p_client_id is null then return null; end if;

  select * into v_cfg from public.crm_platform_ai_limits where id=1;
  if found and v_cfg.paused then return null; end if;

  select coalesce(daily_search_run_limit,4) into v_client_daily_cap
  from public.crm_usage_limits where client_id=p_client_id;
  v_client_daily_cap:=coalesce(v_client_daily_cap,4);

  select coalesce(sum(quantity),0)::int into v_client_daily
  from public.crm_usage_events
  where client_id=p_client_id and event_type='lead_search_run' and occurred_at>=date_trunc('day',now());
  if not p_force_dry_run and v_client_daily>=v_client_daily_cap then return null; end if;

  select count(*) into v_ny from public.crm_leads where client_id=p_client_id and status='NY';

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

  if not p_force_dry_run and v_ny>=12 then
    v_window := case when v_uncontacted<=8 then interval '6 hours' else interval '7 days' end;
    select exists(
      select 1 from public.crm_agent_runs
      where client_id=p_client_id
        and agent_name='Autonomous Lead Hunter v2'
        and coalesce((input->>'force_dry_run')::boolean,false)=false
        and started_at>now()-v_window
    ) into v_recent_search;
    if v_recent_search then return null; end if;
  end if;

  select exists(
    select 1 from public.crm_agent_runs
    where client_id=p_client_id
      and agent_name='Autonomous Lead Hunter v2'
      and started_at>now()-interval '30 minutes'
      and status in ('queued','running')
  ) into v_recent_running;
  if v_recent_running then return null; end if;

  if not p_force_dry_run then
    select exists(
      select 1 from public.crm_usage_events
      where client_id=p_client_id and event_type='lead_search_dispatch'
        and occurred_at>now()-make_interval(mins=>coalesce(v_cfg.lead_hunter_cooldown_minutes,10))
    ) into v_recent_dispatch;
    if v_recent_dispatch then return null; end if;

    select coalesce(sum(quantity),0)::int into v_global_day
    from public.crm_usage_events where event_type='lead_search_dispatch' and occurred_at>=date_trunc('day',now());
    select coalesce(sum(quantity),0)::int into v_global_month
    from public.crm_usage_events where event_type='lead_search_dispatch' and occurred_at>=date_trunc('month',now());
    if v_global_day>=coalesce(v_cfg.lead_hunter_daily_dispatch_cap,12)
       or v_global_month>=coalesce(v_cfg.lead_hunter_monthly_dispatch_cap,200) then return null; end if;

    v_budget:=public.crm_platform_ai_budget_snapshot();
    if coalesce((v_budget->>'daily_units')::int,0)+4>coalesce((v_budget->>'daily_unit_cap')::int,60)
       or coalesce((v_budget->>'monthly_units')::int,0)+4>coalesce((v_budget->>'monthly_unit_cap')::int,1000) then return null; end if;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='autonomous_lead_hunter_v2_secret'
  limit 1;
  if v_secret is null or btrim(v_secret)='' then raise exception 'Autonomous Lead Hunter v2 secret missing'; end if;

  if not p_force_dry_run then
    insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
    values(p_client_id,'lead_search_dispatch',1,jsonb_build_object('reason',case when v_ny<12 then 'refill_ny' else 'scheduled' end,'ny_count',v_ny,'guard','platform_ai_cost_guard_v1'));
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
    select count(*) into v_ny from public.crm_leads where client_id=new.client_id and status='NY';
    if v_ny<12 then
      v_promoted:=public.crm_promote_ready_candidates(new.client_id,12);
      select count(*) into v_ny from public.crm_leads where client_id=new.client_id and status='NY';
      if v_ny<12 then perform public.dispatch_autonomous_lead_hunter_v2_for_client(new.client_id,false); end if;
    end if;
  end if;
  return new;
end;
$function$;
