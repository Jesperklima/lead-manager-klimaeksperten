-- Lead Filter v2
-- Goals:
-- 1) Do not require a documented buying signal when the customer explicitly selected
--    company_targets ("Virksomheder jeg kan sælge til").
-- 2) Keep customer-defined employee min/max as a hard gate when configured.
-- 3) Preserve legacy customer profiles that pre-date lead_search_profile metadata.
-- 4) Keep duplicate protection, monthly lead limits and verified capability matching.

create or replace function public.crm_promote_ready_candidates(
  p_client_id uuid,
  p_target_min integer default 12
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ny int;
  v_promoted int := 0;
  v_delivered int := 0;
  v_limit int := 100;
  v_profile_version text;
  v_owner text;
  v_search_profile jsonb := '{}'::jsonb;
  v_lead_modes jsonb := '[]'::jsonb;
  v_profile_has_modes boolean := false;
  v_company_targets boolean := false;
  v_employee_min int := null;
  v_employee_max int := null;
  v_employee_gate boolean := false;
  r record;
  v_company uuid;
  v_lead uuid;
  v_matched text;
begin
  select
    coalesce(settings->'capability_profile'->>'version',''),
    nullif(settings->>'default_owner_name',''),
    coalesce(settings->'lead_search_profile','{}'::jsonb)
  into v_profile_version, v_owner, v_search_profile
  from public.crm_clients
  where id = p_client_id;

  if not found then
    raise exception 'Client not found';
  end if;

  v_lead_modes := coalesce(v_search_profile->'lead_modes','[]'::jsonb);
  v_profile_has_modes := jsonb_typeof(v_lead_modes) = 'array' and jsonb_array_length(v_lead_modes) > 0;
  v_company_targets := v_lead_modes ? 'company_targets';

  if coalesce(v_search_profile #>> '{employee_range,min}','') ~ '^\d+$' then
    v_employee_min := (v_search_profile #>> '{employee_range,min}')::int;
  end if;
  if coalesce(v_search_profile #>> '{employee_range,max}','') ~ '^\d+$' then
    v_employee_max := (v_search_profile #>> '{employee_range,max}')::int;
  end if;
  v_employee_gate := v_employee_min is not null or v_employee_max is not null;

  select coalesce(monthly_lead_limit,100)
  into v_limit
  from public.crm_usage_limits
  where client_id = p_client_id;
  v_limit := coalesce(v_limit,100);

  select coalesce(sum(quantity),0)::int
  into v_delivered
  from public.crm_usage_events
  where client_id = p_client_id
    and event_type = 'lead_delivered'
    and occurred_at >= date_trunc('month',now());

  if v_delivered >= v_limit then
    return 0;
  end if;

  select count(*)
  into v_ny
  from public.crm_leads
  where client_id = p_client_id
    and status = 'NY';

  p_target_min := greatest(0,least(40,p_target_min));

  -- If employee limits are configured, candidates with a verified numeric employee
  -- count outside the range are objectively invalid and must never be promoted.
  if v_employee_gate then
    update public.crm_lead_candidates
    set
      status = 'rejected',
      metadata = metadata || jsonb_build_object(
        'reject_reason','employee_count_outside_customer_range',
        'configured_employee_min',v_employee_min,
        'configured_employee_max',v_employee_max,
        'filter_version','lead_filter_v2'
      ),
      last_seen_at = now()
    where client_id = p_client_id
      and status = 'ready'
      and coalesce(metadata->>'employee_count','') ~ '^\d+$'
      and (
        (v_employee_min is not null and (metadata->>'employee_count')::int < v_employee_min)
        or
        (v_employee_max is not null and (metadata->>'employee_count')::int > v_employee_max)
      );
  end if;

  while v_ny < p_target_min and v_delivered < v_limit loop
    select *
    into r
    from public.crm_lead_candidates
    where client_id = p_client_id
      and status = 'ready'
      and (v_profile_version = '' or metadata->>'capability_profile_version' = v_profile_version)
      and coalesce(metadata->>'matched_capability','') <> ''

      -- For new self-service customer profiles, a company target must be a buyer/user.
      -- Legacy profiles are allowed to omit candidate_role because that metadata did
      -- not exist when their candidates were created.
      and (
        not v_company_targets
        or coalesce(metadata->>'candidate_role','buyer_user') = 'buyer_user'
      )

      -- Customer-defined employee limits are hard requirements. Unknown employee
      -- count is not guessed; the candidate remains ready for later verification.
      and (
        not v_employee_gate
        or (
          coalesce(metadata->>'employee_count','') ~ '^\d+$'
          and (v_employee_min is null or (metadata->>'employee_count')::int >= v_employee_min)
          and (v_employee_max is null or (metadata->>'employee_count')::int <= v_employee_max)
        )
      )

      -- The previous filter required special metadata even for ordinary prospecting.
      -- That incorrectly blocked relevant company targets. A buying signal is only
      -- required when the profile has lead modes but does NOT include company_targets.
      and (
        not v_profile_has_modes
        or v_company_targets
        or lower(coalesce(metadata->>'primary_trigger_or_segment','false')) = 'true'
        or lower(coalesce(metadata->>'documented_need_verified','false')) = 'true'
        or coalesce(metadata->>'lead_mode','') in ('documented_need','projects','tenders')
      )
    order by discovery_score desc, last_verified_at desc, discovered_at asc
    limit 1
    for update skip locked;

    exit when r.id is null;

    v_matched := coalesce(r.metadata->>'matched_capability','');

    v_company := null;
    select id
    into v_company
    from public.crm_companies
    where client_id = p_client_id
      and (
        (r.domain is not null and lower(coalesce(domain,'')) = lower(r.domain))
        or
        (lower(name) = lower(r.name) and lower(coalesce(address,'')) = lower(coalesce(r.address,'')))
      )
    order by created_at asc
    limit 1;

    if v_company is not null then
      if exists(
        select 1
        from public.crm_leads
        where client_id = p_client_id
          and company_id = v_company
          and status not in ('TABT','IKKE RELEVANT')
      ) then
        update public.crm_lead_candidates
        set
          status = 'rejected',
          metadata = metadata || jsonb_build_object(
            'reject_reason','duplicate_at_promotion',
            'filter_version','lead_filter_v2'
          ),
          last_seen_at = now()
        where id = r.id;
        continue;
      end if;
    else
      insert into public.crm_companies(
        client_id,name,domain,website_url,address,industry,company_summary,
        relationship_status,research_updated_at
      )
      values(
        p_client_id,r.name,r.domain,r.website_url,r.address,r.industry,r.why_relevant,
        'prospect',now()
      )
      returning id into v_company;

      insert into public.crm_field_evidence(
        client_id,company_id,entity_type,entity_id,field_name,field_value,
        source_url,source_type,verification_method,source_excerpt,verified,
        verified_at,observed_at,metadata
      )
      values
        (
          p_client_id,v_company,'company',v_company,'name',r.name,r.source_url,
          'web','exact_source_text',r.evidence_text,true,now(),now(),
          jsonb_build_object('agent','Autonomous Lead Hunter','candidate_id',r.id)
        ),
        (
          p_client_id,v_company,'company',v_company,'address',coalesce(r.address,''),r.source_url,
          'web','exact_source_text',r.evidence_text,true,now(),now(),
          jsonb_build_object('agent','Autonomous Lead Hunter','candidate_id',r.id)
        );
    end if;

    insert into public.crm_leads(
      client_id,company_id,status,source,next_action,next_at,planning_type,owner_name,
      source_url,source_reference,source_matched_capability,source_scope_verified,
      source_qualification_verified,source_verification_evidence
    )
    values(
      p_client_id,v_company,'NY','Autonomous Lead Hunter · verified',
      'Vurder leadet og find den rette beslutningstager',now()+interval '1 day',
      'flexible',v_owner,r.source_url,r.id::text,v_matched,true,true,
      jsonb_build_object(
        'candidate_id',r.id,
        'geography_verified',true,
        'capability_profile_version',v_profile_version,
        'matched_capability',v_matched,
        'filter_version','lead_filter_v2'
      )
    )
    returning id into v_lead;

    insert into public.crm_sales_intelligence(
      client_id,company_id,lead_id,signal_type,title,summary,conversation_angle,
      recommended_action,relevance_score,confidence,source_type,source_url,
      source_label,observed_at,verified,metadata
    )
    values(
      p_client_id,v_company,v_lead,'discovery_relevance',
      'Hvorfor virksomheden matcher kundeprofilen',r.why_relevant,
      'Tag første kontakt via en verificeret kanal og afklar behovet.',
      'Find den rette beslutningstager og verificér behov før videre salgsarbejde.',
      r.discovery_score,'medium','web',r.source_url,'Lead Hunter dokumentationskilde',
      now(),true,
      jsonb_build_object(
        'agent','Autonomous Lead Hunter',
        'candidate_id',r.id,
        'matched_capability',v_matched,
        'filter_version','lead_filter_v2'
      )
    );

    update public.crm_lead_candidates
    set
      status = 'promoted',
      company_id = v_company,
      lead_id = v_lead,
      promoted_at = now(),
      last_seen_at = now(),
      metadata = metadata || jsonb_build_object('filter_version','lead_filter_v2')
    where id = r.id;

    insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
    values(
      p_client_id,'lead_delivered',1,
      jsonb_build_object('lead_id',v_lead,'candidate_id',r.id,'filter_version','lead_filter_v2')
    );

    perform public.crm_recalculate_lead_score(v_lead);

    v_promoted := v_promoted + 1;
    v_ny := v_ny + 1;
    v_delivered := v_delivered + 1;
  end loop;

  return v_promoted;
end;
$function$;
