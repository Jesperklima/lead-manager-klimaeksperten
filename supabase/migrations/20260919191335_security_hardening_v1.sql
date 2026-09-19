-- Security hardening v1
-- Service-only RLS tables are explicitly denied to browser-facing roles.
-- pg_net revokes are best-effort because Supabase owns an event trigger that may restore
-- managed extension grants; application security must not rely on these revokes alone.

do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind='r'
      and c.relrowsecurity=true
      and not exists (
        select 1 from pg_policy p where p.polrelid=c.oid
      )
  loop
    execute format(
      'revoke all privileges on table %I.%I from anon, authenticated',
      r.schema_name, r.table_name
    );

    execute format(
      'create policy service_only_deny_all on %I.%I for all to anon, authenticated using (false) with check (false)',
      r.schema_name, r.table_name
    );
  end loop;
end
$$;

revoke usage on schema net from public, anon, authenticated;
grant usage on schema net to postgres, service_role, supabase_functions_admin;

revoke execute on all functions in schema net from public, anon, authenticated;
grant execute on all functions in schema net to postgres, service_role, supabase_functions_admin;

revoke execute on function extensions.grant_pg_net_access() from public, anon, authenticated;
