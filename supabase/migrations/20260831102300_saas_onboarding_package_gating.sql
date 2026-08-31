-- Lead Manager SaaS: tenant-safe invited onboarding and package feature gating.
-- Applied to production Supabase on 2026-08-31 before this source snapshot.

alter table public.crm_usage_limits
  add column if not exists allow_offers boolean not null default false,
  add column if not exists allow_offer_pipeline boolean not null default false,
  add column if not exists allow_activity_report boolean not null default false,
  add column if not exists allow_ai_mail boolean not null default false,
  add column if not exists allow_calendar boolean not null default true,
  add column if not exists allow_approvals boolean not null default false;

create or replace function public.crm_feature_enabled(p_client_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(case lower(trim(p_feature))
    when 'offers' then l.allow_offers
    when 'offer_pipeline' then l.allow_offer_pipeline
    when 'mail' then l.allow_mail_monitor
    when 'mail_monitor' then l.allow_mail_monitor
    when 'mail_send' then l.allow_mail_send
    when 'ai_mail' then l.allow_ai_mail
    when 'calendar' then l.allow_calendar
    when 'activity_report' then l.allow_activity_report
    when 'approvals' then l.allow_approvals
    when 'tender_search' then l.allow_tender_search
    when 'minuba' then l.allow_minuba
    else false end,false)
  from public.crm_usage_limits l where l.client_id=p_client_id limit 1;
$$;
revoke all on function public.crm_feature_enabled(uuid,text) from public,anon;
grant execute on function public.crm_feature_enabled(uuid,text) to authenticated,service_role;

create or replace function public.crm_apply_plan(p_client_id uuid,p_plan_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_plan text:=lower(trim(coalesce(p_plan_code,''))); v_row public.crm_usage_limits%rowtype;
begin
  if v_plan not in ('start','pro','business','internal') then raise exception 'Ukendt plan: %',p_plan_code; end if;
  insert into public.crm_usage_limits(
    client_id,plan_code,monthly_lead_limit,daily_search_run_limit,monthly_enrichment_limit,
    monthly_ai_draft_limit,daily_mail_send_limit,allow_mail_send,allow_mail_monitor,
    allow_tender_search,allow_minuba,allow_auto_mail_send,allow_offers,allow_offer_pipeline,
    allow_activity_report,allow_ai_mail,allow_calendar,allow_approvals,updated_at)
  values(
    p_client_id,v_plan,
    case when v_plan='internal' then 1000 else 100 end,
    case when v_plan='internal' then 24 else 4 end,
    case v_plan when 'start' then 150 when 'pro' then 300 when 'business' then 600 else 5000 end,
    case v_plan when 'start' then 0 when 'pro' then 300 when 'business' then 1000 else 5000 end,
    case v_plan when 'start' then 1 when 'pro' then 100 when 'business' then 200 else 500 end,
    v_plan in ('pro','business','internal'),v_plan in ('pro','business','internal'),
    v_plan in ('business','internal'),v_plan in ('business','internal'),false,
    v_plan in ('pro','business','internal'),v_plan in ('pro','business','internal'),
    v_plan in ('pro','business','internal'),v_plan in ('pro','business','internal'),true,
    v_plan in ('pro','business','internal'),now())
  on conflict(client_id) do update set
    plan_code=excluded.plan_code,monthly_lead_limit=excluded.monthly_lead_limit,
    daily_search_run_limit=excluded.daily_search_run_limit,monthly_enrichment_limit=excluded.monthly_enrichment_limit,
    monthly_ai_draft_limit=excluded.monthly_ai_draft_limit,daily_mail_send_limit=excluded.daily_mail_send_limit,
    allow_mail_send=excluded.allow_mail_send,allow_mail_monitor=excluded.allow_mail_monitor,
    allow_tender_search=excluded.allow_tender_search,allow_minuba=excluded.allow_minuba,
    allow_auto_mail_send=excluded.allow_auto_mail_send,allow_offers=excluded.allow_offers,
    allow_offer_pipeline=excluded.allow_offer_pipeline,allow_activity_report=excluded.allow_activity_report,
    allow_ai_mail=excluded.allow_ai_mail,allow_calendar=excluded.allow_calendar,
    allow_approvals=excluded.allow_approvals,updated_at=now()
  returning * into v_row;
  return to_jsonb(v_row);
end;$$;
revoke all on function public.crm_apply_plan(uuid,text) from public,anon,authenticated;
grant execute on function public.crm_apply_plan(uuid,text) to service_role;

create or replace function public.crm_confirmed_invite_access(p_client_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select exists(select 1 from public.crm_users cu join auth.users au on au.id=auth.uid()
    where cu.client_id=p_client_id and cu.active and cu.auth_user_id is null
      and lower(cu.email)=lower(coalesce(au.email,'')) and au.email_confirmed_at is not null);
$$;
revoke all on function public.crm_confirmed_invite_access(uuid) from public,anon;
grant execute on function public.crm_confirmed_invite_access(uuid) to authenticated,service_role;

create or replace function public.crm_has_client_access(p_client_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select exists(select 1 from public.crm_users u where u.client_id=p_client_id and u.active and u.auth_user_id=auth.uid())
    or public.crm_confirmed_invite_access(p_client_id);
$$;
revoke all on function public.crm_has_client_access(uuid) from public,anon;
grant execute on function public.crm_has_client_access(uuid) to authenticated,service_role;

create or replace function public.crm_claim_invited_membership()
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid();v_email text;v_confirmed timestamptz;v_count int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select lower(email),email_confirmed_at into v_email,v_confirmed from auth.users where id=v_uid;
  if v_email is null or v_confirmed is null then raise exception 'Email must be confirmed'; end if;
  update public.crm_users set auth_user_id=v_uid where active and auth_user_id is null and lower(email)=v_email;
  get diagnostics v_count=row_count;
  return jsonb_build_object('claimed',v_count,'email',v_email);
end;$$;
revoke all on function public.crm_claim_invited_membership() from public,anon;
grant execute on function public.crm_claim_invited_membership() to authenticated;

-- Tenant identity is UID-based. Client profile is read-only in browser; onboarding writes server-side.
drop policy if exists crm_clients_tenant_all on public.crm_clients;
drop policy if exists crm_clients_tenant_select on public.crm_clients;
create policy crm_clients_tenant_select on public.crm_clients for select to authenticated using(public.crm_has_client_access(id));

drop policy if exists crm_users_select_own on public.crm_users;
create policy crm_users_select_own on public.crm_users for select to authenticated using(
  active and (auth_user_id=auth.uid() or (auth_user_id is null and lower(email)=lower(coalesce((select auth.jwt()->>'email'),'') ) and public.crm_confirmed_invite_access(client_id))));

-- Package 1 cannot bypass UI to read or change mail/offer data.
drop policy if exists crm_offers_tenant_all on public.crm_offers;
drop policy if exists crm_offers_plan_access on public.crm_offers;
create policy crm_offers_plan_access on public.crm_offers for all to authenticated
using(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'offers'))
with check(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'offers'));

drop policy if exists crm_offer_history_tenant_all on public.crm_offer_history;
drop policy if exists crm_offer_history_plan_access on public.crm_offer_history;
create policy crm_offer_history_plan_access on public.crm_offer_history for all to authenticated
using(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'offers'))
with check(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'offers'));

drop policy if exists crm_mail_messages_tenant_all on public.crm_mail_messages;
drop policy if exists crm_mail_messages_plan_access on public.crm_mail_messages;
create policy crm_mail_messages_plan_access on public.crm_mail_messages for all to authenticated
using(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'mail_monitor'))
with check(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'mail_monitor'));

drop policy if exists crm_mail_threads_tenant_all on public.crm_mail_threads;
drop policy if exists crm_mail_threads_plan_access on public.crm_mail_threads;
create policy crm_mail_threads_plan_access on public.crm_mail_threads for all to authenticated
using(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'mail_monitor'))
with check(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'mail_monitor'));

drop policy if exists crm_approvals_tenant_all on public.crm_approvals;
drop policy if exists crm_approvals_plan_access on public.crm_approvals;
create policy crm_approvals_plan_access on public.crm_approvals for all to authenticated
using(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'approvals'))
with check(public.crm_has_client_access(client_id) and public.crm_feature_enabled(client_id,'approvals'));

drop policy if exists crm_agent_requests_tenant_all on public.crm_agent_requests;
drop policy if exists crm_agent_requests_plan_access on public.crm_agent_requests;
create policy crm_agent_requests_plan_access on public.crm_agent_requests for all to authenticated
using(public.crm_has_client_access(client_id) and (request_type not in ('draft_info_mail','draft_no_contact_mail','mail_draft','send_email') or public.crm_feature_enabled(client_id,'ai_mail')))
with check(public.crm_has_client_access(client_id) and (request_type not in ('draft_info_mail','draft_no_contact_mail','mail_draft','send_email') or public.crm_feature_enabled(client_id,'ai_mail')));
