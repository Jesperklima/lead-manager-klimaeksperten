-- Start includes direct manual mail sending via the customer's own mailbox.
-- Mail monitoring, reply analysis and AI mail remain Pro+.

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
    case v_plan when 'start' then 100 when 'pro' then 100 when 'business' then 200 else 500 end,
    true,
    v_plan in ('pro','business','internal'),
    v_plan in ('business','internal'),
    v_plan in ('business','internal'),
    false,
    v_plan in ('pro','business','internal'),
    v_plan in ('pro','business','internal'),
    v_plan in ('pro','business','internal'),
    v_plan in ('pro','business','internal'),
    true,
    v_plan in ('pro','business','internal'),
    now())
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

-- Normalize any existing Start rows if present.
update public.crm_usage_limits
set allow_mail_send=true,
    daily_mail_send_limit=100,
    allow_mail_monitor=false,
    allow_ai_mail=false,
    updated_at=now()
where plan_code='start';
