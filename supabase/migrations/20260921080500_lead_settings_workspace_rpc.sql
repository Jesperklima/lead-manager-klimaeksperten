create or replace function public.crm_update_lead_search_profile(
  p_client_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_client public.crm_clients%rowtype;
  v_settings jsonb;
  v_profile jsonb;
  v_capability jsonb;
  v_industries jsonb;
  v_modes jsonb;
  v_now timestamptz:=now();
begin
  if auth.uid() is null or not public.crm_can_manage_workspace(p_client_id) then
    raise exception 'Adgang nægtet';
  end if;

  if p_profile is null or jsonb_typeof(p_profile)<>'object' then
    raise exception 'Lead-profil mangler';
  end if;

  v_industries:=coalesce(p_profile->'industries','[]'::jsonb);
  v_modes:=coalesce(p_profile->'lead_modes','[]'::jsonb);

  if jsonb_typeof(v_industries)<>'array' or jsonb_array_length(v_industries)=0 then
    raise exception 'Vælg mindst én branche';
  end if;
  if jsonb_typeof(v_modes)<>'array' or jsonb_array_length(v_modes)=0 then
    raise exception 'Vælg mindst én leadtype';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_modes) m(value)
    where value not in ('company_targets','documented_need','projects','tenders')
  ) then
    raise exception 'Ugyldig leadtype';
  end if;

  select * into v_client from public.crm_clients where id=p_client_id;
  if v_client.id is null then raise exception 'Workspace findes ikke'; end if;

  v_settings:=coalesce(v_client.settings,'{}'::jsonb);
  v_profile:=jsonb_build_object(
    'version','lead_search_v4',
    'industries',v_industries,
    'lead_modes',v_modes,
    'task_types',coalesce(p_profile->'task_types','[]'::jsonb),
    'customer_types',coalesce(p_profile->'customer_types','[]'::jsonb),
    'employee_range',coalesce(p_profile->'employee_range',jsonb_build_object('min',null,'max',null)),
    'project_value_dkk',coalesce(p_profile->'project_value_dkk',jsonb_build_object('min',null,'max',null)),
    'ideal_signals',coalesce(p_profile->'ideal_signals','[]'::jsonb),
    'geography',coalesce(p_profile->'geography',jsonb_build_object('mode','denmark','values','[]'::jsonb,'text','Danmark')),
    'exclusions',coalesce(p_profile->'exclusions','[]'::jsonb),
    'mail_provider',v_settings->>'mail_provider',
    'mail_provider_preference',coalesce(v_settings->>'mail_provider_preference','later')
  );

  v_capability:=coalesce(v_settings->'capability_profile','{}'::jsonb)
    || jsonb_build_object(
      'version','customer_onboarding_v4',
      'configured_at',v_now,
      'source','settings_ui',
      'documented_segments',(
        select coalesce(jsonb_agg(distinct x),'[]'::jsonb)
        from (
          select jsonb_array_elements_text(v_profile->'industries') x
          union all
          select jsonb_array_elements_text(v_profile->'customer_types') x
        ) s
      ),
      'supporting_capabilities',v_profile->'ideal_signals',
      'hard_exclusions',v_profile->'exclusions',
      'search_strategy',v_profile,
      'verification_policy','Kundens lead-indstillinger er autoritative. Find kun leads der matcher valgte leadtyper, brancher, geografi, størrelsesgrænser og fravalg. Gæt ikke på medarbejderantal, opgaveværdi eller købssignaler.'
    );

  v_settings:=v_settings
    || jsonb_build_object(
      'customer_types',v_profile->'customer_types',
      'exclude_types',v_profile->'exclusions',
      'lead_search_profile',v_profile,
      'capability_profile',v_capability
    );

  update public.crm_clients
  set settings=v_settings,
      geography=coalesce(v_profile->'geography'->>'text',geography)
  where id=p_client_id;

  insert into public.crm_activities(
    client_id,type,actor_type,actor_name,summary,metadata
  ) values (
    p_client_id,
    'Lead-indstillinger',
    'user',
    coalesce(auth.jwt()->>'email',auth.uid()::text),
    'Lead Hunter-kriterier opdateret',
    jsonb_build_object('source','settings_ui','search_profile',v_profile)
  );

  return jsonb_build_object(
    'ok',true,
    'client_id',p_client_id,
    'search_profile',v_profile,
    'settings',v_settings
  );
end
$$;

revoke all on function public.crm_update_lead_search_profile(uuid,jsonb) from public;
grant execute on function public.crm_update_lead_search_profile(uuid,jsonb) to authenticated;


create or replace function public.crm_set_new_lead_pool_limit(p_client_id uuid,p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_old_limit integer;
  v_ny integer;
begin
  if p_client_id is null then raise exception 'Kunde mangler'; end if;
  if p_limit not in (10,20,30) then raise exception 'Lead-puljen skal være 10, 20 eller 30'; end if;
  if auth.uid() is null or not public.crm_can_manage_workspace(p_client_id) then
    raise exception 'Kun ejer/admin eller Platform Owner kan ændre lead-puljen';
  end if;

  select public.crm_new_lead_pool_limit(p_client_id) into v_old_limit;

  if v_old_limit is distinct from p_limit then
    update public.crm_clients
       set settings=jsonb_set(
         coalesce(settings,'{}'::jsonb),
         '{new_lead_pool_limit}',
         to_jsonb(p_limit),
         true
       ),
       updated_at=now()
     where id=p_client_id;

    insert into public.crm_activities(
      client_id,type,actor_type,actor_name,summary,metadata
    ) values (
      p_client_id,
      'Lead settings',
      'user',
      coalesce(auth.jwt()->>'email',auth.uid()::text),
      format('Ny lead-pulje ændret fra %s til %s',v_old_limit,p_limit),
      jsonb_build_object(
        'setting','new_lead_pool_limit',
        'old_value',v_old_limit,
        'new_value',p_limit
      )
    );
  end if;

  select count(*) into v_ny
  from public.crm_leads
  where client_id=p_client_id
    and status='NY'
    and coalesce(lead_pool,'standard')='standard';

  return jsonb_build_object(
    'ok',true,
    'client_id',p_client_id,
    'old_limit',v_old_limit,
    'new_limit',p_limit,
    'current_ny',v_ny,
    'refill_requested',p_limit>v_old_limit
  );
end
$$;

revoke all on function public.crm_set_new_lead_pool_limit(uuid,integer) from public;
grant execute on function public.crm_set_new_lead_pool_limit(uuid,integer) to authenticated;
