-- Lead Filter v2 — production-aligned migration
-- 2026-09-19
--
-- Guarantees:
-- - company_targets do not require a buying signal.
-- - configured employee min/max are hard promotion gates.
-- - unknown employee count is never guessed or promoted when a gate is configured.
-- - company targets must match selected industries/customer types and be buyer/users.
-- - documented_need stays out of the standard lead pool.
-- - duplicate protection, monthly limits, standard lead_pool and current production behavior are preserved.
--
-- Production smoke coverage before merge:
-- 1) 41 employees against Minuba max=40 => rejected.
-- 2) VVS against Minuba target segments => rejected.
-- 3) Maler / 20 employees, no buying signal => promoted to standard.
-- 4) Unknown employee count => held in ready.

CREATE OR REPLACE FUNCTION public.crm_promote_ready_candidates(p_client_id uuid, p_target_min integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ny int;
  v_promoted int := 0;
  v_delivered int := 0;
  v_limit int := 100;
  v_profile_version text;
  v_owner text;
  v_search_profile jsonb := '{}'::jsonb;
  v_lead_modes jsonb := '[]'::jsonb;
  v_target_terms jsonb := '[]'::jsonb;
  v_profile_has_modes boolean := false;
  v_company_targets boolean := false;
  v_employee_min int := null;
  v_employee_max int := null;
  v_employee_gate boolean := false;
  v_has_target_terms boolean := false;
  r record;
  v_company uuid;
  v_lead uuid;
  v_matched text;
begin
  select
    coalesce(settings->'capability_profile'->>'version',''),
    nullif(settings->>'default_owner_name',''),
    coalesce(settings->'capability_profile'->'search_strategy', settings->'lead_search_profile', '{}'::jsonb)
  into v_profile_version, v_owner, v_search_profile
  from public.crm_clients
  where id = p_client_id;

  if not found then
    raise exception 'Client not found';
  end if;

  v_lead_modes := coalesce(v_search_profile->'lead_modes','[]'::jsonb);
  v_profile_has_modes := jsonb_typeof(v_lead_modes)='array' and jsonb_array_length(v_lead_modes)>0;
  v_company_targets := jsonb_typeof(v_lead_modes)='array' and v_lead_modes ? 'company_targets';

  v_target_terms :=
    coalesce(v_search_profile->'industries','[]'::jsonb)
    || coalesce(v_search_profile->'customer_types','[]'::jsonb);
  v_has_target_terms := jsonb_typeof(v_target_terms)='array' and jsonb_array_length(v_target_terms)>0;

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
  where client_id=p_client_id;
  v_limit := coalesce(v_limit,100);

  select coalesce(sum(quantity),0)::int
  into v_delivered
  from public.crm_usage_events
  where client_id=p_client_id
    and event_type='lead_delivered'
    and occurred_at>=date_trunc('month',now());

  if v_delivered>=v_limit then
    return 0;
  end if;

  select count(*)
  into v_ny
  from public.crm_leads
  where client_id=p_client_id
    and status='NY'
    and coalesce(lead_pool,'standard')='standard';

  p_target_min := greatest(0,least(40,p_target_min));

  -- Hard employee gate: known values outside the customer's range are invalid.
  if v_employee_gate then
    update public.crm_lead_candidates
    set
      status='rejected',
      metadata=metadata || jsonb_build_object(
        'reject_reason','employee_count_outside_customer_range',
        'configured_employee_min',v_employee_min,
        'configured_employee_max',v_employee_max,
        'filter_version','lead_filter_v2'
      ),
      last_seen_at=now()
    where client_id=p_client_id
      and status='ready'
      and coalesce(metadata->>'lead_mode','') <> 'documented_need'
      and coalesce(metadata->>'employee_count','') ~ '^\d+$'
      and (
        (v_employee_min is not null and (metadata->>'employee_count')::int < v_employee_min)
        or
        (v_employee_max is not null and (metadata->>'employee_count')::int > v_employee_max)
      );
  end if;

  -- Company-target profiles must stay inside the customer's selected target segments.
  if v_company_targets and v_has_target_terms then
    update public.crm_lead_candidates c
    set
      status='rejected',
      metadata=c.metadata || jsonb_build_object(
        'reject_reason','target_segment_outside_customer_profile',
        'filter_version','lead_filter_v2'
      ),
      last_seen_at=now()
    where c.client_id=p_client_id
      and c.status='ready'
      and coalesce(c.metadata->>'lead_mode','') <> 'documented_need'
      and not exists (
        select 1
        from jsonb_array_elements_text(v_target_terms) t(value)
        where btrim(t.value)<>''
          and position(
            lower(regexp_replace(btrim(t.value),'[^[:alnum:]æøå]+',' ','g'))
            in
            lower(regexp_replace(
              coalesce(c.industry,'') || ' ' || coalesce(c.metadata->>'matched_capability',''),
              '[^[:alnum:]æøå]+',' ','g'
            ))
          ) > 0
      );
  end if;

  while v_ny<p_target_min and v_delivered<v_limit loop
    select *
    into r
    from public.crm_lead_candidates c
    where c.client_id=p_client_id
      and c.status='ready'
      and coalesce(c.metadata->>'lead_mode','') <> 'documented_need'
      and (v_profile_version='' or c.metadata->>'capability_profile_version'=v_profile_version)
      and coalesce(c.metadata->>'matched_capability','')<>''
      and (
        not v_company_targets
        or coalesce(c.metadata->>'candidate_role','')='buyer_user'
      )
      and (
        not v_employee_gate
        or (
          coalesce(c.metadata->>'employee_count','') ~ '^\d+$'
          and (v_employee_min is null or (c.metadata->>'employee_count')::int >= v_employee_min)
          and (v_employee_max is null or (c.metadata->>'employee_count')::int <= v_employee_max)
        )
      )
      and (
        not v_company_targets
        or not v_has_target_terms
        or exists (
          select 1
          from jsonb_array_elements_text(v_target_terms) t(value)
          where btrim(t.value)<>''
            and position(
              lower(regexp_replace(btrim(t.value),'[^[:alnum:]æøå]+',' ','g'))
              in
              lower(regexp_replace(
                coalesce(c.industry,'') || ' ' || coalesce(c.metadata->>'matched_capability',''),
                '[^[:alnum:]æøå]+',' ','g'
              ))
            ) > 0
        )
      )
      and (
        v_company_targets
        or lower(coalesce(c.metadata->>'primary_trigger_or_segment','false'))='true'
        or (
          lower(coalesce(c.metadata->>'search_strategy_enforced','false'))='true'
          and coalesce(c.metadata->>'candidate_role','')='buyer_user'
          and coalesce(c.metadata->>'matched_capability','')<>''
        )
        or lower(coalesce(c.metadata->>'documented_need_verified','false'))='true'
        or coalesce(c.metadata->>'lead_mode','') in ('projects','tenders')
        or not v_profile_has_modes
      )
    order by c.discovery_score desc,c.last_verified_at desc,c.discovered_at asc
    limit 1
    for update skip locked;

    exit when r.id is null;

    v_matched := coalesce(r.metadata->>'matched_capability','');

    v_company := null;
    select id
    into v_company
    from public.crm_companies
    where client_id=p_client_id
      and (
        (r.domain is not null and lower(coalesce(domain,''))=lower(r.domain))
        or
        (lower(name)=lower(r.name) and lower(coalesce(address,''))=lower(coalesce(r.address,'')))
      )
    order by created_at asc
    limit 1;

    if v_company is not null then
      if exists(
        select 1
        from public.crm_leads
        where client_id=p_client_id
          and company_id=v_company
          and status not in ('TABT','IKKE RELEVANT')
      ) then
        update public.crm_lead_candidates
        set
          status='rejected',
          metadata=metadata || jsonb_build_object(
            'reject_reason','duplicate_at_promotion',
            'filter_version','lead_filter_v2'
          ),
          last_seen_at=now()
        where id=r.id;
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
      client_id,company_id,status,source,lead_pool,next_action,next_at,planning_type,owner_name,
      source_url,source_reference,source_matched_capability,source_scope_verified,
      source_qualification_verified,source_verification_evidence
    )
    values(
      p_client_id,v_company,'NY','Autonomous Lead Hunter · verified','standard',
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
      status='promoted',
      company_id=v_company,
      lead_id=v_lead,
      promoted_at=now(),
      last_seen_at=now(),
      metadata=metadata || jsonb_build_object('filter_version','lead_filter_v2')
    where id=r.id;

    insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
    values(
      p_client_id,'lead_delivered',1,
      jsonb_build_object('lead_id',v_lead,'candidate_id',r.id,'filter_version','lead_filter_v2')
    );

    perform public.crm_recalculate_lead_score(v_lead);

    v_promoted := v_promoted+1;
    v_ny := v_ny+1;
    v_delivered := v_delivered+1;
  end loop;

  return v_promoted;
end;
$function$

