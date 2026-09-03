-- Fix new Skarp managed client creation: crm_clients.services is jsonb.
do $fix$
declare
  v_def text;
begin
  select pg_get_functiondef('public.crm_skarp_provision_workspace(uuid,uuid,text,boolean,boolean,jsonb)'::regprocedure)
    into v_def;
  if position('''{}''::text[]' in v_def)=0 then
    raise exception 'Expected services text[] expression was not found in crm_skarp_provision_workspace';
  end if;
  v_def:=replace(v_def,'''{}''::text[]','''[]''::jsonb');
  execute v_def;
end
$fix$;
