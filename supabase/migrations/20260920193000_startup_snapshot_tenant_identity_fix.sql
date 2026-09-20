create or replace function public.crm_startup_snapshot(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
declare
  result jsonb;
begin
  if p_client_id is null or not public.crm_has_client_access(p_client_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select jsonb_build_object(
    'companies', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.name)
      from (
        select id,client_id,name,cvr,domain,phone,address,stoplisted,created_at,relationship_status,
               do_not_contact,do_not_contact_reason,industry,website_url,employee_size_text,company_summary,
               research_updated_at,minuba_relationship_status,minuba_relationship_summary,minuba_exact_match,
               minuba_chain_match,minuba_order_count,minuba_latest_order_date,minuba_latest_order_number,
               minuba_latest_order_address,minuba_related_locations,minuba_checked_at,legal_form,
               advertising_protected,robinson_check_required,robinson_checked_at,robinson_blocked,
               contact_compliance_status
        from public.crm_companies
        where client_id=p_client_id
      ) x
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
      from (
        select *
        from public.crm_leads
        where client_id=p_client_id
      ) x
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select id,client_id,type,summary,metadata,lead_id,company_id,created_at
        from public.crm_activities
        where client_id=p_client_id
          and created_at >= now()-interval '45 days'
        order by created_at desc
        limit 500
      ) x
    ), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.follow_up_date asc nulls last)
      from (
        select id,client_id,company_id,lead_id,opportunity_id,offer_ref,customer_name,installation_address,
               sent_date,follow_up_date,follow_up_month,follow_up_owner,contact_person,contact_details,status,
               status_reason,current_comment,source_file,source_sheet,source_row,data_warning,created_at,updated_at,
               manual_lock,status_source,status_updated_at,minuba_status,minuba_record_type,minuba_order_number,
               minuba_last_checked_at,minuba_last_seen_at,minuba_sync_state
        from public.crm_offers
        where client_id=p_client_id
      ) x
    ), '[]'::jsonb),
    'approvals', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select id,client_id,status,created_at
        from public.crm_approvals
        where client_id=p_client_id
          and status='pending'
      ) x
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.scheduled_at asc nulls last)
      from (
        select *
        from public.crm_tasks
        where client_id=p_client_id
      ) x
    ), '[]'::jsonb),
    'mail_count', (
      select count(*) from public.crm_mail_messages where client_id=p_client_id
    )
  ) into result;

  return result;
end
$function$;

revoke all on function public.crm_startup_snapshot(uuid) from public;
revoke all on function public.crm_startup_snapshot(uuid) from anon;
grant execute on function public.crm_startup_snapshot(uuid) to authenticated;
