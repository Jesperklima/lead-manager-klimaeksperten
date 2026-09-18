-- Full-system integrity hardening found during the 2026-09-18 audit.
-- 1) Repair the one historical cross-workspace reference without deleting user history.
-- 2) Prevent future cross-workspace foreign references at the database boundary.
-- 3) Normalize pipeline status drift.
-- 4) Reject malformed contact email values.
-- 5) Close stale agent-run rows automatically.

-- Historical repair runs under migration privileges, while several business triggers
-- intentionally require an authenticated tenant session. Disable USER triggers only for
-- these one-time normalization statements; all constraints remain active.
alter table public.crm_leads disable trigger user;
alter table public.crm_contacts disable trigger user;
alter table public.crm_activities disable trigger user;
alter table public.crm_offers disable trigger user;

do $$
declare
  v_source_company uuid := '6c63056c-2ee7-4929-9a39-3e664d32d92b';
  v_target_client uuid := '9b6b08bd-e9ce-40c3-8ffa-aa18e859d3af';
  v_local_company uuid;
begin
  if exists (
    select 1 from public.crm_leads
    where company_id=v_source_company and client_id=v_target_client
  ) or exists (
    select 1 from public.crm_contacts
    where company_id=v_source_company and client_id=v_target_client
  ) or exists (
    select 1 from public.crm_activities
    where company_id=v_source_company and client_id=v_target_client
  ) then
    select id into v_local_company
    from public.crm_companies
    where client_id=v_target_client
      and lower(name)=lower((select name from public.crm_companies where id=v_source_company))
    order by created_at
    limit 1;

    if v_local_company is null then
      insert into public.crm_companies (
        client_id,name,cvr,domain,phone,address,relationship_status,do_not_contact,
        do_not_contact_reason,industry,website_url,employee_size_text,company_summary,
        research_updated_at,legal_form,advertising_protected,robinson_check_required,
        robinson_checked_at,robinson_blocked,contact_compliance_status
      )
      select
        v_target_client,name,cvr,domain,phone,address,relationship_status,do_not_contact,
        do_not_contact_reason,industry,website_url,employee_size_text,company_summary,
        research_updated_at,legal_form,advertising_protected,robinson_check_required,
        robinson_checked_at,robinson_blocked,contact_compliance_status
      from public.crm_companies
      where id=v_source_company
      returning id into v_local_company;
    end if;

    update public.crm_leads
      set company_id=v_local_company
      where client_id=v_target_client and company_id=v_source_company;
    update public.crm_contacts
      set company_id=v_local_company
      where client_id=v_target_client and company_id=v_source_company;
    update public.crm_activities
      set company_id=v_local_company
      where client_id=v_target_client and company_id=v_source_company;
  end if;
end $$;

-- Normalize historical offer status variants while preserving their former meaning.
update public.crm_offers
set status_reason = case
      when nullif(btrim(status_reason),'') is null then 'Tidligere status: '||status
      else status_reason||' · Tidligere status: '||status
    end,
    status='LUKKET'
where status in ('Lukket','LUKKET – UDSKUDT');

-- Remove punctuation placeholders that are not email addresses.
update public.crm_contacts
set email=null
where email is not null
  and btrim(email)<>''
  and position('@' in email)=0;

alter table public.crm_leads enable trigger user;
alter table public.crm_contacts enable trigger user;
alter table public.crm_activities enable trigger user;
alter table public.crm_offers enable trigger user;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='crm_leads_status_check'
      and conrelid='public.crm_leads'::regclass
  ) then
    alter table public.crm_leads
      add constraint crm_leads_status_check
      check (status in ('NY','UNDER VURDERING','KLAR TIL KONTAKT','I GANG','DIALOG','MØDE','TILBUD','AFVENTER','PÅ PAUSE','VUNDET','TABT','IKKE RELEVANT'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='crm_offers_status_check'
      and conrelid='public.crm_offers'::regclass
  ) then
    alter table public.crm_offers
      add constraint crm_offers_status_check
      check (status in ('I GANG','PÅ PAUSE','VUNDET','TABT','LUKKET','STATUS UKLAR'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='crm_contacts_email_shape_check'
      and conrelid='public.crm_contacts'::regclass
  ) then
    alter table public.crm_contacts
      add constraint crm_contacts_email_shape_check
      check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
  end if;
end $$;

create or replace function public.crm_guard_same_client_reference()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_ref_table regclass;
  v_ref_column text;
  v_ref_text text;
  v_ref_id uuid;
  v_ref_client uuid;
begin
  v_ref_table := to_regclass('public.'||tg_argv[0]);
  v_ref_column := tg_argv[1];
  if v_ref_table is null then
    raise exception 'Tenant integrity guard references unknown table %',tg_argv[0];
  end if;

  v_ref_text := to_jsonb(new)->>v_ref_column;
  if v_ref_text is null or btrim(v_ref_text)='' then
    return new;
  end if;

  begin
    v_ref_id := v_ref_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Tenant integrity guard received invalid UUID in %.%',tg_table_name,v_ref_column
      using errcode='23514';
  end;

  execute format('select client_id from %s where id=$1',v_ref_table)
    into v_ref_client using v_ref_id;

  -- A normal FK handles a missing referenced row. This guard only owns tenant consistency.
  if v_ref_client is not null and v_ref_client is distinct from new.client_id then
    raise exception 'Cross-workspace reference blocked: %.% points to % but client_id differs',
      tg_table_name,v_ref_column,tg_argv[0]
      using errcode='23514';
  end if;
  return new;
end $$;

-- Company ownership.
drop trigger if exists trg_tenant_leads_company on public.crm_leads;
create trigger trg_tenant_leads_company before insert or update of client_id,company_id on public.crm_leads
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');

drop trigger if exists trg_tenant_contacts_company on public.crm_contacts;
create trigger trg_tenant_contacts_company before insert or update of client_id,company_id on public.crm_contacts
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');

drop trigger if exists trg_tenant_opportunities_company on public.crm_opportunities;
create trigger trg_tenant_opportunities_company before insert or update of client_id,company_id on public.crm_opportunities
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');

drop trigger if exists trg_tenant_opportunities_lead on public.crm_opportunities;
create trigger trg_tenant_opportunities_lead before insert or update of client_id,lead_id on public.crm_opportunities
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');

-- Tasks.
drop trigger if exists trg_tenant_tasks_company on public.crm_tasks;
create trigger trg_tenant_tasks_company before insert or update of client_id,company_id on public.crm_tasks
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');
drop trigger if exists trg_tenant_tasks_lead on public.crm_tasks;
create trigger trg_tenant_tasks_lead before insert or update of client_id,lead_id on public.crm_tasks
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');
drop trigger if exists trg_tenant_tasks_offer on public.crm_tasks;
create trigger trg_tenant_tasks_offer before insert or update of client_id,offer_id on public.crm_tasks
for each row execute function public.crm_guard_same_client_reference('crm_offers','offer_id');

-- Offers.
drop trigger if exists trg_tenant_offers_company on public.crm_offers;
create trigger trg_tenant_offers_company before insert or update of client_id,company_id on public.crm_offers
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');
drop trigger if exists trg_tenant_offers_lead on public.crm_offers;
create trigger trg_tenant_offers_lead before insert or update of client_id,lead_id on public.crm_offers
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');
drop trigger if exists trg_tenant_offers_opportunity on public.crm_offers;
create trigger trg_tenant_offers_opportunity before insert or update of client_id,opportunity_id on public.crm_offers
for each row execute function public.crm_guard_same_client_reference('crm_opportunities','opportunity_id');

-- Mail threads/messages.
drop trigger if exists trg_tenant_mail_threads_company on public.crm_mail_threads;
create trigger trg_tenant_mail_threads_company before insert or update of client_id,company_id on public.crm_mail_threads
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');
drop trigger if exists trg_tenant_mail_threads_lead on public.crm_mail_threads;
create trigger trg_tenant_mail_threads_lead before insert or update of client_id,lead_id on public.crm_mail_threads
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');

drop trigger if exists trg_tenant_mail_company on public.crm_mail_messages;
create trigger trg_tenant_mail_company before insert or update of client_id,company_id on public.crm_mail_messages
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');
drop trigger if exists trg_tenant_mail_lead on public.crm_mail_messages;
create trigger trg_tenant_mail_lead before insert or update of client_id,lead_id on public.crm_mail_messages
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');
drop trigger if exists trg_tenant_mail_contact on public.crm_mail_messages;
create trigger trg_tenant_mail_contact before insert or update of client_id,contact_id on public.crm_mail_messages
for each row execute function public.crm_guard_same_client_reference('crm_contacts','contact_id');
drop trigger if exists trg_tenant_mail_offer on public.crm_mail_messages;
create trigger trg_tenant_mail_offer before insert or update of client_id,offer_id on public.crm_mail_messages
for each row execute function public.crm_guard_same_client_reference('crm_offers','offer_id');
drop trigger if exists trg_tenant_mail_thread on public.crm_mail_messages;
create trigger trg_tenant_mail_thread before insert or update of client_id,thread_id on public.crm_mail_messages
for each row execute function public.crm_guard_same_client_reference('crm_mail_threads','thread_id');

-- Activities.
drop trigger if exists trg_tenant_activities_company on public.crm_activities;
create trigger trg_tenant_activities_company before insert or update of client_id,company_id on public.crm_activities
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');
drop trigger if exists trg_tenant_activities_lead on public.crm_activities;
create trigger trg_tenant_activities_lead before insert or update of client_id,lead_id on public.crm_activities
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');
drop trigger if exists trg_tenant_activities_contact on public.crm_activities;
create trigger trg_tenant_activities_contact before insert or update of client_id,contact_id on public.crm_activities
for each row execute function public.crm_guard_same_client_reference('crm_contacts','contact_id');
drop trigger if exists trg_tenant_activities_offer on public.crm_activities;
create trigger trg_tenant_activities_offer before insert or update of client_id,offer_id on public.crm_activities
for each row execute function public.crm_guard_same_client_reference('crm_offers','offer_id');
drop trigger if exists trg_tenant_activities_opportunity on public.crm_activities;
create trigger trg_tenant_activities_opportunity before insert or update of client_id,opportunity_id on public.crm_activities
for each row execute function public.crm_guard_same_client_reference('crm_opportunities','opportunity_id');

-- Sales intelligence.
drop trigger if exists trg_tenant_intelligence_company on public.crm_sales_intelligence;
create trigger trg_tenant_intelligence_company before insert or update of client_id,company_id on public.crm_sales_intelligence
for each row execute function public.crm_guard_same_client_reference('crm_companies','company_id');
drop trigger if exists trg_tenant_intelligence_lead on public.crm_sales_intelligence;
create trigger trg_tenant_intelligence_lead before insert or update of client_id,lead_id on public.crm_sales_intelligence
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');
drop trigger if exists trg_tenant_intelligence_contact on public.crm_sales_intelligence;
create trigger trg_tenant_intelligence_contact before insert or update of client_id,contact_id on public.crm_sales_intelligence
for each row execute function public.crm_guard_same_client_reference('crm_contacts','contact_id');

-- Approvals.
drop trigger if exists trg_tenant_approvals_lead on public.crm_approvals;
create trigger trg_tenant_approvals_lead before insert or update of client_id,lead_id on public.crm_approvals
for each row execute function public.crm_guard_same_client_reference('crm_leads','lead_id');

-- A killed/timed-out worker cannot execute its catch/finally block. Close orphaned runs.
update public.crm_agent_runs
set status='error',
    error=coalesce(nullif(error,''),'Watchdog: agentkørsel afsluttet som forældet efter 90 minutter'),
    finished_at=coalesce(finished_at,now())
where status in ('running','started','queued')
  and finished_at is null
  and started_at < now()-interval '90 minutes';

do $$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname='crm-agent-run-watchdog'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
  perform cron.schedule(
    'crm-agent-run-watchdog',
    '*/30 * * * *',
    $cron$
      update public.crm_agent_runs
      set status='error',
          error=coalesce(nullif(error,''),'Watchdog: agentkørsel afsluttet som forældet efter 90 minutter'),
          finished_at=coalesce(finished_at,now())
      where status in ('running','started','queued')
        and finished_at is null
        and started_at < now()-interval '90 minutes';
    $cron$
  );
end $$;
