do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='minuba-offer-status-sync-hourly' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end $$;

select cron.schedule(
  'minuba-offer-status-sync-hourly',
  '10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/minuba-offer-status-sync',
    body := jsonb_build_object('action','run'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-mail-offer-sync-secret',(
        select decrypted_secret from vault.decrypted_secrets
        where name='mail_offer_sync_secret'
        order by created_at desc limit 1
      )
    ),
    timeout_milliseconds := 20000
  );
  $cron$
);
