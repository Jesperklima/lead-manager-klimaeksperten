create or replace function public.crm_reserve_mail_daily_capacity() returns trigger language plpgsql security definer set search_path=public as $$
declare max_daily integer; enabled boolean; sent numeric; reserved bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('mail_capacity:'||new.client_id::text,0));
 if exists(select 1 from public.crm_mail_send_jobs where client_id=new.client_id and send_id=new.send_id) then return new;end if;
 select coalesce(daily_mail_send_limit,100),allow_mail_send into max_daily,enabled from public.crm_usage_limits where client_id=new.client_id;
 if enabled=false then raise exception 'PLAN_MAIL_DISABLED'; end if;
 max_daily:=coalesce(max_daily,100);
 select coalesce(sum(quantity),0) into sent from public.crm_usage_events where client_id=new.client_id and event_type='mail_send' and occurred_at>=date_trunc('day',now());
 select count(*) into reserved from public.crm_mail_send_jobs j where j.client_id=new.client_id and j.created_at>=date_trunc('day',now()) and j.status<>'failed'
 and not exists(select 1 from public.crm_usage_events e where e.client_id=j.client_id and e.event_type='mail_send' and e.metadata->>'mail_send_job_id'=j.id::text);
 if sent+reserved>=max_daily then raise exception 'MAIL_DAILY_LIMIT';end if;
 return new;
end;$$;
revoke all on function public.crm_reserve_mail_daily_capacity() from public,anon,authenticated;
