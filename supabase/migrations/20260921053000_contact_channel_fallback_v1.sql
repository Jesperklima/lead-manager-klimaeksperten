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

revoke all on function public.crm_enqueue_missing_contact_channels(uuid) from public;
grant execute on function public.crm_enqueue_missing_contact_channels(uuid) to authenticated, service_role;

create or replace function public.crm_lead_contact_channel_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status not in ('TABT','IKKE RELEVANT','VUNDET') then
    perform public.crm_enqueue_missing_contact_channels(new.client_id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_crm_lead_contact_channel_guard on public.crm_leads;
create trigger trg_crm_lead_contact_channel_guard
after insert or update of company_id,status on public.crm_leads
for each row execute function public.crm_lead_contact_channel_guard();

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='lead-contact-channel-sweep'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'lead-contact-channel-sweep',
  '17,47 * * * *',
  $cron$select public.crm_enqueue_missing_contact_channels(null);$cron$
);

select public.crm_enqueue_missing_contact_channels(null);
