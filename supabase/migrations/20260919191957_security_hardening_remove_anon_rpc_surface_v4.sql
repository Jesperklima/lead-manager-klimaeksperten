-- Security hardening v4
-- No anonymous RPC surface is needed for these pure CRM helpers.

revoke execute on function public.crm_is_personally_owned_company(public.crm_companies) from public, anon;
grant execute on function public.crm_is_personally_owned_company(public.crm_companies) to authenticated, service_role;

revoke execute on function public.crm_normalize_documented_source_type(text) from public, anon;
grant execute on function public.crm_normalize_documented_source_type(text) to authenticated, service_role;
