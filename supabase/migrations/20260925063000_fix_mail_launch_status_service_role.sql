-- Fix Gmail status checks from server-side Edge Functions.
-- crm_mail_launch_status previously rejected service_role calls because
-- crm_has_client_access() depends on auth.uid(). Edge Functions already
-- validate the signed-in user's workspace membership before calling this RPC.

create or replace function public.crm_mail_launch_status(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  g record;
  v_plan text;
  v_google_ready boolean := false;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.crm_has_client_access(p_client_id) then
    raise exception 'Access denied';
  end if;

  select plan_code
    into v_plan
  from public.crm_usage_limits
  where client_id = p_client_id;

  select oauth_verification_status,
         security_assessment_status,
         dpa_status
    into g
  from public.crm_subprocessors
  where active = true
    and lower(provider) = 'google'
  order by updated_at desc nulls last
  limit 1;

  v_google_ready :=
    coalesce(g.oauth_verification_status,'required') = 'verified'
    and coalesce(g.security_assessment_status,'required') in ('verified','not_applicable')
    and coalesce(g.dpa_status,'verify') in ('verified','documented');

  return jsonb_build_object(
    'google', jsonb_build_object(
      'available', v_google_ready or v_plan = 'internal',
      'public_launch_ready', v_google_ready,
      'oauth_status', coalesce(g.oauth_verification_status,'required'),
      'security_status', coalesce(g.security_assessment_status,'required'),
      'dpa_status', coalesce(g.dpa_status,'verify')
    ),
    'microsoft', jsonb_build_object('available', true),
    'imap_smtp', jsonb_build_object('available', true)
  );
end
$function$;
