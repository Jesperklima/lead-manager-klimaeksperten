-- Platform operations snapshot v2: aggregate-only, MFA-gated.
create or replace function public.crm_platform_ops_snapshot_v2()
returns jsonb
language plpgsql
security definer
set search_path=public,auth,cron
as $$
declare
  v_result jsonb;
begin
  if not public.crm_is_platform_admin() or not public.crm_mfa_satisfied() then
    raise exception 'Access denied';
  end if;

  with client_stats as (
    select
      c.id,
      c.name,
      c.created_at,
      coalesce((select count(*) from public.crm_users u where u.client_id=c.id and u.active),0)::int as active_users,
      (select max(au.last_sign_in_at)
         from public.crm_users u
         join auth.users au on au.id=u.auth_user_id
        where u.client_id=c.id and u.active) as last_login_at,
      (select max(a.created_at) from public.crm_activities a where a.client_id=c.id) as last_activity_at,
      coalesce((select count(*) from public.crm_leads l where l.client_id=c.id),0)::int as lead_count,
      coalesce((select count(*) from public.crm_offers o where o.client_id=c.id),0)::int as offer_count,
      coalesce((select count(*) from public.crm_offers o
                where o.client_id=c.id
                  and upper(coalesce(o.status,'')) not in ('VUNDET','TABT','LUKKET','AFSLUTTET')),0)::int as open_offer_count,
      coalesce((select count(*) from public.crm_integrations i
                where i.client_id=c.id and (i.status in ('error','needs_authorization','needs_reconnect','needs_credentials') or i.last_error is not null)),0)::int as integration_issues,
      coalesce((select count(*) from public.crm_marketing_connections m
                where m.client_id=c.id and (m.status in ('error','needs_credentials') or m.last_error is not null)),0)::int as marketing_issues,
      coalesce((select count(*) from public.crm_external_sync_queue q
                where q.client_id=c.id and (
                  q.status in ('error','dead')
                  or (q.status='queued' and q.created_at < now()-interval '30 minutes')
                  or (q.status='running' and q.locked_at < now()-interval '15 minutes')
                )),0)::int as queue_issues,
      coalesce((select count(*) from public.crm_marketing_inbound_events e
                where e.client_id=c.id and e.status='error' and e.received_at >= now()-interval '24 hours'),0)::int as inbound_errors_24h,
      coalesce((select sum(u.quantity) from public.crm_usage_events u
                where u.client_id=c.id and u.occurred_at >= now()-interval '30 days'),0)::int as usage_30d,
      coalesce((select sum(u.quantity) from public.crm_usage_events u
                where u.client_id=c.id and u.occurred_at >= now()-interval '30 days'
                  and (lower(u.event_type) like '%ai%' or lower(u.event_type) like '%openai%')),0)::int as ai_usage_30d,
      coalesce((select sum(u.quantity) from public.crm_usage_events u
                where u.client_id=c.id and u.occurred_at >= now()-interval '30 days'
                  and lower(u.event_type) like '%mail%'),0)::int as mail_usage_30d,
      coalesce((
        select jsonb_object_agg(x.status,x.n)
        from (
          select l.status,count(*)::int as n
          from public.crm_leads l
          where l.client_id=c.id
          group by l.status
        ) x
      ),'{}'::jsonb) as lead_statuses,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'provider',i.provider,
          'status',i.status,
          'account',i.account,
          'last_sync_at',i.last_sync_at,
          'has_error',(i.last_error is not null)
        ) order by i.provider)
        from public.crm_integrations i
        where i.client_id=c.id
      ),'[]'::jsonb) as integrations
    from public.crm_clients c
  ),
  cron_stats as (
    select
      coalesce((select count(*) from cron.job where active),0)::int as active_jobs,
      coalesce((select count(*) from cron.job_run_details
                where start_time >= now()-interval '24 hours'
                  and status <> 'succeeded'),0)::int as failed_runs_24h,
      (select max(start_time) from cron.job_run_details where status <> 'succeeded') as last_failed_run_at
  ),
  totals as (
    select
      count(*)::int as workspaces,
      count(*) filter(where integration_issues+marketing_issues+queue_issues+inbound_errors_24h>0)::int as needs_attention,
      coalesce(sum(integration_issues+marketing_issues),0)::int as integration_issues,
      coalesce(sum(queue_issues),0)::int as queue_issues,
      coalesce(sum(inbound_errors_24h),0)::int as inbound_errors_24h,
      coalesce(sum(usage_30d),0)::int as usage_30d,
      coalesce(sum(ai_usage_30d),0)::int as ai_usage_30d,
      coalesce(sum(mail_usage_30d),0)::int as mail_usage_30d
    from client_stats
  )
  select jsonb_build_object(
    'generated_at',now(),
    'summary',jsonb_build_object(
      'workspaces',t.workspaces,
      'needs_attention',t.needs_attention,
      'integration_issues',t.integration_issues,
      'queue_issues',t.queue_issues,
      'inbound_errors_24h',t.inbound_errors_24h,
      'usage_30d',t.usage_30d,
      'ai_usage_30d',t.ai_usage_30d,
      'mail_usage_30d',t.mail_usage_30d,
      'active_cron_jobs',cs.active_jobs,
      'cron_failures_24h',cs.failed_runs_24h,
      'last_cron_failure_at',cs.last_failed_run_at
    ),
    'workspaces',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,
        'name',s.name,
        'created_at',s.created_at,
        'active_users',s.active_users,
        'last_login_at',s.last_login_at,
        'last_activity_at',s.last_activity_at,
        'lead_count',s.lead_count,
        'offer_count',s.offer_count,
        'open_offer_count',s.open_offer_count,
        'integration_issues',s.integration_issues,
        'marketing_issues',s.marketing_issues,
        'queue_issues',s.queue_issues,
        'inbound_errors_24h',s.inbound_errors_24h,
        'usage_30d',s.usage_30d,
        'ai_usage_30d',s.ai_usage_30d,
        'mail_usage_30d',s.mail_usage_30d,
        'lead_statuses',s.lead_statuses,
        'integrations',s.integrations,
        'needs_attention',(s.integration_issues+s.marketing_issues+s.queue_issues+s.inbound_errors_24h>0)
      ) order by
        (s.integration_issues+s.marketing_issues+s.queue_issues+s.inbound_errors_24h>0) desc,
        greatest(coalesce(s.last_activity_at,'epoch'::timestamptz),coalesce(s.last_login_at,'epoch'::timestamptz)) desc,
        s.name
      )
      from client_stats s
    ),'[]'::jsonb)
  )
  into v_result
  from totals t cross join cron_stats cs;

  return v_result;
end;
$$;

revoke all on function public.crm_platform_ops_snapshot_v2() from public,anon;
grant execute on function public.crm_platform_ops_snapshot_v2() to authenticated,service_role;
