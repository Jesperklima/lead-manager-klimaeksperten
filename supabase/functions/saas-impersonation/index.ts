import { apiSessionGuard } from '../_shared/api-session.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const clean=(v:unknown,n=320)=>String(v??'').trim().slice(0,n);
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return json({error:'Method not allowed'},405);
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token) return json({error:'Mangler login'},401);
  const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:ud,error:ue}=await admin.auth.getUser(token); const actor=ud?.user;
  if(ue||!actor?.id||!actor.email) return json({error:'Ugyldigt login'},401);
    const _apiAccess=await apiSessionGuard(token,null,false,true);
    if(!_apiAccess.allowed)return json({error:_apiAccess.error,code:_apiAccess.code},_apiAccess.status);

  const {data:access,error:ae}=await admin.from('crm_admin_client_access').select('client_id,source').eq('auth_user_id',actor.id); if(ae) throw ae;
  const ids=[...new Set((access||[]).map((x:any)=>x.client_id).filter(Boolean))];
  if(!ids.length) return json({error:'Kun platform-admin kan bruge supporttilstand'},403);
  const {data:limits,error:le}=await admin.from('crm_usage_limits').select('client_id,plan_code').in('client_id',ids); if(le) throw le;
  const home=(limits||[]).find((x:any)=>x.plan_code==='internal'); if(!home) return json({error:'Kun platform-admin kan bruge supporttilstand'},403);
  const body=await req.json().catch(()=>({})); const action=clean(body.action,30).toLowerCase();
  if(action==='stop'){
   const sid=clean(body.session_id,80); const target=clean(body.client_id,80); const email=clean(body.email,320).toLowerCase();
   await admin.from('crm_activities').insert({client_id:home.client_id,type:'Support session',actor_type:'user',actor_name:actor.email,summary:`Support-session afsluttet${email?' for '+email:''}`,metadata:{action:'impersonation_stop',session_id:sid||null,target_client_id:target||null,target_email:email||null}});
   return json({ok:true});
  }
  if(action!=='start') return json({error:'Ukendt handling'},400);
  const clientId=clean(body.client_id,80); const email=clean(body.email,320).toLowerCase(); const mode=clean(body.mode,20).toLowerCase(); const reason=clean(body.reason,500);
  if(!clientId||!email) return json({error:'Kunde og bruger mangler'},400); if(!['view','support'].includes(mode)) return json({error:'Ugyldig supporttilstand'},400);
  const {data:client,error:ce}=await admin.from('crm_clients').select('id,name').eq('id',clientId).maybeSingle(); if(ce) throw ce; if(!client) return json({error:'Kunden findes ikke'},404);
  const {data:lim}=await admin.from('crm_usage_limits').select('plan_code').eq('client_id',clientId).maybeSingle(); if(lim?.plan_code==='internal') return json({error:'Platformkontoen kan ikke impersoneres'},409);
  const {data:user,error:me}=await admin.from('crm_users').select('email,client_id,role,active,auth_user_id').eq('client_id',clientId).ilike('email',email).maybeSingle(); if(me) throw me; if(!user) return json({error:'Brugeren findes ikke hos kunden'},404); if(!user.active) return json({error:'Brugeren er inaktiv'},409);
  const sessionId=crypto.randomUUID(); const startedAt=new Date(); const expiresAt=new Date(startedAt.getTime()+60*60*1000);
  await admin.from('crm_activities').insert({client_id:home.client_id,type:'Support session',actor_type:'user',actor_name:actor.email,summary:`${mode==='view'?'Vis som':'Support som'} ${user.email} hos ${client.name}`,metadata:{action:'impersonation_start',session_id:sessionId,target_client_id:clientId,target_client_name:client.name,target_email:user.email,target_role:user.role,mode,reason:reason||null,started_at:startedAt.toISOString(),expires_at:expiresAt.toISOString()}});
  return json({ok:true,session:{id:sessionId,mode,reason:reason||null,actor_email:actor.email,client_id:clientId,client_name:client.name,email:user.email,role:user.role,started_at:startedAt.toISOString(),expires_at:expiresAt.toISOString()}});
 }catch(err){console.error(err); return json({error:err instanceof Error?err.message:String(err),code:'IMPERSONATION_FAILED'},500)}
});