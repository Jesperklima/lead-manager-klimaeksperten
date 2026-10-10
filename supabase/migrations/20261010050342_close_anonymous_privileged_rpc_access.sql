revoke execute on function public.crm_enqueue_missing_contact_channels(uuid) from public, anon, authenticated;
grant execute on function public.crm_enqueue_missing_contact_channels(uuid) to service_role;
revoke execute on function public.run_minuba_assistant_inspect_temp(uuid) from public, anon, authenticated;
grant execute on function public.run_minuba_assistant_inspect_temp(uuid) to service_role;
revoke execute on function public.marketing_file_probe_rpc(text) from public, anon, authenticated;
grant execute on function public.marketing_file_probe_rpc(text) to service_role;
revoke execute on function public.crm_lead_contact_channel_guard() from public, anon, authenticated;
revoke execute on function public.crm_update_lead_search_profile(uuid,jsonb) from public, anon;
grant execute on function public.crm_update_lead_search_profile(uuid,jsonb) to authenticated, service_role;