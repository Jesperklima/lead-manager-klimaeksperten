create or replace function public.crm_admin_list_managed_clients()
returns table(
  client_id uuid,
  client_name text,
  source text,
  workspace_id uuid,
  marketing_active boolean,
  is_home boolean
)
language plpgsql stable security definer
set search_path=public,auth as $$
begin
  if not public.crm_internal_admin() then
    raise exception 'Kun intern ejer/admin kan skifte kundeprofil';
  end if;

  return query
  select q.client_id,q.client_name,q.source,q.workspace_id,q.marketing_active,q.is_home
  from (
    select c.id as client_id,c.name as client_name,'internal'::text as source,
           null::uuid as workspace_id,true as marketing_active,true as is_home
    from public.crm_clients c
    join public.crm_users u on u.client_id=c.id
    join public.crm_usage_limits l on l.client_id=c.id
    where u.auth_user_id=auth.uid() and u.active
      and lower(coalesce(u.role,'')) in ('owner','admin') and l.plan_code='internal'

    union all

    select c.id as client_id,c.name as client_name,a.source,
           w.workspace_id,coalesce(w.marketing_active,true) as marketing_active,false as is_home
    from public.crm_admin_client_access a
    join public.crm_clients c on c.id=a.client_id
    left join public.crm_skarp_workspaces w on w.client_id=c.id
    where a.auth_user_id=auth.uid()
  ) q
  order by q.is_home desc,q.client_name;
end;
$$;
revoke all on function public.crm_admin_list_managed_clients() from public,anon;
grant execute on function public.crm_admin_list_managed_clients() to authenticated;
