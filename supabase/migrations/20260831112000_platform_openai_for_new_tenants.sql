-- Provision Lead Manager's centrally managed OpenAI engine into each new tenant.
-- The customer does not need a personal OpenAI API key for bundled SaaS plans.

create or replace function public.clone_openai_api_for_service(
  p_source_client_id uuid,
  p_target_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  v_secret text;
  v_model text;
  v_result jsonb;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='openai_api_'||p_source_client_id::text
  limit 1;

  if nullif(trim(coalesce(v_secret,'')),'') is null then
    raise exception 'Platformens OpenAI API-nøgle mangler';
  end if;

  select coalesce(config->>'model','gpt-5.6-terra') into v_model
  from public.crm_integrations
  where client_id=p_source_client_id and provider='openai'
  order by updated_at desc
  limit 1;
  v_model:=coalesce(v_model,'gpt-5.6-terra');

  if exists(
    select 1 from public.crm_integrations
    where client_id=p_target_client_id and provider='openai'
  ) then
    update public.crm_integrations
    set status='configured',
        config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
          'model',v_model,
          'purpose','platform_ai',
          'managed_by','lead_manager_platform'
        ),
        last_error=null,
        updated_at=now()
    where client_id=p_target_client_id and provider='openai';
  else
    insert into public.crm_integrations(
      client_id,provider,account,status,config,last_error,updated_at
    ) values (
      p_target_client_id,
      'openai',
      'lead-manager-platform',
      'configured',
      jsonb_build_object(
        'model',v_model,
        'purpose','platform_ai',
        'managed_by','lead_manager_platform'
      ),
      null,
      now()
    );
  end if;

  select public.set_openai_api_secret(p_target_client_id,v_secret)
  into v_result;

  update public.crm_integrations
  set config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
        'model',v_model,
        'purpose','platform_ai',
        'managed_by','lead_manager_platform'
      ),
      status='connected',
      last_error=null,
      updated_at=now()
  where client_id=p_target_client_id and provider='openai';

  return coalesce(v_result,'{}'::jsonb)
    || jsonb_build_object(
      'model',v_model,
      'managed_by','lead_manager_platform'
    );
end;
$$;

revoke all on function public.clone_openai_api_for_service(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.clone_openai_api_for_service(uuid,uuid)
  to service_role;
