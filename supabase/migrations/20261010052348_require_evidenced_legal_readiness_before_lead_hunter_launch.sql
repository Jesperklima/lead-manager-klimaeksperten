create or replace function public.crm_lead_launch_status(p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.crm_client_legal_profiles%rowtype; plan text; reason text; accepted boolean:=false;
begin
 select plan_code into plan from public.crm_usage_limits where client_id=p_client_id;
 select * into p from public.crm_client_legal_profiles where client_id=p_client_id;
 if not found then reason:='legal_profile_missing';
 elsif plan='internal' and p.service_model='internal_controller' and p.legal_status='approved' and p.agreement_status='not_applicable' and not p.requires_legal_review then
   return jsonb_build_object('ready',true,'internal',true);
 elsif p.requires_legal_review or p.legal_status in ('draft','review_required','blocked') then reason:='legal_role_review_required';
 elsif p.agreement_status='accepted' then
   select exists(select 1 from public.crm_legal_agreement_acceptances a where a.client_id=p_client_id and a.agreement_type=p.agreement_type and a.agreement_version=p.agreement_version and a.accepted_at is not null and nullif(a.rendered_hash,'') is not null) into accepted;
   if not accepted then reason:='legal_agreement_evidence_missing';end if;
 elsif p.agreement_status='documented' and nullif(p.agreement_evidence_url,'') is not null and p.legal_reviewed_at is not null then accepted:=true;
 else reason:='legal_agreement_pending';end if;
 return jsonb_build_object('ready',reason is null and accepted,'reason',reason,'agreement_status',p.agreement_status);
end;$$;
revoke all on function public.crm_lead_launch_status(uuid) from public,anon,authenticated;
grant execute on function public.crm_lead_launch_status(uuid) to service_role;
create or replace function public.crm_guard_lead_launch_settings() returns trigger language plpgsql security definer set search_path=public as $$
declare launch jsonb;
begin
 if new.settings#>>'{saas,lead_hunter_enabled}'='true' then
   launch:=public.crm_lead_launch_status(new.id);
   if not coalesce((launch->>'ready')::boolean,false) then
     new.settings:=jsonb_set(coalesce(new.settings,'{}'),'{saas}',coalesce(new.settings->'saas','{}')||jsonb_build_object('lead_hunter_enabled',false,'legal_launch_blocked_reason',launch->>'reason'));
   end if;
 end if;return new;
end;$$;
revoke all on function public.crm_guard_lead_launch_settings() from public,anon,authenticated;
create trigger crm_guard_lead_launch_settings before insert or update of settings on public.crm_clients for each row execute function public.crm_guard_lead_launch_settings();
create or replace function public.crm_reconcile_legal_launch_profile() returns trigger language plpgsql security definer set search_path=public as $$
declare launch jsonb;
begin
 launch:=public.crm_lead_launch_status(new.client_id);
 update public.crm_clients set settings=jsonb_set(coalesce(settings,'{}'),'{saas}',coalesce(settings->'saas','{}')||jsonb_build_object('lead_hunter_enabled',coalesce((launch->>'ready')::boolean,false),'legal_launch_blocked_reason',launch->>'reason'))
 where id=new.client_id and settings#>>'{saas,onboarding_completed}'='true'
 and (settings#>>'{saas,legal_launch_blocked_reason}' like 'legal_%' or not coalesce((launch->>'ready')::boolean,false));
 return new;
end;$$;
revoke all on function public.crm_reconcile_legal_launch_profile() from public,anon,authenticated;
create trigger crm_reconcile_legal_launch_profile after insert or update on public.crm_client_legal_profiles for each row execute function public.crm_reconcile_legal_launch_profile();
update public.crm_clients c set settings=jsonb_set(coalesce(settings,'{}'),'{saas}',coalesce(settings->'saas','{}')||jsonb_build_object('lead_hunter_enabled',false,'legal_launch_blocked_reason',public.crm_lead_launch_status(c.id)->>'reason'))
where settings#>>'{saas,lead_hunter_enabled}'='true' and not coalesce((public.crm_lead_launch_status(c.id)->>'ready')::boolean,false);
CREATE OR REPLACE FUNCTION public.dispatch_autonomous_lead_hunter_v2_for_client(p_client_id uuid, p_force_dry_run boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
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
  if public.crm_openai_billing_circuit_active() or not coalesce((public.crm_lead_launch_status(p_client_id)->>'ready')::boolean,false) then return null; end if;

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
$function$
;
CREATE OR REPLACE FUNCTION public.dispatch_autonomous_lead_hunter_v3_for_client(p_client_id uuid, p_force_dry_run boolean DEFAULT false, p_target_active integer DEFAULT 15)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  v_secret text;
  v_request_id bigint;
begin
  if p_client_id is null then return null; end if;
  if public.crm_openai_billing_circuit_active() or not coalesce((public.crm_lead_launch_status(p_client_id)->>'ready')::boolean,false) then return null; end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='autonomous_lead_hunter_v2_secret'
  limit 1;
  if v_secret is null or btrim(v_secret)='' then
    raise exception 'Autonomous Lead Hunter secret missing';
  end if;
  select net.http_post(
    url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/autonomous-lead-hunter-v3',
    body := jsonb_build_object(
      'client_id',p_client_id::text,
      'force_dry_run',p_force_dry_run,
      'target_active',greatest(1,least(30,coalesce(p_target_active,15)))
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-autonomous-lead-hunter-secret',v_secret
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.dispatch_autonomous_lead_hunter_v3_adaptive(p_force_dry_run boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; v_request_id bigint; v_last bigint; v_ny int; v_recent boolean;
  v_daily int; v_daily_cap int; v_global_day int; v_global_month int;
  v_consumed_30d int; v_target int; v_refill_at int;
  v_cfg public.crm_platform_ai_limits%rowtype; v_budget jsonb;
begin
  if public.crm_openai_billing_circuit_active() then return null;end if;
  select * into v_cfg from public.crm_platform_ai_limits where id=1;
  if found and v_cfg.paused then return null; end if;

  for r in
    select c.id,c.name,c.settings
    from public.crm_clients c
    join public.crm_usage_limits l on l.client_id=c.id
    where l.plan_code in ('start','pro','business','internal')
      and (l.plan_code='internal' or c.settings #>> '{saas,lead_hunter_enabled}'='true')
  loop
    if not coalesce((public.crm_lead_launch_status(r.id)->>'ready')::boolean,false) then continue; end if;
    select count(*) into v_ny from public.crm_leads
      where client_id=r.id
        and coalesce(lead_pool,'standard')='standard'
        and status='NY';

    select count(*) into v_consumed_30d from public.crm_leads
      where client_id=r.id
        and coalesce(lead_pool,'standard')='standard'
        and updated_at>=now()-interval '30 days'
        and status in ('VUNDET','TABT','LUKKET');

    v_target:=coalesce(public.crm_new_lead_pool_limit(r.id),10);
    v_target:=least(30,greatest(10,v_target));
    v_refill_at:=v_target;

    if not p_force_dry_run and v_ny>=v_refill_at then continue; end if;

    select coalesce(daily_search_run_limit,4) into v_daily_cap from public.crm_usage_limits where client_id=r.id;
    v_daily_cap:=coalesce(v_daily_cap,4);
    select coalesce(sum(quantity),0)::int into v_daily from public.crm_usage_events
      where client_id=r.id and event_type='lead_search_run' and occurred_at>=date_trunc('day',now());
    if not p_force_dry_run and v_daily>=v_daily_cap then continue; end if;

    select exists(select 1 from public.crm_agent_runs where client_id=r.id
      and agent_name='Autonomous Lead Hunter v3' and started_at>now()-interval '30 minutes'
      and status in ('queued','running')) into v_recent;
    if v_recent then continue; end if;

    if not p_force_dry_run then
      select exists(select 1 from public.crm_usage_events where client_id=r.id
        and event_type='lead_search_dispatch'
        and occurred_at>now()-make_interval(mins=>coalesce(v_cfg.lead_hunter_cooldown_minutes,10))) into v_recent;
      if v_recent then continue; end if;

      select coalesce(sum(quantity),0)::int into v_global_day from public.crm_usage_events
        where event_type='lead_search_dispatch' and occurred_at>=date_trunc('day',now());
      select coalesce(sum(quantity),0)::int into v_global_month from public.crm_usage_events
        where event_type='lead_search_dispatch' and occurred_at>=date_trunc('month',now());
      if v_global_day>=coalesce(v_cfg.lead_hunter_daily_dispatch_cap,12)
         or v_global_month>=coalesce(v_cfg.lead_hunter_monthly_dispatch_cap,200) then continue; end if;

      v_budget:=public.crm_platform_ai_budget_snapshot();
      if coalesce((v_budget->>'daily_units')::int,0)+2>coalesce((v_budget->>'daily_unit_cap')::int,60)
         or coalesce((v_budget->>'monthly_units')::int,0)+2>coalesce((v_budget->>'monthly_unit_cap')::int,1000) then continue; end if;

      insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
      values(r.id,'lead_search_dispatch',1,jsonb_build_object(
        'reason','configured_new_pool_refill','ny_standard',v_ny,'refill_at',v_refill_at,
        'target',v_target,'consumed_30d',v_consumed_30d,'engine','v3','estimated_ai_units',2,
        'lead_pool','standard','quality_policy','hard_requirements_fixed_soft_signals_flexible'));
    end if;

    v_request_id:=public.dispatch_autonomous_lead_hunter_v3_for_client(r.id,p_force_dry_run,v_target);
    if v_request_id is not null then v_last:=v_request_id; end if;
  end loop;
  return v_last;
end;
$function$
;