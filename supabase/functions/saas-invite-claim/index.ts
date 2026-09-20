import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const str=(v:unknown,max=600)=>String(v??'').trim().slice(0,max);
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const sha256=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');

function logError(err:unknown){
  if(err instanceof Error)return {name:err.name,message:err.message,stack:err.stack};
  if(typeof err==='object'&&err!==null){const v=err as Record<string,unknown>;return {message:typeof v.message==='string'?v.message:'Unknown object error',code:v.code,details:v.details,hint:v.hint}}
  return {message:String(err)};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const body=await req.json().catch(()=>({}));
    const action=str(body.action||'claim',40);
    const inviteToken=str(body.token,1000);
    const suppliedEmail=str(body.email,320).toLowerCase();
    const password=String(body.password||'');
    if(inviteToken.length<30)return json({error:'Invitationslinket er ugyldigt',code:'INVALID_INVITE'},400);

    const url=Deno.env.get('SUPABASE_URL')!;
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const authClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const hash=await sha256(inviteToken);

    const {data:invite,error:inviteError}=await admin.from('crm_onboarding_invites').select('*').eq('token_hash',hash).maybeSingle();
    if(inviteError)throw inviteError;
    if(!invite)return json({error:'Invitationslinket findes ikke eller er ugyldigt',code:'INVALID_INVITE'},404);

    const inviteEmail=String(invite.email||'').toLowerCase();
    const expired=new Date(invite.expires_at).getTime()<Date.now();
    if(expired&&invite.status!=='claimed'){
      await admin.from('crm_onboarding_invites').update({status:'expired'}).eq('id',invite.id);
      return json({error:'Invitationslinket er udløbet. Bed om en ny invitation.',code:'INVITE_EXPIRED'},410);
    }
    if(invite.status==='revoked')return json({error:'Invitationen er trukket tilbage',code:'INVITE_REVOKED'},410);

    const [{data:client},{data:membership,error:membershipError}]=await Promise.all([
      admin.from('crm_clients').select('id,name').eq('id',invite.client_id).maybeSingle(),
      admin.from('crm_users').select('email,client_id,role,active,auth_user_id').eq('client_id',invite.client_id).ilike('email',inviteEmail).eq('active',true).maybeSingle()
    ]);
    if(membershipError)throw membershipError;

    if(action==='inspect'){
      return json({
        ok:true,
        status:invite.status,
        claimed:invite.status==='claimed'||!!invite.used_at,
        email:inviteEmail,
        company_name:client?.name||'',
        client_id:invite.client_id,
        plan_code:invite.plan_code,
        existing_login:!!membership?.auth_user_id,
        expires_at:invite.expires_at
      });
    }

    if(action!=='claim')return json({error:'Ukendt handling',code:'UNKNOWN_ACTION'},400);
    if(invite.status==='claimed'||invite.used_at)return json({
      error:'Invitationen er allerede brugt. Log ind med din eksisterende Lead Manager-konto.',
      code:'INVITE_USED',
      email:inviteEmail,
      login_existing:true
    },409);
    if(!membership)return json({error:'Kundeadgangen blev ikke fundet',code:'MEMBERSHIP_MISSING'},404);
    if(suppliedEmail&&suppliedEmail!==inviteEmail)return json({error:'E-mailadressen matcher ikke invitationen',code:'EMAIL_MISMATCH'},403);
    if(!emailOk(inviteEmail))return json({error:'Invitationens e-mail er ugyldig',code:'INVALID_EMAIL'},400);
    if(password.length<10)return json({error:'Password skal være mindst 10 tegn',code:'PASSWORD_TOO_SHORT'},400);

    let userId:string|null=null;
    let createdNew=false;
    let boundNow=false;

    if(membership.auth_user_id){
      const {data:login,error:loginError}=await authClient.auth.signInWithPassword({email:inviteEmail,password});
      if(loginError||!login?.user){
        return json({
          error:'Der findes allerede et login med denne e-mail. Brug dit eksisterende password.',
          code:'EXISTING_LOGIN_PASSWORD_REQUIRED',
          existing_login:true,
          email:inviteEmail
        },409);
      }
      if(login.user.id!==membership.auth_user_id)return json({error:'Login og kundeadgang matcher ikke. Kontakt administrator.',code:'MEMBERSHIP_USER_MISMATCH'},409);
      userId=login.user.id;
    }else{
      const {data:created,error:createError}=await admin.auth.admin.createUser({
        email:inviteEmail,
        password,
        email_confirm:true,
        user_metadata:{lead_manager_client_id:invite.client_id,onboarding_invite_id:invite.id}
      });
      if(!createError&&created?.user){
        userId=created.user.id;
        createdNew=true;
      }else{
        const message=String(createError?.message||'');
        if(!/already|registered|exists/i.test(message))throw createError||new Error('Login kunne ikke oprettes');
        const {data:login,error:loginError}=await authClient.auth.signInWithPassword({email:inviteEmail,password});
        if(loginError||!login?.user){
          return json({
            error:'Der findes allerede et login med denne e-mail. Brug dit eksisterende password.',
            code:'EXISTING_LOGIN_PASSWORD_REQUIRED',
            existing_login:true,
            email:inviteEmail
          },409);
        }
        userId=login.user.id;
      }

      const {data:bound,error:bindError}=await admin.from('crm_users')
        .update({auth_user_id:userId})
        .eq('client_id',invite.client_id)
        .ilike('email',inviteEmail)
        .eq('active',true)
        .is('auth_user_id',null)
        .select('email,client_id,auth_user_id')
        .maybeSingle();

      if(bindError||!bound||bound.auth_user_id!==userId){
        if(createdNew&&userId)await admin.auth.admin.deleteUser(userId);
        console.error('invite membership bind failed',logError(bindError||new Error('Membership was not bound')));
        return json({error:'Kundeloginet kunne ikke knyttes til invitationen. Prøv igen.',code:'MEMBERSHIP_BIND_FAILED'},500);
      }
      boundNow=true;
    }

    const now=new Date().toISOString();
    const {error:inviteUpdateError}=await admin.from('crm_onboarding_invites').update({
      status:'claimed',
      used_at:now,
      metadata:{...(invite.metadata||{}),claimed_user_id:userId,reused_existing_login:!createdNew,claimed_at:now}
    }).eq('id',invite.id);

    if(inviteUpdateError){
      if(boundNow&&userId)await admin.from('crm_users').update({auth_user_id:null}).eq('client_id',invite.client_id).ilike('email',inviteEmail).eq('auth_user_id',userId);
      if(createdNew&&userId)await admin.auth.admin.deleteUser(userId);
      throw inviteUpdateError;
    }

    return json({
      ok:true,
      email:inviteEmail,
      client_id:invite.client_id,
      company_name:client?.name||'',
      plan_code:invite.plan_code,
      claimed:true,
      reused_existing_login:!createdNew
    });
  }catch(err){
    console.error('saas-invite-claim failed',logError(err));
    return json({error:'Login kunne ikke oprettes på grund af en teknisk fejl. Prøv igen.',code:'CLAIM_FAILED'},500);
  }
});