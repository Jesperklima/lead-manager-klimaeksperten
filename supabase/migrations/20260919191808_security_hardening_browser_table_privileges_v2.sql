-- Security hardening v2
-- Browser/API roles never need whole-table or schema-changing table privileges.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
