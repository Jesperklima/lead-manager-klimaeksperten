alter table public.crm_companies
  add column if not exists email text;

comment on column public.crm_companies.email is
  'Verificeret generel virksomheds-/myndighedsmail, fx info@ eller kommunen@. Ikke en udledt personmail.';

create or replace function public.crm_enqueue_missing_contact_channels(p_client_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
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
$$;

update public.crm_companies
set email='kommunen@gladsaxe.dk',
    research_updated_at=now()
where id='36356927-ff0b-4755-b25a-86e68f759431'::uuid
  and client_id='9b6b08bd-e9ce-40c3-8ffa-aa18e859d3af'::uuid
  and coalesce(trim(email),'')='';

select public.crm_enqueue_missing_contact_channels(null);
