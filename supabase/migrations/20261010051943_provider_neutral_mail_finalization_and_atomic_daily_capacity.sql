alter table public.crm_mail_send_jobs add column if not exists provider text not null default 'gmail' check (provider in ('gmail','microsoft'));
alter table public.crm_mail_send_jobs add column if not exists provider_message_id text;
alter table public.crm_mail_send_jobs add column if not exists provider_thread_id text;
CREATE OR REPLACE FUNCTION public.crm_finalize_mail_send_job(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if j.status not in ('sent_pending_postprocess','postprocessing') or coalesce(j.provider_message_id,j.gmail_message_id) is null then
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
    where client_id=j.client_id and provider=j.provider and external_message_id=coalesce(j.provider_message_id,j.gmail_message_id)
  ) then
    insert into public.crm_mail_messages(
      client_id,company_id,lead_id,offer_id,contact_id,provider,
      external_message_id,external_thread_id,direction,from_email,to_emails,cc_emails,
      subject,body_text,message_at,metadata
    ) values (
      j.client_id,j.company_id,j.lead_id,j.offer_id,j.contact_id,j.provider,
      coalesce(j.provider_message_id,j.gmail_message_id),coalesce(j.provider_thread_id,j.gmail_thread_id),'outbound',j.from_email,
      jsonb_build_array(j.to_email),'[]'::jsonb,
      j.subject,j.body_text,coalesce(j.sent_at,v_now),
      jsonb_build_object(
        'direct_send',true,'provider_accepted',true,'delivery_confirmed',false,
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
        'provider',j.provider,
        'sender_name',j.sender_name,
        'external_message_id',coalesce(j.provider_message_id,j.gmail_message_id),
        'external_thread_id',coalesce(j.provider_thread_id,j.gmail_thread_id),
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
        'provider',j.provider,
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
          'source','direct_offer_email_send','provider',j.provider,
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
  where client_id=j.client_id and provider=j.provider;

  update public.crm_mail_send_jobs
  set status='sent',postprocessed_at=v_now,updated_at=v_now,error_code=null,error_message=null
  where id=j.id;

  return jsonb_build_object(
    'ok',true,'status','sent','job_id',j.id,
    'gmail_message_id',coalesce(j.provider_message_id,j.gmail_message_id),'gmail_thread_id',coalesce(j.provider_thread_id,j.gmail_thread_id)
  );
exception
  when others then
    update public.crm_mail_send_jobs
    set status=case when coalesce(provider_message_id,gmail_message_id) is not null then 'sent_pending_postprocess' else status end,
        error_code='POSTPROCESS_ERROR',
        error_message=left(sqlerrm,1000),
        updated_at=now()
    where id=p_job_id;
    raise;
end;
$function$
;
create or replace function public.crm_reserve_mail_daily_capacity() returns trigger language plpgsql security definer set search_path=public as $$
declare max_daily integer; enabled boolean; sent numeric; reserved bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('mail_capacity:'||new.client_id::text,0));
 if exists(select 1 from public.crm_mail_send_jobs where client_id=new.client_id and send_id=new.send_id) then return new;end if;
 select coalesce(daily_mail_send_limit,100),allow_mail_send into max_daily,enabled from public.crm_usage_limits where client_id=new.client_id;
 if enabled=false then raise exception 'PLAN_MAIL_DISABLED'; end if;
 max_daily:=coalesce(max_daily,100);
 select coalesce(sum(quantity),0) into sent from public.crm_usage_events where client_id=new.client_id and event_type='mail_send' and created_at>=date_trunc('day',now());
 select count(*) into reserved from public.crm_mail_send_jobs j where j.client_id=new.client_id and j.created_at>=date_trunc('day',now()) and j.status<>'failed'
 and not exists(select 1 from public.crm_usage_events e where e.client_id=j.client_id and e.event_type='mail_send' and e.metadata->>'mail_send_job_id'=j.id::text);
 if sent+reserved>=max_daily then raise exception 'MAIL_DAILY_LIMIT';end if;
 return new;
end;$$;
revoke all on function public.crm_reserve_mail_daily_capacity() from public,anon,authenticated;
create trigger crm_reserve_mail_daily_capacity before insert on public.crm_mail_send_jobs for each row execute function public.crm_reserve_mail_daily_capacity();
