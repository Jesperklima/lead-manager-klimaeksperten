create table if not exists public.crm_regression_guards (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null unique references public.crm_feedback(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  title text,
  area text,
  invariant text not null,
  failure_signature text,
  prevention_type text not null default 'regression_test',
  status text not null default 'queued' check (status in ('queued','implementing','verified')),
  implementation_reference text,
  test_reference text,
  verification_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists crm_regression_guards_client_status_idx on public.crm_regression_guards(client_id,status,created_at desc);
alter table public.crm_regression_guards enable row level security;

create or replace function public.crm_touch_regression_guard_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'verified' and old.status is distinct from 'verified' then
    new.verified_at := now();
  elsif new.status <> 'verified' then
    new.verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_regression_guard_touch on public.crm_regression_guards;
create trigger trg_crm_regression_guard_touch before update on public.crm_regression_guards
for each row execute function public.crm_touch_regression_guard_updated_at();

create or replace function public.crm_feedback_create_regression_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.feedback_type = 'bug' then
    insert into public.crm_regression_guards(feedback_id,client_id,title,area,invariant,failure_signature,prevention_type,status,metadata)
    values (
      new.id,new.client_id,coalesce(new.title,'Rapporteret fejl'),coalesce(new.context_view,new.page_path,'ukendt'),
      'Fejlen må ikke kunne gentage sig: ' || left(new.message,2000),left(new.message,2000),'regression_test','queued',
      jsonb_build_object('source','customer_feedback','user_email',new.user_email)
    ) on conflict (feedback_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_feedback_create_regression_guard on public.crm_feedback;
create trigger trg_crm_feedback_create_regression_guard after insert on public.crm_feedback
for each row execute function public.crm_feedback_create_regression_guard();

create or replace function public.crm_feedback_require_verified_regression()
returns trigger language plpgsql as $$
declare guard_status text;
begin
  if new.feedback_type = 'bug' and new.status = 'built' and old.status is distinct from 'built' then
    select status into guard_status from public.crm_regression_guards where feedback_id = new.id;
    if guard_status is distinct from 'verified' then
      raise exception 'Fejlen kan ikke markeres Bygget før dens regression/forebyggelse er verificeret.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_feedback_require_verified_regression on public.crm_feedback;
create trigger trg_crm_feedback_require_verified_regression before update of status on public.crm_feedback
for each row execute function public.crm_feedback_require_verified_regression();

insert into public.crm_regression_guards(feedback_id,client_id,title,area,invariant,failure_signature,prevention_type,status,metadata)
select f.id,f.client_id,coalesce(f.title,'Rapporteret fejl'),coalesce(f.context_view,f.page_path,'ukendt'),
       'Fejlen må ikke kunne gentage sig: ' || left(f.message,2000),left(f.message,2000),'regression_test','queued',
       jsonb_build_object('source','feedback_backfill','feedback_status',f.status)
from public.crm_feedback f
where f.feedback_type='bug'
on conflict (feedback_id) do nothing;
