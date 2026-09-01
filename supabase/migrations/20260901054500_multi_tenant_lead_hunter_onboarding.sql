-- Multi-tenant Lead Hunter dispatch and onboarding v3 candidate promotion.

create or replace function public.dispatch_autonomous_lead_hunter_v2_for_client(
  p_client_id uuid,
  p_force_dry_run boolean default false
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_secret text;
  v_uncontacted int;
  v_recent_running boolean;
  v_recent_search boolean;
  v_request_id bigint;
  v_window interval;
begin
  if p_client_id is null then return null; end if;

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

create or replace function public.dispatch_autonomous_lead_hunter_v2(
  p_force_dry_run boolean default false
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  r record;
  v_req bigint;
  v_last bigint;
begin
  for r in
    select c.id
    from public.crm_clients c
    join public.crm_usage_limits l on l.client_id=c.id
    where l.plan_code in ('start','pro','business','internal')
      and (l.plan_code='internal' or c.settings #>> '{saas,lead_hunter_enabled}' = 'true')
  loop
    v_req := public.dispatch_autonomous_lead_hunter_v2_for_client(r.id,p_force_dry_run);
    if v_req is not null then v_last := v_req; end if;
  end loop;
  return v_last;
end;
$function$;

create or replace function public.crm_promote_ready_candidates(p_client_id uuid, p_target_min integer default 12)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ny int; v_promoted int:=0; v_delivered int:=0; v_limit int:=100; v_profile_version text; v_owner text;
  r record; v_company uuid; v_lead uuid; v_matched text;
begin
  select coalesce((settings->'capability_profile'->>'version'),''),nullif(settings->>'default_owner_name','')
  into v_profile_version,v_owner
  from public.crm_clients where id=p_client_id;
  if not found then raise exception 'Client not found'; end if;

  select coalesce(monthly_lead_limit,100) into v_limit
  from public.crm_usage_limits where client_id=p_client_id;
  v_limit:=coalesce(v_limit,100);

  select coalesce(sum(quantity),0)::int into v_delivered
  from public.crm_usage_events
  where client_id=p_client_id
    and event_type='lead_delivered'
    and occurred_at>=date_trunc('month',now());

  if v_delivered>=v_limit then return 0; end if;

  select count(*) into v_ny
  from public.crm_leads
  where client_id=p_client_id and status='NY';
  p_target_min:=greatest(0,least(40,p_target_min));

  while v_ny<p_target_min and v_delivered<v_limit loop
    select * into r
    from public.crm_lead_candidates
    where client_id=p_client_id and status='ready'
      and (v_profile_version='' or metadata->>'capability_profile_version'=v_profile_version)
      and (
        coalesce((metadata->>'primary_trigger_or_segment')::boolean,false)=true
        or (
          coalesce((metadata->>'search_strategy_enforced')::boolean,false)=true
          and coalesce(metadata->>'candidate_role','')='buyer_user'
          and coalesce(metadata->>'matched_capability','')<>''
        )
      )
    order by discovery_score desc,last_verified_at desc,discovered_at asc
    limit 1 for update skip locked;
    exit when r.id is null;

    v_matched:=coalesce(r.metadata->>'matched_capability','');
    if v_matched='' then
      update public.crm_lead_candidates
      set status='rejected',metadata=metadata||jsonb_build_object('reject_reason','missing_profile_match'),last_seen_at=now()
      where id=r.id;
      continue;
    end if;

    v_company:=null;
    select id into v_company
    from public.crm_companies
    where client_id=p_client_id
      and ((r.domain is not null and lower(coalesce(domain,''))=lower(r.domain))
        or (lower(name)=lower(r.name) and lower(coalesce(address,''))=lower(coalesce(r.address,''))))
    order by created_at asc limit 1;

    if v_company is not null then
      if exists(select 1 from public.crm_leads where client_id=p_client_id and company_id=v_company and status not in ('TABT','IKKE RELEVANT')) then
        update public.crm_lead_candidates
        set status='rejected',metadata=metadata||jsonb_build_object('reject_reason','duplicate_at_promotion'),last_seen_at=now()
        where id=r.id;
        continue;
      end if;
    else
      insert into public.crm_companies(client_id,name,domain,website_url,address,industry,company_summary,relationship_status,research_updated_at)
      values(p_client_id,r.name,r.domain,r.website_url,r.address,r.industry,r.why_relevant,'prospect',now())
      returning id into v_company;

      insert into public.crm_field_evidence(client_id,company_id,entity_type,entity_id,field_name,field_value,source_url,source_type,verification_method,source_excerpt,verified,verified_at,observed_at,metadata)
      values
        (p_client_id,v_company,'company',v_company,'name',r.name,r.source_url,'web','exact_source_text',r.evidence_text,true,now(),now(),jsonb_build_object('agent','Autonomous Lead Hunter','candidate_id',r.id)),
        (p_client_id,v_company,'company',v_company,'address',coalesce(r.address,''),r.source_url,'web','exact_source_text',r.evidence_text,true,now(),now(),jsonb_build_object('agent','Autonomous Lead Hunter','candidate_id',r.id));
    end if;

    insert into public.crm_leads(client_id,company_id,status,source,next_action,next_at,planning_type,owner_name,source_url,source_reference,source_matched_capability,source_scope_verified,source_qualification_verified,source_verification_evidence)
    values(p_client_id,v_company,'NY','Autonomous Lead Hunter · verified','Vurder leadet og find den rette beslutningstager',now()+interval '1 day','flexible',v_owner,r.source_url,r.id::text,v_matched,true,true,jsonb_build_object('candidate_id',r.id,'geography_verified',true,'capability_profile_version',v_profile_version,'matched_capability',v_matched))
    returning id into v_lead;

    insert into public.crm_sales_intelligence(client_id,company_id,lead_id,signal_type,title,summary,conversation_angle,recommended_action,relevance_score,confidence,source_type,source_url,source_label,observed_at,verified,metadata)
    values(p_client_id,v_company,v_lead,'discovery_relevance','Hvorfor virksomheden matcher kundeprofilen',r.why_relevant,'Tag første kontakt via en verificeret kanal og afklar behovet.','Find den rette beslutningstager og verificér behov før videre salgsarbejde.',r.discovery_score,'medium','web',r.source_url,'Lead Hunter dokumentationskilde',now(),true,jsonb_build_object('agent','Autonomous Lead Hunter','candidate_id',r.id,'matched_capability',v_matched));

    update public.crm_lead_candidates
    set status='promoted',company_id=v_company,lead_id=v_lead,promoted_at=now(),last_seen_at=now()
    where id=r.id;

    insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
    values(p_client_id,'lead_delivered',1,jsonb_build_object('lead_id',v_lead,'candidate_id',r.id));

    perform public.crm_recalculate_lead_score(v_lead);
    v_promoted:=v_promoted+1;
    v_ny:=v_ny+1;
    v_delivered:=v_delivered+1;
  end loop;

  return v_promoted;
end;
$function$;
