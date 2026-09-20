-- Run offer interpretation after the mail thread collector.
-- mail-thread-sync runs at minute 3/18/33/48; this runs five minutes later.

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
  '8-59/15 * * * *',
  $$
  select net.http_post(
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
  );
  $$
);
