create or replace function public.crm_lead_launch_status(p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.crm_client_legal_profiles%rowtype; plan text; reason text; accepted boolean:=false;
begin
 select plan_code into plan from public.crm_usage_limits where client_id=p_client_id;
 select * into p from public.crm_client_legal_profiles where client_id=p_client_id;
 if not found then reason:='legal_profile_missing';
 elsif p.service_model='internal_controller' and p.legal_status='approved' and p.agreement_status='not_applicable' and not p.requires_legal_review and p.legal_reviewed_at is not null then
   return jsonb_build_object('ready',true,'internal',true);
 elsif p.requires_legal_review or p.legal_status in ('draft','review_required','blocked') then reason:='legal_role_review_required';
 elsif p.agreement_status='accepted' then
   select exists(select 1 from public.crm_legal_agreement_acceptances a where a.client_id=p_client_id and a.agreement_type=p.agreement_type and a.agreement_version=p.agreement_version and a.accepted_at is not null and nullif(a.rendered_hash,'') is not null) into accepted;
   if not accepted then reason:='legal_agreement_evidence_missing';end if;
 elsif p.agreement_status='documented' and nullif(p.agreement_evidence_url,'') is not null and p.legal_reviewed_at is not null then accepted:=true;
 else reason:='legal_agreement_pending';end if;
 return jsonb_build_object('ready',reason is null and accepted,'reason',reason,'agreement_status',p.agreement_status);
end;$$;
revoke all on function public.crm_lead_launch_status(uuid) from public,anon,authenticated;
grant execute on function public.crm_lead_launch_status(uuid) to service_role;
