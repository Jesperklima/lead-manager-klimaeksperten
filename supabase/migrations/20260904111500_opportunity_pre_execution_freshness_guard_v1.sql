create or replace function public.crm_guard_verified_opportunity_hunter_fit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile jsonb;
  v_match_ok boolean := false;
  v_support_only boolean := false;
  v_evidence jsonb := coalesce(new.source_verification_evidence,'{}'::jsonb);
  v_latest_status text := lower(coalesce(new.source_verification_evidence->>'latest_official_status',''));
  v_stage text := lower(coalesce(new.source_verification_evidence->>'opportunity_stage',''));
  v_date_text text;
  v_status_date date;
  v_source_date date;
  v_future_action_date date;
  v_freshness_date date;
begin
  if coalesce(new.source,'') !~* '(opportunity[^a-zæøå]*hunter|tender[^a-zæøå]*hunter|udbud[^a-zæøå]*hunter)' then
    return new;
  end if;

  if new.status in ('IKKE RELEVANT','TABT','VUNDET') then
    return new;
  end if;

  select settings->'capability_profile' into v_profile
  from public.crm_clients
  where id=new.client_id;

  if v_profile is null then
    raise exception 'Opportunity/Tender Hunter er blokeret: verificeret Klimaeksperten capability_profile mangler.';
  end if;

  if coalesce(new.source_scope_verified,false) is not true then
    raise exception 'Opportunity/Tender Hunter er blokeret: konkret lot/scope er ikke verificeret.';
  end if;
  if nullif(btrim(coalesce(new.source_url,'')),'') is null or new.source_url !~* '^https?://' then
    raise exception 'Opportunity/Tender Hunter er blokeret: original offentlig kilde-URL mangler.';
  end if;
  if nullif(btrim(coalesce(new.source_reference,'')),'') is null then
    raise exception 'Opportunity/Tender Hunter er blokeret: kort kilde-/scope-reference mangler.';
  end if;
  if nullif(btrim(coalesce(new.source_matched_capability,'')),'') is null then
    raise exception 'Opportunity/Tender Hunter er blokeret: dokumenteret capability-match mangler.';
  end if;

  select exists(
    select 1
    from jsonb_array_elements_text(coalesce(v_profile->'lead_trigger_capabilities','[]'::jsonb)) x(value)
    where lower(btrim(x.value))=lower(btrim(new.source_matched_capability))
  ) or exists(
    select 1
    from jsonb_array_elements_text(coalesce(v_profile->'documented_segments','[]'::jsonb)) x(value)
    where lower(btrim(x.value))=lower(btrim(new.source_matched_capability))
  ) into v_match_ok;

  select exists(
    select 1
    from jsonb_array_elements_text(coalesce(v_profile->'supporting_capabilities','[]'::jsonb)) x(value)
    where lower(btrim(x.value))=lower(btrim(new.source_matched_capability))
  ) into v_support_only;

  if v_support_only then
    raise exception 'Opportunity/Tender Hunter er blokeret: en støttekompetence må ikke alene udløse et lead.';
  end if;
  if not v_match_ok then
    raise exception 'Opportunity/Tender Hunter er blokeret: capability-match findes ikke i den verificerede primære profil/målsegmenter.';
  end if;

  if coalesce(new.source_qualification_required,false) and coalesce(new.source_qualification_verified,false) is not true then
    raise exception 'Opportunity/Tender Hunter er blokeret: obligatoriske egnethedskrav er ikke verificeret som opfyldt.';
  end if;

  if v_latest_status ~ '(færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget|kontrakt[^a-zæøå]*(tildelt|indgået)|ordre[^a-zæøå]*(tildelt|placeret)|completed|installed|delivered|awarded|contract[^a-z]*(signed|awarded))'
     and v_latest_status !~ '(ikke|ej|endnu ikke)[^.;,]{0,25}(færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget)' then
    raise exception 'Opportunity/Tender Hunter er blokeret: seneste officielle status viser, at opgaven allerede er udført/tildelt/afsluttet.';
  end if;

  if v_stage ~ '(færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget|tildelt|completed|installed|delivered|awarded|closed)' then
    raise exception 'Opportunity/Tender Hunter er blokeret: opportunity_stage er ikke længere før udførelse.';
  end if;

  v_date_text := coalesce(
    v_evidence->>'status_verified_at',
    v_evidence->>'status_checked_at',
    v_evidence->>'status_source_date'
  );
  if coalesce(v_date_text,'') ~ '^\d{4}-\d{2}-\d{2}' then
    v_status_date := substring(v_date_text from 1 for 10)::date;
  end if;

  v_date_text := coalesce(
    v_evidence->>'published_date',
    v_evidence->>'publication_date',
    v_evidence->>'decision_date',
    v_evidence->>'source_date'
  );
  if coalesce(v_date_text,'') ~ '^\d{4}-\d{2}-\d{2}' then
    v_source_date := substring(v_date_text from 1 for 10)::date;
  end if;

  foreach v_date_text in array array[
    v_evidence->>'deadline',
    v_evidence->>'bid_deadline',
    v_evidence->>'submission_deadline',
    v_evidence->>'next_milestone_date',
    v_evidence->>'expected_tender_date',
    v_evidence->>'expected_decision_date',
    v_evidence->>'planned_execution_date'
  ]
  loop
    if coalesce(v_date_text,'') ~ '^\d{4}-\d{2}-\d{2}' then
      if substring(v_date_text from 1 for 10)::date >= current_date then
        v_future_action_date := substring(v_date_text from 1 for 10)::date;
        exit;
      end if;
    end if;
  end loop;

  v_freshness_date := coalesce(v_status_date,v_source_date);

  if v_future_action_date is null then
    if v_freshness_date is null then
      raise exception 'Opportunity/Tender Hunter er blokeret: ingen dateret, aktuel projektstatus eller fremtidig milepæl er dokumenteret.';
    end if;

    if v_freshness_date < current_date - 45 then
      raise exception 'Opportunity/Tender Hunter er blokeret: seneste dokumenterede projektstatus er ældre end 45 dage; find en nyere officiel status før leadet oprettes.';
    end if;
  end if;

  new.source_verification_evidence := v_evidence || jsonb_build_object(
    'timing_guard','pre_execution_v1',
    'timing_guard_checked_at',now(),
    'timing_freshness_date',coalesce(v_freshness_date::text,''),
    'timing_future_action_date',coalesce(v_future_action_date::text,'')
  );

  return new;
end;
$function$;

drop trigger if exists trg_guard_verified_opportunity_hunter_fit on public.crm_leads;
create trigger trg_guard_verified_opportunity_hunter_fit
before insert or update of status, source, source_url, source_reference, source_matched_capability,
  source_scope_verified, source_qualification_required, source_qualification_verified, source_verification_evidence
on public.crm_leads
for each row execute function public.crm_guard_verified_opportunity_hunter_fit();