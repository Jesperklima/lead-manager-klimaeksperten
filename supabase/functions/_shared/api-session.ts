import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

export async function apiSessionGuard(token:string,clientId:string|null=null,manage=false,platformAdmin=false){
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY');
  if(!url||!key)return {allowed:false,status:503,code:'ACCESS_CHECK_UNAVAILABLE',error:'Adgangskontrol er midlertidigt utilgængelig.'};
  const client=createClient(url,key,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc('crm_api_session_guard',{p_client_id:clientId||null,p_require_manage:manage,p_require_platform_admin:platformAdmin});
  if(error||!data)return {allowed:false,status:503,code:'ACCESS_CHECK_UNAVAILABLE',error:'Adgangskontrol er midlertidigt utilgængelig.'};
  const messages:Record<string,string>={MFA_REQUIRED:'Bekræft din login-session med MFA før denne handling.',ADMIN_ONLY:'Kun aktiv platform-admin har adgang.',ROLE_FORBIDDEN:'Kun ejer/admin kan ændre denne integration.',SESSION_REVOKED:'Login-sessionen er udløbet eller tilbagekaldt.',WORKSPACE_FORBIDDEN:'Ingen adgang til denne kundekonto.'};
  return {...data,error:messages[data.code]||'Adgang nægtet.'};
}
