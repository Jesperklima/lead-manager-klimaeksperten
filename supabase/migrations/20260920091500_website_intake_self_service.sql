-- Customer self-service website intake for Lead Manager.
create or replace function public.crm_can_manage_workspace(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,auth
as $$
  select public.crm_has_client_access(p_client_id)
    and (
      public.crm_is_platform_admin()
      or exists(
        select 1 from public.crm_users u
        where u.client_id=p_client_id
          and u.auth_user_id=auth.uid()
          and u.active
          and lower(coalesce(u.role,'')) in ('owner','admin')
      )
    );
$$;
revoke all on function public.crm_can_manage_workspace(uuid) from public,anon;
grant execute on function public.crm_can_manage_workspace(uuid) to authenticated,service_role;

create or replace function public.crm_website_intake_setup(
  p_client_id uuid,
  p_label text default 'Hjemmeside / formular'
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_partner_id uuid;
  v_conn public.crm_marketing_connections%rowtype;
  v_created jsonb;
begin
  if not public.crm_can_manage_workspace(p_client_id) then raise exception 'Access denied'; end if;

  select id into v_partner_id
  from public.crm_marketing_partners
  where client_id=p_client_id
    and metadata->>'system_type'='website_intake'
  order by created_at asc
  limit 1;

  if v_partner_id is null then
    insert into public.crm_marketing_partners(client_id,name,partner_type,active,metadata)
    values(p_client_id,'Hjemmeside','agency',true,jsonb_build_object('system_type','website_intake','managed_by','lead_manager'))
    returning id into v_partner_id;
  end if;

  select * into v_conn
  from public.crm_marketing_connections
  where client_id=p_client_id
    and partner_id=v_partner_id
    and platform='website'
    and status<>'disabled'
  order by created_at asc
  limit 1;

  if v_conn.id is not null then
    return jsonb_build_object(
      'id',v_conn.id,
      'status',v_conn.status,
      'platform',v_conn.platform,
      'created',false,
      'webhook_key',null
    );
  end if;

  v_created:=public.crm_marketing_create_connection(
    v_partner_id,
    'website',
    coalesce(nullif(btrim(p_label),''),'Hjemmeside / formular'),
    null
  );
  return v_created || jsonb_build_object('created',true);
end;
$$;
revoke all on function public.crm_website_intake_setup(uuid,text) from public,anon;
grant execute on function public.crm_website_intake_setup(uuid,text) to authenticated,service_role;

create or replace function public.crm_website_intake_rotate(
  p_client_id uuid,
  p_connection_id uuid
)
returns text
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if not public.crm_can_manage_workspace(p_client_id) then raise exception 'Access denied'; end if;
  if not exists(
    select 1 from public.crm_marketing_connections
    where id=p_connection_id and client_id=p_client_id and platform='website'
  ) then raise exception 'Website connection not found'; end if;
  return public.crm_marketing_rotate_webhook_key(p_connection_id);
end;
$$;
revoke all on function public.crm_website_intake_rotate(uuid,uuid) from public,anon;
grant execute on function public.crm_website_intake_rotate(uuid,uuid) to authenticated,service_role;

create or replace function public.crm_website_intake_qualify_business(
  p_prospect_id uuid,
  p_company_name text,
  p_cvr text default null
)
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_client uuid;
  v_connection uuid;
begin
  select p.client_id,nullif(p.metadata->>'source_connection_id','')::uuid
    into v_client,v_connection
  from public.crm_marketing_prospects p
  where p.id=p_prospect_id and p.lead_id is null;
  if v_client is null or not public.crm_has_client_access(v_client) then raise exception 'Access denied'; end if;
  if nullif(btrim(p_company_name),'') is null then raise exception 'Company name required'; end if;
  if not exists(
    select 1 from public.crm_marketing_connections c
    where c.id=v_connection and c.client_id=v_client and c.platform='website'
  ) then raise exception 'Website prospect required'; end if;

  update public.crm_marketing_prospects
     set prospect_type='business',
         company_name=btrim(p_company_name),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cvr',nullif(btrim(coalesce(p_cvr,'')),''),'qualified_as_business_at',now()),
         updated_at=now()
   where id=p_prospect_id;
end;
$$;
revoke all on function public.crm_website_intake_qualify_business(uuid,text,text) from public,anon;
grant execute on function public.crm_website_intake_qualify_business(uuid,text,text) to authenticated,service_role;

create or replace function public.crm_website_intake_promote(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_client uuid;
  v_type text;
  v_connection uuid;
begin
  select p.client_id,p.prospect_type,nullif(p.metadata->>'source_connection_id','')::uuid
    into v_client,v_type,v_connection
  from public.crm_marketing_prospects p
  where p.id=p_prospect_id and p.lead_id is null and p.stage<>'rejected';
  if v_client is null or not public.crm_has_client_access(v_client) then raise exception 'Access denied'; end if;
  if not exists(
    select 1 from public.crm_marketing_connections c
    where c.id=v_connection and c.client_id=v_client and c.platform='website'
  ) then raise exception 'Website prospect required'; end if;
  if v_type<>'business' then raise exception 'Website leads must be confirmed as B2B before CRM creation'; end if;
  return public.crm_marketing_promote_prospect(p_prospect_id);
end;
$$;
revoke all on function public.crm_website_intake_promote(uuid) from public,anon;
grant execute on function public.crm_website_intake_promote(uuid) to authenticated,service_role;

create or replace function public.crm_website_intake_reject(
  p_prospect_id uuid,
  p_reason text default 'Ikke relevant'
)
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_client uuid;
  v_connection uuid;
begin
  select p.client_id,nullif(p.metadata->>'source_connection_id','')::uuid
    into v_client,v_connection
  from public.crm_marketing_prospects p
  where p.id=p_prospect_id and p.lead_id is null;
  if v_client is null or not public.crm_has_client_access(v_client) then raise exception 'Access denied'; end if;
  if not exists(
    select 1 from public.crm_marketing_connections c
    where c.id=v_connection and c.client_id=v_client and c.platform='website'
  ) then raise exception 'Website prospect required'; end if;

  update public.crm_marketing_prospects
     set stage='rejected',
         rejection_reason=coalesce(nullif(btrim(p_reason),''),'Ikke relevant'),
         updated_at=now()
   where id=p_prospect_id;
end;
$$;
revoke all on function public.crm_website_intake_reject(uuid,text) from public,anon;
grant execute on function public.crm_website_intake_reject(uuid,text) to authenticated,service_role;
