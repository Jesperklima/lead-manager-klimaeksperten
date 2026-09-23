-- Reliable Gmail send pipeline.
-- Keeps the provider send on the fast path and moves CRM follow-up bookkeeping
-- into a transactional post-processing step.

create table if not exists public.crm_mail_send_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  send_id uuid not null,
  user_id uuid,
  user_email text,
  company_id uuid,
  lead_id uuid,
  offer_id uuid,
  contact_id uuid,
  approval_id uuid,
  to_email text not null,
  subject text not null,
  body_text text not null,
  follow_up_date date not null,
  follow_up_at timestamptz not null,
  from_email text,
  sender_name text,
  ai_generated boolean not null default false,
  ai_model text,
  signature_appended boolean not null default false,
  message_rfc822_id text not null,
  gmail_message_id text,
  gmail_thread_id text,
  status text not null default 'prepared'
    check (status in ('prepared','sending','sent_pending_postprocess','postprocessing','sent','failed','unknown')),
  attempt_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  postprocessed_at timestamptz,
  last_status_check_at timestamptz,
  unique(client_id, send_id)
);

create index if not exists crm_mail_send_jobs_pending_idx
  on public.crm_mail_send_jobs(status, created_at)
  where status in ('sent_pending_postprocess','postprocessing');

alter table public.crm_mail_send_jobs enable row level security;
revoke all on table public.crm_mail_send_jobs from public, anon, authenticated;
grant all on table public.crm_mail_send_jobs to service_role;

create or replace function public.crm_finalize_mail_send_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  j public.crm_mail_send_jobs%rowtype;
  c public.crm_clients%rowtype;
  o public.crm_offers%rowtype;
  l public.crm_leads%rowtype;
  v_task_id uuid;
  v_assigned_to text;
  v_next_action text;
  v_now timestamptz := now();
begin
  select * into j
  from public.crm_mail_send_jobs
  where id=p_job_id
  for update;

  if not found then
    raise exception 'MAIL_SEND_JOB_NOT_FOUND';
  end if;

  if j.status='sent' then
    return jsonb_build_object('ok',true,'status','sent','job_id',j.id,'already_finalized',true);
  end if;

  if j.status not in ('sent_pending_postprocess','postprocessing') or j.gmail_message_id is null then
    raise exception 'MAIL_SEND_JOB_NOT_READY:%',j.status;
  end if;

  update public.crm_mail_send_jobs
  set status='postprocessing',updated_at=v_now,error_code=null,error_message=null
  where id=j.id;

  select * into c from public.crm_clients where id=j.client_id;
  if not found then raise exception 'MAIL_SEND_CLIENT_NOT_FOUND'; end if;

  if j.offer_id is not null then
    select * into o from public.crm_offers where id=j.offer_id and client_id=j.client_id;
  end if;
  if j.lead_id is not null then
    select * into l from public.crm_leads where id=j.lead_id and client_id=j.client_id;
  end if;

  if not exists (
    select 1 from public.crm_mail_messages
    where client_id=j.client_id and provider='gmail' and external_message_id=j.gmail_message_id
  ) then
    insert into public.crm_mail_messages(
      client_id,company_id,lead_id,offer_id,contact_id,provider,
      external_message_id,external_thread_id,direction,from_email,to_emails,cc_emails,
      subject,body_text,message_at,metadata
    ) values (
      j.client_id,j.company_id,j.lead_id,j.offer_id,j.contact_id,'gmail',
      j.gmail_message_id,j.gmail_thread_id,'outbound',j.from_email,
      jsonb_build_array(j.to_email),'[]'::jsonb,
      j.subject,j.body_text,coalesce(j.sent_at,v_now),
      jsonb_build_object(
        'direct_send',true,
        'sender_name',j.sender_name,
        'approved_by',j.user_email,
        'approval_id',j.approval_id,
        'ai_generated',j.ai_generated,
        'ai_model',j.ai_model,
        'signature_appended',j.signature_appended,
        'signature_version','client_default',
        'follow_up_date',j.follow_up_date,
        'follow_up_at',j.follow_up_at,
        'offer_ref',case when j.offer_id is not null then o.offer_ref else null end,
        'mail_send_job_id',j.id,
        'send_id',j.send_id
      )
    );
  end if;

  if not exists (
    select 1 from public.crm_activities
    where client_id=j.client_id
      and metadata->>'mail_send_job_id'=j.id::text
      and metadata->>'postprocess_step'='outbound_activity'
  ) then
    insert into public.crm_activities(
      client_id,company_id,lead_id,offer_id,contact_id,type,actor_type,actor_name,summary,metadata
    ) values (
      j.client_id,j.company_id,j.lead_id,j.offer_id,j.contact_id,
      'Udgående mail','user',j.user_email,
      'Mail sendt fra '||
        case when coalesce(j.sender_name,'')<>'' then j.sender_name||' <'||coalesce(j.from_email,'')||'>' else coalesce(j.from_email,'') end
        ||': '||j.subject,
      jsonb_build_object(
        'provider','gmail',
        'sender_name',j.sender_name,
        'external_message_id',j.gmail_message_id,
        'external_thread_id',j.gmail_thread_id,
        'to',j.to_email,
        'approval_id',j.approval_id,
        'ai_generated',j.ai_generated,
        'signature_version','client_default',
        'follow_up_date',j.follow_up_date,
        'follow_up_at',j.follow_up_at,
        'offer_ref',case when j.offer_id is not null then o.offer_ref else null end,
        'mail_send_job_id',j.id,
        'send_id',j.send_id,
        'postprocess_step','outbound_activity'
      )
    );
  end if;

  if not exists (
    select 1 from public.crm_usage_events
    where client_id=j.client_id
      and event_type='mail_send'
      and metadata->>'mail_send_job_id'=j.id::text
  ) then
    insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
    values (
      j.client_id,'mail_send',1,
      jsonb_build_object(
        'lead_id',j.lead_id,
        'offer_id',j.offer_id,
        'provider','gmail',
        'explicit_send_button',true,
        'mail_send_job_id',j.id,
        'send_id',j.send_id
      )
    );
  end if;

  if j.offer_id is not null and o.id is not null then
    update public.crm_offers
    set follow_up_date=j.follow_up_date,
        contact_details=case when nullif(trim(coalesce(contact_details,'')),'') is null then j.to_email else contact_details end,
        updated_at=v_now
    where id=o.id and client_id=j.client_id;

    select id into v_task_id
    from public.crm_tasks
    where client_id=j.client_id and offer_id=o.id and task_type='offer_followup' and status='open'
    order by created_at desc
    limit 1;

    v_assigned_to:=coalesce(nullif(trim(o.follow_up_owner),''),nullif(trim(c.settings->>'default_owner_name'),''),j.user_email);
    if v_task_id is not null then
      update public.crm_tasks set
        lead_id=j.lead_id,company_id=j.company_id,
        title='Følg op på tilbud '||coalesce(o.offer_ref,'')||' efter mail',
        task_type='offer_followup',scheduled_at=j.follow_up_at,planning_type='flexible',
        status='open',priority='A',assigned_to=v_assigned_to,calendar_sync_status='none',
        sync_origin='lead_manager_offer_mail',updated_at=v_now
      where id=v_task_id;
    else
      insert into public.crm_tasks(
        client_id,lead_id,offer_id,company_id,title,task_type,scheduled_at,planning_type,
        status,priority,assigned_to,calendar_sync_status,sync_origin
      ) values (
        j.client_id,j.lead_id,o.id,j.company_id,
        'Følg op på tilbud '||coalesce(o.offer_ref,'')||' efter mail',
        'offer_followup',j.follow_up_at,'flexible','open','A',v_assigned_to,'none','lead_manager_offer_mail'
      );
    end if;

    if not exists (
      select 1 from public.crm_activities
      where client_id=j.client_id
        and metadata->>'mail_send_job_id'=j.id::text
        and metadata->>'postprocess_step'='followup_activity'
    ) then
      insert into public.crm_activities(
        client_id,company_id,lead_id,offer_id,contact_id,type,actor_type,actor_name,summary,metadata
      ) values (
        j.client_id,j.company_id,j.lead_id,o.id,j.contact_id,'Planlægning','user',j.user_email,
        'Opfølgning efter sendt mail på tilbud '||coalesce(o.offer_ref,'')||' sat til '||j.follow_up_date::text,
        jsonb_build_object(
          'source','direct_offer_email_send','provider','gmail',
          'follow_up_date',j.follow_up_date,'follow_up_at',j.follow_up_at,'subject',j.subject,
          'mail_send_job_id',j.id,'send_id',j.send_id,'postprocess_step','followup_activity'
        )
      );
    end if;
  elsif j.lead_id is not null and l.id is not null then
    v_next_action:=left('Følg op på mail: '||j.subject,180);
    update public.crm_leads
    set next_action=v_next_action,next_at=j.follow_up_at,planning_type='flexible',updated_at=v_now
    where id=l.id and client_id=j.client_id;

    select id into v_task_id
    from public.crm_tasks
    where client_id=j.client_id and lead_id=l.id and task_type='lead_followup' and status='open'
    order by created_at desc
    limit 1;

    v_assigned_to:=coalesce(nullif(trim(c.settings->>'default_owner_name'),''),j.user_email);
    if v_task_id is not null then
      update public.crm_tasks set
        company_id=j.company_id,title=v_next_action,task_type='lead_followup',
        scheduled_at=j.follow_up_at,planning_type='flexible',status='open',
        priority=l.priority,assigned_to=v_assigned_to,calendar_sync_status='none',
        sync_origin='lead_manager_mail',updated_at=v_now
      where id=v_task_id;
    else
      insert into public.crm_tasks(
        client_id,lead_id,company_id,title,task_type,scheduled_at,planning_type,status,
        priority,assigned_to,calendar_sync_status,sync_origin
      ) values (
        j.client_id,l.id,j.company_id,v_next_action,'lead_followup',j.follow_up_at,'flexible',
        'open',l.priority,v_assigned_to,'none','lead_manager_mail'
      );
    end if;

    if not exists (
      select 1 from public.crm_activities
      where client_id=j.client_id
        and metadata->>'mail_send_job_id'=j.id::text
        and metadata->>'postprocess_step'='followup_activity'
    ) then
      insert into public.crm_activities(
        client_id,company_id,lead_id,contact_id,type,actor_type,actor_name,summary,metadata
      ) values (
        j.client_id,j.company_id,l.id,j.contact_id,'Planlægning','user',j.user_email,
        'Opfølgning efter sendt mail sat til '||j.follow_up_date::text,
        jsonb_build_object(
          'source','direct_email_send','follow_up_date',j.follow_up_date,
          'follow_up_at',j.follow_up_at,'subject',j.subject,
          'mail_send_job_id',j.id,'send_id',j.send_id,'postprocess_step','followup_activity'
        )
      );
    end if;
  end if;

  update public.crm_integrations
  set status='connected',last_sync_at=v_now,last_error=null,updated_at=v_now
  where client_id=j.client_id and provider='gmail';

  update public.crm_mail_send_jobs
  set status='sent',postprocessed_at=v_now,updated_at=v_now,error_code=null,error_message=null
  where id=j.id;

  return jsonb_build_object(
    'ok',true,'status','sent','job_id',j.id,
    'gmail_message_id',j.gmail_message_id,'gmail_thread_id',j.gmail_thread_id
  );
exception
  when others then
    update public.crm_mail_send_jobs
    set status=case when gmail_message_id is not null then 'sent_pending_postprocess' else status end,
        error_code='POSTPROCESS_ERROR',
        error_message=left(sqlerrm,1000),
        updated_at=now()
    where id=p_job_id;
    raise;
end;
$$;

revoke all on function public.crm_finalize_mail_send_job(uuid) from public,anon,authenticated;
grant execute on function public.crm_finalize_mail_send_job(uuid) to service_role;
