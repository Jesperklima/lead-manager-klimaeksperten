-- Security hardening v3
-- Trigger functions execute only through bound triggers, not as API RPCs.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prokind='f'
      and p.prorettype='trigger'::regtype
      and (
        has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE')
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      r.signature
    );
  end loop;
end
$$;
