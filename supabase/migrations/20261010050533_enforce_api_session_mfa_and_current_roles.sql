create or replace function public.crm_api_session_guard(p_client_id uuid default null,p_require_manage boolean default false,p_require_platform_admin boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare uid uuid:=auth.uid(); sid uuid; adm boolean:=false; privileged boolean:=false; member_role text;
begin
  if uid is null then return jsonb_build_object('allowed',false,'code','INVALID_LOGIN','status',401); end if;
  begin sid:=nullif(auth.jwt()->>'session_id','')::uuid; exception when invalid_text_representation then sid:=null; end;
  if sid is null or not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid and (s.not_after is null or s.not_after>now())) then
    return jsonb_build_object('allowed',false,'code','SESSION_REVOKED','status',401);
  end if;
  select exists(select 1 from public.crm_platform_admins a where a.auth_user_id=uid and a.active) into adm;
  if p_require_platform_admin and not adm then return jsonb_build_object('allowed',false,'code','ADMIN_ONLY','status',403); end if;
  if p_client_id is not null then
    select lower(u.role) into member_role from public.crm_users u where u.client_id=p_client_id and u.auth_user_id=uid and u.active limit 1;
    if not adm and member_role is null then return jsonb_build_object('allowed',false,'code','WORKSPACE_FORBIDDEN','status',403); end if;
    if not exists(select 1 from public.crm_clients where id=p_client_id) then return jsonb_build_object('allowed',false,'code','WORKSPACE_NOT_FOUND','status',404); end if;
    if p_require_manage and not adm and coalesce(member_role,'') not in ('owner','admin') then return jsonb_build_object('allowed',false,'code','ROLE_FORBIDDEN','status',403); end if;
  elsif not adm and not exists(select 1 from public.crm_users u where u.auth_user_id=uid and u.active) then
    return jsonb_build_object('allowed',false,'code','NO_MEMBERSHIP','status',403);
  end if;
  privileged:=adm or exists(select 1 from public.crm_users u where u.auth_user_id=uid and u.active and lower(u.role) in ('owner','admin'));
  if privileged and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then return jsonb_build_object('allowed',false,'code','MFA_REQUIRED','status',403); end if;
  return jsonb_build_object('allowed',true,'platform_admin',adm,'role',coalesce(member_role,case when adm then 'platform_admin' end));
end; $$;
revoke all on function public.crm_api_session_guard(uuid,boolean,boolean) from public,anon;
grant execute on function public.crm_api_session_guard(uuid,boolean,boolean) to authenticated;
