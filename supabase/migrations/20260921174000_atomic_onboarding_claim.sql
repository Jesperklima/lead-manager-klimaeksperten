create or replace function public.crm_finalize_onboarding_invite(p_token_hash text, p_user_id uuid, p_verified_email text)
returns jsonb
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  invitation public.crm_onboarding_invites%rowtype;
  membership public.crm_users%rowtype;
  account_email text;
  actual_plan text;
  company_name text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  select * into invitation from public.crm_onboarding_invites
    where token_hash = p_token_hash for update;
  if not found then raise exception 'INVALID_INVITE'; end if;
  if invitation.status = 'revoked' then raise exception 'INVITE_REVOKED'; end if;
  if invitation.expires_at <= clock_timestamp() or invitation.status = 'expired' then
    raise exception 'INVITE_EXPIRED';
  end if;
  if invitation.status not in ('created','sent','claimed') then raise exception 'INVALID_INVITE'; end if;
  account_email := lower(trim(p_verified_email));
  if account_email is distinct from lower(invitation.email) then raise exception 'EMAIL_MISMATCH'; end if;
  select * into membership from public.crm_users
    where client_id = invitation.client_id and lower(email) = account_email and active for update;
  if not found then raise exception 'MEMBERSHIP_MISSING'; end if;
  if membership.auth_user_id is not null and membership.auth_user_id <> p_user_id then
    raise exception 'MEMBERSHIP_USER_MISMATCH';
  end if;
  if invitation.status = 'claimed' or invitation.used_at is not null then
    if membership.auth_user_id is distinct from p_user_id
      or invitation.metadata->>'claimed_user_id' is distinct from p_user_id::text then
      raise exception 'INVITE_USED';
    end if;
  end if;
  select name into company_name from public.crm_clients where id = invitation.client_id for update;
  if not found then raise exception 'WORKSPACE_MISSING'; end if;
  select plan_code into actual_plan from public.crm_usage_limits where client_id = invitation.client_id;
  if actual_plan is null then
    perform public.crm_apply_plan(invitation.client_id, invitation.plan_code);
    actual_plan := invitation.plan_code;
  end if;
  update public.crm_users set auth_user_id = p_user_id
    where client_id = invitation.client_id and email = membership.email and active;
  update public.crm_onboarding_invites
    set status = 'claimed', used_at = coalesce(used_at, clock_timestamp()),
        metadata = metadata || jsonb_build_object('claimed_user_id',p_user_id)
    where id = invitation.id;
  return jsonb_build_object('ok',true,'claimed',true,'email',account_email,
    'client_id',invitation.client_id,'company_name',company_name,'plan_code',actual_plan);
end;
$$;
revoke all on function public.crm_finalize_onboarding_invite(text,uuid,text) from public, anon, authenticated;
grant execute on function public.crm_finalize_onboarding_invite(text,uuid,text) to service_role;

create or replace function public.crm_issue_onboarding_invite(
  p_client_id uuid, p_email text, p_token_hash text, p_expires_at timestamptz,
  p_actor_id uuid, p_actor_email text)
returns jsonb
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  membership public.crm_users%rowtype;
  company_name text;
  plan text;
  invitation_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '15 days' then raise exception 'INVALID_INVITE'; end if;
  select * into membership from public.crm_users
    where client_id=p_client_id and lower(email)=lower(trim(p_email)) and active for update;
  if not found then raise exception 'MEMBERSHIP_MISSING'; end if;
  select name into company_name from public.crm_clients where id=p_client_id;
  select plan_code into plan from public.crm_usage_limits where client_id=p_client_id;
  if plan is null or plan not in ('start','pro','business') then raise exception 'PLAN_MISSING'; end if;
  update public.crm_onboarding_invites set status='revoked'
    where client_id=p_client_id and lower(email)=lower(membership.email)
      and status in ('created','sent','send_failed') and used_at is null;
  insert into public.crm_onboarding_invites(client_id,email,token_hash,plan_code,status,expires_at,created_by_user_id,created_by_email,metadata)
    values(p_client_id,membership.email,p_token_hash,plan,'created',p_expires_at,p_actor_id,p_actor_email,
      jsonb_build_object('company_name',company_name,'onboarding_version','saas_v6','reissued',true))
    returning id into invitation_id;
  return jsonb_build_object('id',invitation_id,'client_id',p_client_id,'email',membership.email,
    'company_name',company_name,'plan_code',plan,'expires_at',p_expires_at);
end;
$$;
revoke all on function public.crm_issue_onboarding_invite(uuid,text,text,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_issue_onboarding_invite(uuid,text,text,timestamptz,uuid,text) to service_role;
