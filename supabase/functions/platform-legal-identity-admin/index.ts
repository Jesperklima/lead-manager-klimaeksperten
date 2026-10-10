import { apiSessionGuard } from '../_shared/api-session.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const str=(v:any,n=600)=>String(v??'').trim().slice(0,n);
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login-token',code:'NO_TOKEN'},401);
    const body=await req.json().catch(()=>({}));
    const action=str(body.action||'status',40);
    const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:ud,error:ue}=await admin.auth.getUser(token);
    const user=ud?.user;
    if(ue||!user?.id||!user.email)return json({error:'Ugyldigt eller udløbet login',code:'INVALID_LOGIN'},401);
    const access=await apiSessionGuard(token,null,false,true);if(!access.allowed)return json({error:access.error,code:access.code},access.status);

    const {data:pa,error:pae}=await admin.from('crm_platform_admins')
      .select('auth_user_id,active')
      .eq('auth_user_id',user.id).eq('active',true).maybeSingle();
    if(pae)throw pae;
    if(!pa)return json({error:'Kun platformadmin kan ændre den juridiske udbyderidentitet',code:'ADMIN_REQUIRED'},403);

    if(action==='status'){
      const {data,error}=await admin.from('crm_platform_legal_identity').select('*').eq('id',1).single();
      if(error)throw error;
      const check=await admin.rpc('crm_refresh_platform_legal_identity_check');
      if(check.error)throw check.error;
      return json({ok:true,identity:data,check:check.data});
    }
    if(action!=='save')return json({error:'Ukendt handling'},400);

    const legalName=str(body.legal_name,300),cvr=str(body.cvr,40).replace(/\s+/g,''),
      street=str(body.street_address,300),postal=str(body.postal_code,20),
      city=str(body.city,120),country=str(body.country||'Danmark',120),
      privacyEmail=str(body.privacy_email,320).toLowerCase(),
      trading=str(body.trading_name||'Skarp Studio',200),
      website=str(body.website||'https://skarpstudio.dk',500);

    if(legalName.length<2)return json({error:'Juridisk virksomhedsnavn mangler'},400);
    if(!/^\d{8}$/.test(cvr))return json({error:'CVR skal være 8 cifre'},400);
    if(street.length<3||postal.length<4||city.length<2)return json({error:'Fuld fysisk adresse mangler'},400);
    if(!emailOk(privacyEmail))return json({error:'Privacy-mailen er ugyldig'},400);

    const now=new Date().toISOString();
    const {data:identity,error}=await admin.from('crm_platform_legal_identity').upsert({
      id:1,brand_name:'Lead Manager',trading_name:trading,legal_name:legalName,cvr,
      street_address:street,postal_code:postal,city,country,privacy_email:privacyEmail,
      website,evidence_source:'platform_admin_confirmed',verified_by:user.email,verified_at:now,updated_at:now
    },{onConflict:'id'}).select('*').single();
    if(error)throw error;

    const check=await admin.rpc('crm_refresh_platform_legal_identity_check');
    if(check.error)throw check.error;

    return json({ok:true,identity,check:check.data});
  }catch(err){
    console.error(err);
    return json({error:err instanceof Error?err.message:String(err),code:'INTERNAL_ERROR'},500);
  }
});
