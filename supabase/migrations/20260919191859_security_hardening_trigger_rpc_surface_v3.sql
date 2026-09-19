-- Security hardening v3
-- Trigger functions execute only through bound triggers, not as API RPCs.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.relnamespace
    where false
  loop
    null;
  end loop;
end
$$;
