-- Make internal agent request queues authenticated, retryable and self-healing.

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name='lead_manager_command_worker_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'lead_manager_command_worker_secret',
      'Internal authentication for lead-manager-command-worker'
    );
  end if;
end $$;

create or replace function public.crm_get_lead_manager_command_worker_secret_for_service()
returns text
language sql
security definer
set search_path=public,vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='lead_manager_command_worker_secret'
  order by created_at desc
  limit 1
$$;
revoke all on function public.crm_get_lead_manager_command_worker_secret_for_service() from public,anon,authenticated;
grant execute on function public.crm_get_lead_manager_command_worker_secret_for_service() to service_role;

create or replace function public.dispatch_lead_manager_command_worker()
returns trigger
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  v_secret text;
  v_action text;
begin
  v_action:=coalesce(new.payload->>'action','');
  if new.request_type='lead_manager_command'
     and new.status='queued'
     and v_action in ('import_offers_from_mail','reconcile_offers_from_mail','scan_mail_sales_signals','source_freshness_check')
     and (
       tg_op='INSERT'
       or old.status is distinct from new.status
       or old.payload is distinct from new.payload
     ) then
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name='lead_manager_command_worker_secret'
    order by created_at desc
    limit 1;
    if v_secret is null or v_secret='' then
      raise warning 'lead manager command worker secret missing for request %',new.id;
      return new;
    end if;
    perform net.http_post(
      url:='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/lead-manager-command-worker',
      body:=jsonb_build_object('request_id',new.id),
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-lead-manager-command-secret',v_secret
      ),
      timeout_milliseconds:=120000
    );
  end if;
  return new;
exception when others then
  raise warning 'lead manager command dispatch failed for request %: %',new.id,sqlerrm;
  return new;
end
$$;

drop trigger if exists trg_dispatch_lead_manager_command_worker on public.crm_agent_requests;
create trigger trg_dispatch_lead_manager_command_worker
after insert or update on public.crm_agent_requests
for each row execute function public.dispatch_lead_manager_command_worker();

-- Allow failed/missed Minuba history dispatches to be retried by touching a queued row.
create or replace function public.crm_trigger_minuba_history_worker()
returns trigger
language plpgsql
security definer
set search_path=public,extensions,vault
as $$
declare
  v_secret text;
begin
  if new.status='queued'
     and new.request_type='minuba_history_check'
     and coalesce(new.payload->>'action','')='minuba_history_check'
     and (
       tg_op='INSERT'
       or old.status is distinct from new.status
       or old.payload is distinct from new.payload
     ) then
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name='minuba_history_worker_secret'
    order by created_at desc
    limit 1;
    if v_secret is null or v_secret='' then
      raise warning 'minuba history worker secret missing for request %',new.id;
      return new;
    end if;
    perform net.http_post(
      url:='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/minuba-history-worker',
      body:=jsonb_build_object('request_id',new.id),
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-minuba-history-worker-secret',v_secret
      ),
      timeout_milliseconds:=30000
    );
  end if;
  return new;
exception when others then
  raise warning 'minuba history worker trigger failed for request %: %',new.id,sqlerrm;
  return new;
end
$$;

drop trigger if exists trg_crm_minuba_history_worker on public.crm_agent_requests;
create trigger trg_crm_minuba_history_worker
after insert or update on public.crm_agent_requests
for each row execute function public.crm_trigger_minuba_history_worker();

-- Collapse repeated browser-created scanners to the newest pending request per workspace.
with ranked as (
  select id,row_number() over(
    partition by client_id,payload->>'action'
    order by created_at desc,id desc
  ) rn
  from public.crm_agent_requests
  where status='queued'
    and payload->>'action' in ('reconcile_offers_from_mail','scan_mail_sales_signals')
)
update public.crm_agent_requests r
set status='done',
    completed_at=now(),
    response_text='Erstattet af en nyere kø-opgave for samme workspace og handling.'
from ranked x
where r.id=x.id and x.rn>1;

with ranked as (
  select id,row_number() over(
    partition by client_id,lead_id,payload->>'action'
    order by created_at desc,id desc
  ) rn
  from public.crm_agent_requests
  where status='queued'
    and payload->>'action'='source_freshness_check'
    and lead_id is not null
)
update public.crm_agent_requests r
set status='done',
    completed_at=now(),
    response_text='Erstattet af en nyere kildefriskhedskontrol for samme lead.'
from ranked x
where r.id=x.id and x.rn>1;

update public.crm_agent_requests
set status='error',
    completed_at=now(),
    error_text='Legacy Lead Manager-kommando uden maskinlæsbar action kan ikke behandles automatisk.'
where status='queued'
  and request_type='lead_manager_command'
  and coalesce(payload->>'action','')='';

update public.crm_agent_requests
set status='error',
    completed_at=now(),
    error_text=coalesce(nullif(error_text,''),'Watchdog: agentforespørgsel afsluttet som forældet efter 90 minutter')
where status='running'
  and completed_at is null
  and started_at < now()-interval '90 minutes';

create unique index if not exists crm_agent_requests_one_mail_scan_per_client
on public.crm_agent_requests(client_id,(payload->>'action'))
where status in ('queued','running')
  and payload->>'action' in ('reconcile_offers_from_mail','scan_mail_sales_signals');

create unique index if not exists crm_agent_requests_one_freshness_per_lead
on public.crm_agent_requests(client_id,lead_id,(payload->>'action'))
where status in ('queued','running')
  and lead_id is not null
  and payload->>'action'='source_freshness_check';

do $$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname in (
    'lead-manager-command-worker-drain','minuba-history-worker-drain','crm-agent-request-watchdog'
  )
  loop
    perform cron.unschedule(v_jobid);
  end loop;

  perform cron.schedule(
    'lead-manager-command-worker-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url:='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/lead-manager-command-worker',
        body:='{}'::jsonb,
        headers:=jsonb_build_object(
          'Content-Type','application/json',
          'x-lead-manager-command-secret',(
            select decrypted_secret from vault.decrypted_secrets
            where name='lead_manager_command_worker_secret'
            order by created_at desc limit 1
          )
        ),
        timeout_milliseconds:=120000
      );
    $cron$
  );

  perform cron.schedule(
    'minuba-history-worker-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url:='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/minuba-history-worker',
        body:='{}'::jsonb,
        headers:=jsonb_build_object(
          'Content-Type','application/json',
          'x-minuba-history-worker-secret',(
            select decrypted_secret from vault.decrypted_secrets
            where name='minuba_history_worker_secret'
            order by created_at desc limit 1
          )
        ),
        timeout_milliseconds:=30000
      );
    $cron$
  );

  perform cron.schedule(
    'crm-agent-request-watchdog',
    '*/30 * * * *',
    $cron$
      update public.crm_agent_requests
      set status='error',
          completed_at=now(),
          error_text=coalesce(nullif(error_text,''),'Watchdog: agentforespørgsel afsluttet som forældet efter 90 minutter')
      where status='running'
        and completed_at is null
        and started_at < now()-interval '90 minutes';
    $cron$
  );
end $$;

-- Re-dispatch currently queued jobs now that retryable dispatch is installed.
update public.crm_agent_requests
set payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object('audit_requeued_at',now())
where status='queued'
  and (
    (request_type='lead_manager_command' and payload->>'action' in (
      'import_offers_from_mail','reconcile_offers_from_mail','scan_mail_sales_signals','source_freshness_check','contact_enrichment'
    ))
    or (request_type='minuba_history_check' and payload->>'action'='minuba_history_check')
  );
