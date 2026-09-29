-- Lead Manager first-login one-time code guard.
-- The raw code and verification ticket are never stored; only SHA-256 hashes live in invite metadata.

create or replace function public.crm_verify_onboarding_code(
  p_token_hash text,
  p_code_hash text,
  p_ticket_hash text,
  p_ticket_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  invitation public.crm_onboarding_invites%rowtype;
  attempts integer;
  max_attempts integer;
  otp_hash text;
  otp_expires_at timestamptz;
  remaining integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_token_hash !~ '^[a-f0-9]{64}$'
    or p_code_hash !~ '^[a-f0-9]{64}$'
    or p_ticket_hash !~ '^[a-f0-9]{64}$'
    or p_ticket_expires_at <= clock_timestamp()
    or p_ticket_expires_at > clock_timestamp() + interval '20 minutes' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VERIFICATION');
  end if;

  select *
  into invitation
  from public.crm_onboarding_invites
  where token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INVITE');
  end if;

  if invitation.status = 'revoked' then
    return jsonb_build_object('ok', false, 'code', 'INVITE_REVOKED');
  end if;

  if invitation.status = 'claimed' or invitation.used_at is not null then
    return jsonb_build_object('ok', false, 'code', 'INVITE_USED');
  end if;

  if invitation.expires_at <= clock_timestamp() or invitation.status = 'expired' then
    return jsonb_build_object('ok', false, 'code', 'INVITE_EXPIRED');
  end if;

  if invitation.status not in ('created', 'sent') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INVITE');
  end if;

  otp_hash := nullif(invitation.metadata->>'otp_hash', '');
  if otp_hash is null then
    return jsonb_build_object('ok', false, 'code', 'CODE_NOT_CONFIGURED');
  end if;

  begin
    otp_expires_at := nullif(invitation.metadata->>'otp_expires_at', '')::timestamptz;
  exception when others then
    otp_expires_at := null;
  end;

  if otp_expires_at is null or otp_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'CODE_EXPIRED');
  end if;

  attempts := greatest(0, coalesce(nullif(invitation.metadata->>'otp_attempts', '')::integer, 0));
  max_attempts := least(10, greatest(1, coalesce(nullif(invitation.metadata->>'otp_max_attempts', '')::integer, 5)));

  if invitation.metadata ? 'otp_locked_at' or attempts >= max_attempts then
    return jsonb_build_object('ok', false, 'code', 'CODE_LOCKED', 'attempts_remaining', 0);
  end if;

  if p_code_hash is distinct from otp_hash then
    attempts := attempts + 1;
    remaining := greatest(0, max_attempts - attempts);

    update public.crm_onboarding_invites
    set metadata = metadata
      || jsonb_build_object(
        'otp_attempts', attempts,
        'otp_last_attempt_at', clock_timestamp()
      )
      || case when attempts >= max_attempts
        then jsonb_build_object('otp_locked_at', clock_timestamp())
        else '{}'::jsonb
      end
    where id = invitation.id;

    return jsonb_build_object(
      'ok', false,
      'code', case when attempts >= max_attempts then 'CODE_LOCKED' else 'CODE_INVALID' end,
      'attempts_remaining', remaining
    );
  end if;

  update public.crm_onboarding_invites
  set metadata = metadata || jsonb_build_object(
    'otp_verified_at', to_jsonb(clock_timestamp()),
    'password_ticket_hash', p_ticket_hash,
    'password_ticket_expires_at', p_ticket_expires_at,
    'otp_last_attempt_at', clock_timestamp()
  )
  where id = invitation.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'CODE_VERIFIED',
    'attempts_remaining', greatest(0, max_attempts - attempts),
    'ticket_expires_at', p_ticket_expires_at
  );
end;
$$;

revoke all on function public.crm_verify_onboarding_code(text,text,text,timestamptz) from public;
revoke all on function public.crm_verify_onboarding_code(text,text,text,timestamptz) from anon;
revoke all on function public.crm_verify_onboarding_code(text,text,text,timestamptz) from authenticated;
grant execute on function public.crm_verify_onboarding_code(text,text,text,timestamptz) to service_role;
