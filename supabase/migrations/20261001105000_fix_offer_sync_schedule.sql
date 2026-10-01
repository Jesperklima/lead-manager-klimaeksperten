-- Align offer-mail synchronization with the agreed weekday schedule in Europe/Copenhagen.
-- Runs are gated by local time so daylight-saving changes do not shift the intended 07:00, 07:30 and 15:00 executions.

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='mail-offer-sync-every-15-minutes'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'mail-offer-sync-every-15-minutes',
  '0,30 5,6,13,14 * * 1-5',
  $$
  select case
    when to_char(timezone('Europe/Copenhagen', now()), 'HH24:MI') in ('07:00','07:30','15:00')
    then net.http_post(
      url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/mail-offer-sync-runner',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-mail-offer-sync-secret',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='mail_offer_sync_secret'
          order by created_at desc
          limit 1
        )
      ),
      timeout_milliseconds := 120000
    )
    else null::bigint
  end;
  $$
);
