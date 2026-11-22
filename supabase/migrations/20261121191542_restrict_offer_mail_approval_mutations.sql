-- Restrict browser writes to mail-offer approvals. These are generated and applied server-side.
-- Existing approvals remain readable under their current RLS policies.
create or replace function public.crm_deny_browser_offer_mail_approval_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon','authenticated')
     and (
       (tg_op = 'INSERT' and new.action_type = 'offer_mail_update')
       or (tg_op = 'UPDATE' and (old.action_type = 'offer_mail_update' or new.action_type = 'offer_mail_update'))
     )
  then
    raise exception 'offer_mail_update approvals are managed by the server'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_protect_offer_mail_approval_mutation on public.crm_approvals;
create trigger crm_protect_offer_mail_approval_mutation
before insert or update on public.crm_approvals
for each row execute function public.crm_deny_browser_offer_mail_approval_mutation();

revoke execute on function public.crm_deny_browser_offer_mail_approval_mutation()
from public, anon, authenticated;
