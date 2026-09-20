-- Complete external CRM connector backend: secret vault, inbound apply, queue worker, scheduler.

create unique index if not exists crm_integrations_one_external_provider_per_client
  on public.crm_integrations(client_id, provider)
  where provider in ('crm_webhook','hubspot','pipedrive','dynamics365','salesforce');

create or replace function public.crm_guard_external_crm_integration_write()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if public.crm_is_external_crm_provider(coalesce(new.provider,old.provider))
     and coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'External CRM connections must be managed through the secure connector';
  end if;
  return coalesce(new,old);
end;
$$;

revoke all on function public.crm_guard_external_crm_integration_write() from public,anon,authenticated,service_role;

drop trigger if exists crm_guard_external_crm_integration_write on public.crm_integrations;
create trigger crm_guard_external_crm_integration_write
before insert or update or delete on public.crm_integrations
for each row execute function public.crm_guard_external_crm_integration_write();

create or replace function public.crm_external_crm_store_secret(p_integration_id uuid,p_secret jsonb)
returns uuid
language plpgsql
security definer
set search_path=public,auth,vault
as $$
declare
  v_client uuid;
  v_provider text;
  v_existing uuid;
  v_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select client_id,provider,nullif(config->>'secret_id','')::uuid
    into v_client,v_provider,v_existing
  from public.crm_integrations
  where id=p_integration_id
    and public.crm_is_external_crm_provider(provider);
  if v_client is null then raise exception 'CRM integration not found'; end if;

  if v_existing is not null and exists(select 1 from vault.secrets where id=v_existing) then
    perform vault.update_secret(
      v_existing,
      coalesce(p_secret,'{}'::jsonb)::text,
      'lm_external_crm_'||p_integration_id::text,
      'Lead Manager external CRM credentials',
      null
    );
    v_id:=v_existing;
  else
    select vault.create_secret(
      coalesce(p_secret,'{}'::jsonb)::text,
      'lm_external_crm_'||p_integration_id::text,
      'Lead Manager external CRM credentials',
      null
    ) into v_id;
    update public.crm_integrations
       set config=jsonb_set(coalesce(config,'{}'::jsonb),'{secret_id}',to_jsonb(v_id::text),true),
           updated_at=now()
     where id=p_integration_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.crm_external_crm_store_secret(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_external_crm_store_secret(uuid,jsonb) to service_role;

create or replace function public.crm_external_crm_get_secret(p_integration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,vault
as $$
declare
  v_secret_id uuid;
  v_raw text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select nullif(config->>'secret_id','')::uuid into v_secret_id
  from public.crm_integrations
  where id=p_integration_id
    and public.crm_is_external_crm_provider(provider);
  if v_secret_id is null then return '{}'::jsonb; end if;
  select decrypted_secret into v_raw from vault.decrypted_secrets where id=v_secret_id;
  if v_raw is null then return '{}'::jsonb; end if;
  return v_raw::jsonb;
end;
$$;

revoke all on function public.crm_external_crm_get_secret(uuid) from public,anon,authenticated;
grant execute on function public.crm_external_crm_get_secret(uuid) to service_role;

create or replace function public.crm_external_crm_delete_secret(p_integration_id uuid)
returns void
language plpgsql
security definer
set search_path=public,auth,vault
as $$
declare v_secret_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select nullif(config->>'secret_id','')::uuid into v_secret_id
  from public.crm_integrations where id=p_integration_id;
  if v_secret_id is not null then delete from vault.secrets where id=v_secret_id; end if;
  update public.crm_integrations
     set config=coalesce(config,'{}'::jsonb)-'secret_id',updated_at=now()
   where id=p_integration_id;
end;
$$;

revoke all on function public.crm_external_crm_delete_secret(uuid) from public,anon,authenticated;
grant execute on function public.crm_external_crm_delete_secret(uuid) to service_role;

create or replace function public.crm_external_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_client_id uuid;
  v_local_id uuid;
  v_entity_type text;
  v_operation text;
begin
  if current_setting('app.external_crm_inbound',true)='1' then
    return coalesce(new,old);
  end if;

  v_client_id:=coalesce(new.client_id,old.client_id);
  v_local_id:=coalesce(new.id,old.id);
  v_entity_type:=case tg_table_name
    when 'crm_companies' then 'company'
    when 'crm_contacts' then 'contact'
    when 'crm_leads' then 'lead'
    else null
  end;
  v_operation:=case when tg_op='DELETE' then 'delete' else 'upsert' end;
  if v_entity_type is null then return coalesce(new,old); end if;

  perform public.crm_enqueue_external_sync_internal(
    v_client_id,v_entity_type,v_local_id,v_operation,
    jsonb_build_object('source_table',tg_table_name,'source_operation',tg_op,'queued_at',now())
  );
  return coalesce(new,old);
end;
$$;

revoke all on function public.crm_external_sync_trigger() from public,anon,authenticated,service_role;

create or replace function public.crm_claim_external_sync_jobs(p_limit integer default 25)
returns setof public.crm_external_sync_queue
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  return query
  with picked as (
    select q.id
    from public.crm_external_sync_queue q
    where q.status in ('queued','error')
      and q.available_at<=now()
      and q.attempts<q.max_attempts
    order by q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.crm_external_sync_queue q
     set status='running',locked_at=now(),attempts=q.attempts+1,updated_at=now()
  from picked
  where q.id=picked.id
  returning q.*;
end;
$$;

revoke all on function public.crm_claim_external_sync_jobs(integer) from public,anon,authenticated;
grant execute on function public.crm_claim_external_sync_jobs(integer) to service_role;

create or replace function public.crm_apply_external_crm_inbound(
  p_integration_id uuid,
  p_entity_type text,
  p_remote_id text,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_link public.crm_external_entity_links%rowtype;
  v_client uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select * into v_link
  from public.crm_external_entity_links
  where integration_id=p_integration_id
    and entity_type=p_entity_type
    and remote_id=p_remote_id
  limit 1;
  if v_link.id is null then
    return jsonb_build_object('ok',false,'ignored',true,'reason','unmapped_remote_record');
  end if;
  v_client:=v_link.client_id;
  perform set_config('app.external_crm_inbound','1',true);

  if p_entity_type='company' then
    update public.crm_companies
       set name=coalesce(nullif(p_data->>'name',''),name),
           domain=case when p_data ? 'domain' then nullif(p_data->>'domain','') else domain end,
           phone=case when p_data ? 'phone' then nullif(p_data->>'phone','') else phone end,
           address=case when p_data ? 'address' then nullif(p_data->>'address','') else address end,
           website_url=case when p_data ? 'website_url' then nullif(p_data->>'website_url','') else website_url end,
           industry=case when p_data ? 'industry' then nullif(p_data->>'industry','') else industry end
     where id=v_link.local_id and client_id=v_client;
  elsif p_entity_type='contact' then
    update public.crm_contacts
       set full_name=case when p_data ? 'full_name' then nullif(p_data->>'full_name','') else full_name end,
           title=case when p_data ? 'title' then nullif(p_data->>'title','') else title end,
           phone=case when p_data ? 'phone' then nullif(p_data->>'phone','') else phone end,
           email=case when p_data ? 'email' then nullif(lower(p_data->>'email'),'') else email end
     where id=v_link.local_id and client_id=v_client;
  elsif p_entity_type='lead' then
    update public.crm_leads
       set status=case when p_data ? 'status' then coalesce(nullif(p_data->>'status',''),status) else status end,
           priority=case when p_data ? 'priority' then nullif(p_data->>'priority','') else priority end,
           next_action=case when p_data ? 'next_action' then nullif(p_data->>'next_action','') else next_action end,
           next_at=case when p_data ? 'next_at' and nullif(p_data->>'next_at','') is not null then (p_data->>'next_at')::timestamptz else next_at end,
           owner_name=case when p_data ? 'owner_name' then nullif(p_data->>'owner_name','') else owner_name end,
           loss_reason=case when p_data ? 'loss_reason' then nullif(p_data->>'loss_reason','') else loss_reason end,
           won_value=case when p_data ? 'won_value' and nullif(p_data->>'won_value','') is not null then (p_data->>'won_value')::numeric else won_value end,
           updated_at=now()
     where id=v_link.local_id and client_id=v_client;
  else
    raise exception 'Unknown CRM entity type';
  end if;

  update public.crm_external_entity_links
     set last_synced_at=now(),updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_inbound_at',now())
   where id=v_link.id;

  insert into public.crm_external_sync_log(client_id,integration_id,entity_type,local_id,remote_id,operation,direction,status,summary,metadata)
  values(v_client,p_integration_id,p_entity_type,v_link.local_id,p_remote_id,'upsert','inbound','done','Inbound CRM update applied',coalesce(p_data,'{}'::jsonb));

  return jsonb_build_object('ok',true,'local_id',v_link.local_id,'client_id',v_client);
end;
$$;

revoke all on function public.crm_apply_external_crm_inbound(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_apply_external_crm_inbound(uuid,text,text,jsonb) to service_role;

do $$
declare v_secret text;
begin
  if not exists(select 1 from vault.decrypted_secrets where name='external_crm_sync_secret') then
    v_secret:=encode(gen_random_bytes(32),'hex');
    perform vault.create_secret(v_secret,'external_crm_sync_secret','Lead Manager external CRM sync runner',null);
  end if;
end
$$;

create or replace function public.crm_get_external_crm_sync_secret()
returns text
language plpgsql
security definer
set search_path=public,auth,vault
as $$
declare v text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select decrypted_secret into v from vault.decrypted_secrets
  where name='external_crm_sync_secret'
  order by created_at desc limit 1;
  return v;
end;
$$;

revoke all on function public.crm_get_external_crm_sync_secret() from public,anon,authenticated;
grant execute on function public.crm_get_external_crm_sync_secret() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='external-crm-sync-every-5-minutes' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
end
$$;

select cron.schedule(
  'external-crm-sync-every-5-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/external-crm-sync',
    body := '{"action":"drain"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-external-crm-sync-secret',(
        select decrypted_secret from vault.decrypted_secrets
        where name='external_crm_sync_secret'
        order by created_at desc limit 1
      )
    ),
    timeout_milliseconds := 120000
  );
  $$
);
