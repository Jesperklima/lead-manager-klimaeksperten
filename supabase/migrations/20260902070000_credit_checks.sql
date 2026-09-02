-- Tenant-safe public-signal credit screening for leads and manual CVR lookups.

create table if not exists public.crm_credit_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  cvr text not null check (cvr ~ '^[0-9]{8}$'),
  check_kind text not null check (check_kind in ('lead','manual')),
  order_value numeric(14,2) check (order_value is null or order_value >= 0),
  company_name text,
  risk_score smallint not null check (risk_score between 0 and 100),
  risk_level text not null check (risk_level in ('low','elevated','high','unknown')),
  risk_label text not null,
  recommendation text not null,
  signals jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array'),
  company_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(company_snapshot) = 'object'),
  source_name text not null default 'APICVR.dk / CVR',
  source_url text,
  source_checked_at timestamptz not null default now(),
  checked_by_user_id uuid not null,
  checked_at timestamptz not null default now()
);

create index if not exists crm_credit_checks_client_cvr_checked_idx
  on public.crm_credit_checks (client_id, cvr, checked_at desc);
create index if not exists crm_credit_checks_client_kind_checked_idx
  on public.crm_credit_checks (client_id, check_kind, checked_at desc);
create index if not exists crm_credit_checks_lead_checked_idx
  on public.crm_credit_checks (lead_id, checked_at desc)
  where lead_id is not null;
create index if not exists crm_credit_checks_company_idx
  on public.crm_credit_checks (company_id)
  where company_id is not null;

alter table public.crm_credit_checks enable row level security;

drop policy if exists crm_credit_checks_tenant_select on public.crm_credit_checks;
create policy crm_credit_checks_tenant_select
on public.crm_credit_checks for select to authenticated
using (public.crm_has_client_access(client_id));

revoke all on table public.crm_credit_checks from public, anon, authenticated;
grant select on table public.crm_credit_checks to authenticated;
grant all on table public.crm_credit_checks to service_role;

comment on table public.crm_credit_checks is
  'Transparent public-signal CVR screening. Not an RKI report or a full credit rating.';
comment on column public.crm_credit_checks.risk_score is
  'Public-signal health score where higher is better; limited to CVR status, age, employees and bankruptcy flag.';
