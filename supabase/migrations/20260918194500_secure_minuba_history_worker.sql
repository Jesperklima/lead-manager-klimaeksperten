-- Protect the internal Minuba history worker with a Vault-backed service secret.

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name='minuba_history_worker_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'minuba_history_worker_secret',
      'Internal authentication for minuba-history-worker'
    );
  end if;
end $$;

create or replace function public.get_minuba_history_worker_secret_for_service()
returns text
language sql
security definer
set search_path=public,vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='minuba_history_worker_secret'
  order by created_at desc
  limit 1
$$;

revoke all on function public.get_minuba_history_worker_secret_for_service() from public,anon,authenticated;
grant execute on function public.get_minuba_history_worker_secret_for_service() to service_role;

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
     and coalesce(new.payload->>'action','')='minuba_history_check' then
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
      url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/minuba-history-worker',
      body := jsonb_build_object('request_id',new.id),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-minuba-history-worker-secret',v_secret
      ),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
exception when others then
  raise warning 'minuba history worker trigger failed for request %: %',new.id,sqlerrm;
  return new;
end;
$$;

revoke all on function public.crm_trigger_minuba_history_worker() from public,anon,authenticated;
