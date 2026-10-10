create or replace function public.crm_record_openai_billing_failure() returns void language sql security definer set search_path=public as $$
insert into public.crm_platform_settings(key,value,updated_at)
values('openai_billing_circuit',jsonb_build_object('status','blocked','reason','OPENAI_BILLING_REQUIRED','last_seen_at',now(),'blocked_until',now()+interval '6 hours','retry_policy','automatic_6h'),now())
on conflict(key)do update set value=excluded.value,updated_at=excluded.updated_at;
$$;
revoke all on function public.crm_record_openai_billing_failure() from public,anon,authenticated;
grant execute on function public.crm_record_openai_billing_failure() to service_role;
