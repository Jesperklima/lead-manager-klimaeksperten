create or replace function public.crm_dispatch_mail_reconciliation() returns bigint language plpgsql security definer set search_path=public,vault,net as $$
declare secret text; request_id bigint;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='mail_recovery_secret' limit 1;
 if nullif(secret,'') is null then raise exception 'MAIL_RECOVERY_SECRET_MISSING';end if;
 select net.http_post(url:='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/gmail-send-postprocess',body:=jsonb_build_object('limit',10),headers:=jsonb_build_object('Content-Type','application/json','x-mail-recovery-secret',secret),timeout_milliseconds:=10000) into request_id;
 return request_id;
end;$$;
revoke all on function public.crm_dispatch_mail_reconciliation() from public,anon,authenticated;
grant execute on function public.crm_dispatch_mail_reconciliation() to service_role;
select cron.schedule('mail-send-reconciliation-every-5-minutes','*/5 * * * *','select public.crm_dispatch_mail_reconciliation();');