-- Lead Manager SaaS self-service onboarding v2
-- Applied to Supabase before this source snapshot.

-- A customer membership exists before the invited user has created a Supabase login.
-- NULL never grants CRM access; saas-invite-claim binds auth_user_id before login begins.
alter table public.crm_users alter column auth_user_id drop not null;
comment on column public.crm_users.auth_user_id is
  'Supabase auth UID. NULL is allowed only while a SaaS onboarding invitation is pending; it is bound by saas-invite-claim before CRM access begins.';

create table if not exists public.crm_onboarding_invites(
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  plan_code text not null check(plan_code in ('start','pro','business')),
  status text not null default 'created' check(status in ('created','sent','claimed','expired','revoked','send_failed')),
  expires_at timestamptz not null,
  used_at timestamptz,
  sent_at timestamptz,
  created_by_user_id uuid,
  created_by_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_onboarding_invites_client_idx
  on public.crm_onboarding_invites(client_id,created_at desc);
create index if not exists crm_onboarding_invites_email_idx
  on public.crm_onboarding_invites(lower(email),created_at desc);

alter table public.crm_onboarding_invites enable row level security;
revoke all on table public.crm_onboarding_invites from public,anon,authenticated;
grant all on table public.crm_onboarding_invites to service_role;

-- New tenants reuse the platform Google OAuth application credentials only.
-- They never inherit another tenant's mailbox authorization/refresh token.
create or replace function public.clone_gmail_oauth_client_for_service(
  p_source_client_id uuid,
  p_target_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  v_client_id text;
  v_client_secret text;
  v_result jsonb;
begin
  select decrypted_secret into v_client_id
    from vault.decrypted_secrets
    where name='gmail_oauth_client_id_'||p_source_client_id::text
    limit 1;

  select decrypted_secret into v_client_secret
    from vault.decrypted_secrets
    where name='gmail_oauth_client_secret_'||p_source_client_id::text
    limit 1;

  if nullif(trim(coalesce(v_client_id,'')),'') is null
     or nullif(trim(coalesce(v_client_secret,'')),'') is null then
    raise exception 'Platformens Google OAuth-oplysninger mangler';
  end if;

  select public.set_gmail_oauth_client(
    p_target_client_id,
    v_client_id,
    v_client_secret
  ) into v_result;

  return coalesce(v_result,'{}'::jsonb)
    || jsonb_build_object('cloned_from_platform',true);
end;
$$;

revoke all on function public.clone_gmail_oauth_client_for_service(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.clone_gmail_oauth_client_for_service(uuid,uuid)
  to service_role;
