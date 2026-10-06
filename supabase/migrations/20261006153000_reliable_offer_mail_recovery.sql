-- Internal recovery path for already-authorized failed offer mail jobs.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'mail_recovery_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'mail_recovery_secret',
      'Internal Lead Manager mail recovery secret'
    );
  end if;
end
$$;

create or replace function public.verify_mail_recovery_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select coalesce(
    length(coalesce(p_secret,'')) >= 32
    and exists (
      select 1
      from vault.decrypted_secrets
      where name = 'mail_recovery_secret'
        and decrypted_secret = p_secret
    ),
    false
  );
$$;

revoke all on function public.verify_mail_recovery_secret(text) from public, anon, authenticated;
grant execute on function public.verify_mail_recovery_secret(text) to service_role;
