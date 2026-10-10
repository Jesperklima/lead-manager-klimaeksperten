CREATE OR REPLACE FUNCTION public.crm_marketing_prospect_quality_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_name text:=lower(btrim(coalesce(new.display_name,'')));
  v_ref text:=lower(btrim(coalesce(new.external_person_ref,'')));
  v_msg text:=lower(btrim(coalesce(new.metadata->>'latest_message',new.metadata->>'interest','')));
  v_platform text:=lower(btrim(coalesce(new.metadata->>'platform','')));
  v_contact_requested boolean:=false;
  v_is_test boolean:=false;
  v_handle text;
begin
  v_is_test :=
    coalesce((new.metadata->>'is_test')::boolean,false)
    or v_name ~ '^(e2e|test)[_-]'
    or v_ref ~ '(^|:)(@)?(e2e|test)[_-]';

  if v_is_test then
    new.stage:='rejected';
    new.rejection_reason:='Automatisk test/E2E-signal';
    new.engagement_score:=0;
    new.intent_score:=0;
    new.consent_to_contact:=false;
    new.contact_basis:=null;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'is_test',true,
      'quality_status','test_filtered',
      'contact_note','Testsignal – må ikke oprettes som rigtigt CRM-lead.'
    );
    return new;
  end if;

  v_contact_requested :=
    v_msg ~ '(kontakt(e|er)?[[:space:]]+(mig|os)|kan[[:space:]]+i[[:space:]]+kontakte|ring(e|er)?[[:space:]]+(til[[:space:]]+)?(mig|os)|må[[:space:]]+i[[:space:]]+gerne[[:space:]]+ringe|skriv[[:space:]]+til[[:space:]]+(mig|os)|send[[:space:]]+(mig|os)|dm[[:space:]]+(mig|os))';

  if v_contact_requested then
    -- A phrase in an old comment is evidence for review, not consent. Never restore withdrawn permission.
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'contact_requested',true,
      'contact_note','Personen har selv bedt om kontakt i den indgående henvendelse.'
    );
  else
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('contact_requested',false);
  end if;

  if v_platform='instagram' and nullif(v_name,'') is not null and (new.social_profile_url is null or new.social_profile_url ~ '/(p|reel)/') then
    v_handle:=regexp_replace(v_name,'^@','','g');
    if v_handle ~ '^[a-z0-9._]+$' then
      new.social_profile_url:='https://www.instagram.com/'||v_handle||'/';
    end if;
  end if;

  if new.prospect_type='unknown' and nullif(btrim(coalesce(new.company_name,'')),'') is null and nullif(btrim(coalesce(new.metadata->>'cvr','')),'') is null then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('identity_status','missing_company');
  else
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('identity_status','identified');
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_enqueue_missing_contact_channels(p_client_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inserted integer := 0;
begin
  if public.crm_openai_billing_circuit_active() then return 0; end if;
  with candidates as (
    select distinct on (l.client_id,l.company_id)
      l.id as lead_id,
      l.client_id,
      l.company_id,
      c.name as company_name
    from public.crm_leads l
    join public.crm_companies c on c.id=l.company_id and c.client_id=l.client_id
    where (p_client_id is null or l.client_id=p_client_id)
      and l.status not in ('TABT','IKKE RELEVANT','VUNDET')
      and coalesce(trim(c.phone),'')=''
      and coalesce(trim(c.email),'')=''
      and not exists (
        select 1
        from public.crm_contacts ct
        where ct.client_id=l.client_id
          and ct.company_id=l.company_id
          and (coalesce(trim(ct.phone),'')<>'' or coalesce(trim(ct.email),'')<>'')
      )
      and not exists (
        select 1
        from public.crm_agent_requests r
        where r.client_id=l.client_id
          and r.company_id=l.company_id
          and r.status in ('queued','running')
          and r.payload->>'action'='contact_enrichment'
      )
    order by l.client_id,l.company_id,l.updated_at desc nulls last,l.created_at desc
  )
  insert into public.crm_agent_requests(
    client_id,company_id,lead_id,request_type,request_text,status,payload,created_by
  )
  select
    x.client_id,
    x.company_id,
    x.lead_id,
    'lead_manager_command',
    'Find og verificér mindst én brugbar offentlig kontaktkanal for '||x.company_name||
      '. Prioritér officiel hovedtelefon eller generel e-mail. Find derefter relevant kontaktperson, hvis muligt. Gem aldrig gættede kontaktdata.',
    'queued',
    jsonb_build_object(
      'action','contact_enrichment',
      'company_name',x.company_name,
      'requested_from','automatic_missing_contact',
      'reason','active_lead_without_contact_channel'
    ),
    'contact_channel_guard'
  from candidates x;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_contact_enrichment_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare v_secret text;
begin
  if new.status='queued' and coalesce(new.payload->>'action','')='contact_enrichment'
     and not public.crm_openai_billing_circuit_active() then
    select decrypted_secret into v_secret from vault.decrypted_secrets where name='lead_enrichment_worker_secret' limit 1;
    if v_secret is null or btrim(v_secret)='' then raise exception 'Lead enrichment worker secret missing from Vault'; end if;
    perform net.http_post(
      url := 'https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/lead-enrichment-worker',
      body := jsonb_build_object('request_id',new.id::text),
      params := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json','x-lead-worker-secret',v_secret),
      timeout_milliseconds := 10000
    );
  end if;
  return new;
end;
$function$;
;
