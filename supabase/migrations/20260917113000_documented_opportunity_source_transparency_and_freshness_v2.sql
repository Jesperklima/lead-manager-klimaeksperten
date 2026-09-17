-- Documented opportunities must show where they came from and must not remain actionable when stale.

drop trigger if exists trg_guard_verified_opportunity_hunter_fit on public.crm_leads;

create or replace function public.crm_normalize_documented_source_type(p_type text)
returns text language sql immutable as $$
  select case
    when lower(coalesce(p_type,'')) ~ '(tender|udbud|procurement|contract notice)' then 'Udbud'
    when lower(coalesce(p_type,'')) ~ '(board|bestyrelse|general meeting|generalforsamling)' then 'Bestyrelses-/GF-referat'
    when lower(coalesce(p_type,'')) ~ '(agenda|minutes|referat|dagsorden|committee|udvalg|provsti)' then 'Referat / dagsorden'
    when lower(coalesce(p_type,'')) ~ '(environmental|miljø|approval|godkendelse)' then 'Myndighedsgodkendelse'
    when lower(coalesce(p_type,'')) ~ '(annual|årsberet|budget)' then 'Årsberetning / budget'
    when lower(coalesce(p_type,'')) ~ '(news|press|nyhed)' then 'Offentlig nyhed / meddelelse'
    else 'Offentlig dokumenteret kilde'
  end;
$$;

create or replace function public.crm_guard_verified_opportunity_hunter_fit()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  e jsonb := coalesce(new.source_verification_evidence,'{}'::jsonb);
  source_type text := coalesce(e->>'source_type','');
  latest_status text := lower(coalesce(e->>'latest_official_status',''));
  stage text := lower(coalesce(e->>'opportunity_stage',e->>'project_stage',''));
  date_text text;
  status_date date;
  source_date date;
  future_date date;
  deadline_date date;
  freshness_date date;
  documented boolean;
begin
  documented := coalesce(new.lead_pool,'')='documented_opportunity'
    or coalesce(new.source,'') ~* '(opportunity[^a-zæøå]*hunter|tender[^a-zæøå]*hunter|udbud[^a-zæøå]*hunter)';
  if not documented or new.status in ('IKKE RELEVANT','TABT','VUNDET') then return new; end if;

  if nullif(btrim(coalesce(new.source_url,'')),'') is null or new.source_url !~* '^https?://' then
    raise exception 'Dokumenteret mulighed er blokeret: original offentlig kilde-URL mangler.';
  end if;
  if nullif(btrim(coalesce(new.source_reference,'')),'') is null then
    raise exception 'Dokumenteret mulighed er blokeret: konkret kilde-/projektreference mangler.';
  end if;
  if nullif(btrim(source_type),'') is null then
    raise exception 'Dokumenteret mulighed er blokeret: kildetype mangler.';
  end if;
  if coalesce(new.source_scope_verified,false) is not true then
    raise exception 'Dokumenteret mulighed er blokeret: konkret køl/klima/varmepumpe-scope er ikke verificeret.';
  end if;

  new.source := public.crm_normalize_documented_source_type(source_type);
  e := e || jsonb_build_object('source_label',new.source);

  if (latest_status ~ '(færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget|tildelt|completed|installed|delivered|awarded|closed)'
      and latest_status !~ '(ikke|ej|endnu ikke)[^.;,]{0,25}(færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget)')
     or stage ~ '(færdig|udført|installeret|monteret|leveret|afsluttet|ibrugtaget|tildelt|completed|installed|delivered|awarded|closed)' then
    raise exception 'Dokumenteret mulighed er blokeret: seneste status viser, at sagen er afsluttet/tildelt/udført.';
  end if;

  date_text := coalesce(e->>'status_verified_at',e->>'status_checked_at',e->>'status_source_date');
  if coalesce(date_text,'') ~ '^\d{4}-\d{2}-\d{2}' then status_date := substring(date_text from 1 for 10)::date; end if;
  date_text := coalesce(e->>'published_date',e->>'publication_date',e->>'decision_date',e->>'source_date');
  if coalesce(date_text,'') ~ '^\d{4}-\d{2}-\d{2}' then source_date := substring(date_text from 1 for 10)::date; end if;

  foreach date_text in array array[
    e->>'deadline',e->>'bid_deadline',e->>'submission_deadline',e->>'next_milestone_date',
    e->>'expected_tender_date',e->>'expected_decision_date',e->>'planned_execution_date',e->>'expected_completion_date'
  ] loop
    if coalesce(date_text,'') ~ '^\d{4}-\d{2}-\d{2}' and substring(date_text from 1 for 10)::date >= current_date then
      future_date := substring(date_text from 1 for 10)::date; exit;
    end if;
  end loop;

  date_text := coalesce(e->>'deadline',e->>'bid_deadline',e->>'submission_deadline');
  if coalesce(date_text,'') ~ '^\d{4}-\d{2}-\d{2}' then deadline_date := substring(date_text from 1 for 10)::date; end if;
  if new.source='Udbud' and deadline_date is not null and deadline_date < current_date then
    raise exception 'Dokumenteret mulighed er blokeret: udbudsfristen er udløbet.';
  end if;

  freshness_date := coalesce(status_date,source_date);
  if future_date is null then
    if freshness_date is null then raise exception 'Dokumenteret mulighed er blokeret: ingen dateret aktuel status eller fremtidig milepæl.'; end if;
    if freshness_date < current_date - 45 then raise exception 'Dokumenteret mulighed er blokeret: kilden/status er ældre end 45 dage uden fremtidig milepæl.'; end if;
  end if;

  new.source_verification_evidence := e || jsonb_build_object(
    'timing_guard','documented_opportunity_v2','timing_guard_checked_at',now(),
    'timing_freshness_date',coalesce(freshness_date::text,''),'timing_future_action_date',coalesce(future_date::text,''),'freshness_state','current');
  return new;
end;
$function$;

create or replace function public.crm_audit_documented_opportunity_freshness()
returns table(stale_moved integer, expired_closed integer, rechecks_queued integer)
language plpgsql security definer set search_path to 'public'
as $function$
declare s integer:=0; x integer:=0; q integer:=0;
begin
  with stale as (
    select l.id from crm_leads l
    where l.lead_pool='documented_opportunity' and l.status='NY'
      and not exists (
        select 1 from jsonb_each_text(coalesce(l.source_verification_evidence,'{}'::jsonb)) e(k,v)
        where e.k in ('deadline','bid_deadline','submission_deadline','next_milestone_date','expected_tender_date','expected_decision_date','planned_execution_date','expected_completion_date')
          and e.v ~ '^\d{4}-\d{2}-\d{2}' and substring(e.v from 1 for 10)::date >= current_date)
      and coalesce(
        case when coalesce(l.source_verification_evidence->>'status_verified_at',l.source_verification_evidence->>'status_checked_at',l.source_verification_evidence->>'status_source_date','') ~ '^\d{4}-\d{2}-\d{2}' then substring(coalesce(l.source_verification_evidence->>'status_verified_at',l.source_verification_evidence->>'status_checked_at',l.source_verification_evidence->>'status_source_date') from 1 for 10)::date end,
        case when coalesce(l.source_verification_evidence->>'published_date',l.source_verification_evidence->>'publication_date',l.source_verification_evidence->>'decision_date',l.source_verification_evidence->>'source_date','') ~ '^\d{4}-\d{2}-\d{2}' then substring(coalesce(l.source_verification_evidence->>'published_date',l.source_verification_evidence->>'publication_date',l.source_verification_evidence->>'decision_date',l.source_verification_evidence->>'source_date') from 1 for 10)::date end,
        date '1900-01-01') < current_date - 45
  ), changed as (
    update crm_leads l set status='UNDER VURDERING',next_action='Genverificér aktuel status i original kilde før kontakt',source_scope_verified=false,
      source_verification_evidence=coalesce(l.source_verification_evidence,'{}'::jsonb)||jsonb_build_object('freshness_state','recheck_required','freshness_audited_at',now()),updated_at=now()
    from stale where l.id=stale.id returning l.id
  ) select count(*) into s from changed;

  with todo as (
    select l.* from crm_leads l
    where l.lead_pool='documented_opportunity' and l.status='UNDER VURDERING' and l.source_verification_evidence->>'freshness_state'='recheck_required'
      and not exists(select 1 from crm_agent_requests r where r.lead_id=l.id and r.payload->>'action'='source_freshness_check' and r.status in ('queued','running'))
      and not exists(select 1 from crm_agent_requests r where r.lead_id=l.id and r.payload->>'action'='source_freshness_check' and r.created_at>now()-interval '24 hours')
    order by l.updated_at asc limit 5
  ), ins as (
    insert into crm_agent_requests(client_id,company_id,lead_id,request_type,request_text,status,payload,created_by)
    select client_id,company_id,id,'lead_manager_command',
      'Genverificér denne dokumenterede mulighed i den originale offentlige kilde. Kontroller om projektet/udbuddet stadig er aktivt, om fristen er udløbet, om kontrakten er tildelt, eller om arbejdet er udført. Opdatér latest_official_status, status_checked_at og eventuel deadline/fremtidig milepæl. Hvis sagen er afsluttet eller gammel, må den ikke gå tilbage til NY.',
      'queued',jsonb_build_object('action','source_freshness_check','source_url',source_url,'source_reference',source_reference),'freshness_guard'
    from todo returning 1
  ) select count(*) into q from ins;

  update crm_opportunities set status='UDLØBET – KRÆVER NY KILDE',updated_at=now()
  where deadline_at is not null and deadline_at<now() and upper(coalesce(status,'')) !~ '(AFVIST|UDLØBET|LUKKET|TILDELT|VUNDET|TABT|AFSLUTTET)';

  return query select s,x,q;
end;
$function$;

update crm_leads
set source=public.crm_normalize_documented_source_type(source_verification_evidence->>'source_type'),
    source_verification_evidence=coalesce(source_verification_evidence,'{}'::jsonb)||jsonb_build_object('source_label',public.crm_normalize_documented_source_type(source_verification_evidence->>'source_type'))
where lead_pool='documented_opportunity';

select * from public.crm_audit_documented_opportunity_freshness();

create trigger trg_guard_verified_opportunity_hunter_fit
before insert or update of status,source,source_url,source_reference,source_matched_capability,source_scope_verified,source_qualification_required,source_qualification_verified,source_verification_evidence,lead_pool
on public.crm_leads for each row execute function public.crm_guard_verified_opportunity_hunter_fit();

do $$ begin
  if exists(select 1 from cron.job where jobname='documented-opportunity-freshness-v2') then perform cron.unschedule('documented-opportunity-freshness-v2'); end if;
  perform cron.schedule('documented-opportunity-freshness-v2','0 */6 * * *','select * from public.crm_audit_documented_opportunity_freshness();');
end $$;
