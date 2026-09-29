import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const str=(v:unknown,n=500)=>String(v??'').trim().slice(0,n);
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const PROD='https://lead-manager-klimaeksperten.vercel.app';
const INVITE_VALIDITY_DAYS=14;
const CODE_VALIDITY_HOURS=24;
const CODE_MAX_ATTEMPTS=5;
const OTP_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function safeInviteOrigin(v:string){
  try{
    const u=new URL(v);
    if(u.protocol!=='https:')return PROD;
    if(u.origin===PROD)return PROD;
    if(/^lead-manager-klimaeksperten-[a-z0-9-]+\.vercel\.app$/i.test(u.hostname))return u.origin;
    return PROD;
  }catch{return PROD}
}

const b64url=(bytes:Uint8Array)=>{
  let bin='';
  for(const x of bytes)bin+=String.fromCharCode(x);
  return btoa(bin).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
};
const sha256=async(v:string)=>Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))
).map(x=>x.toString(16).padStart(2,'0')).join('');
const encodedWord=(value:string)=>{
  const bytes=new TextEncoder().encode(value);
  let bin='';
  for(const b of bytes)bin+=String.fromCharCode(b);
  return '=?UTF-8?B?'+btoa(bin)+'?=';
};
const normalizeCode=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]/g,'');

function oneTimeCode(){
  const bytes=crypto.getRandomValues(new Uint8Array(8));
  let raw='';
  for(const b of bytes)raw+=OTP_ALPHABET[b%OTP_ALPHABET.length];
  return raw.slice(0,4)+'-'+raw.slice(4);
}

async function getInternalAdmin(admin:any,user:any){
  const {data:members,error}=await admin.from('crm_users')
    .select('client_id,role,email')
    .eq('auth_user_id',user.id)
    .eq('active',true);
  if(error)throw error;
  for(const m of members||[]){
    const {data:l,error:le}=await admin.from('crm_usage_limits')
      .select('plan_code')
      .eq('client_id',m.client_id)
      .maybeSingle();
    if(le)throw le;
    if(l?.plan_code==='internal'&&['owner','admin'].includes(String(m.role||'').toLowerCase()))return m;
  }
  return null;
}

async function findAuthUserByEmail(admin:any,email:string){
  const needle=email.toLowerCase();
  const perPage=1000;
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage});
    if(error)throw error;
    const users=Array.isArray(data?.users)?data.users:[];
    const found=users.find((u:any)=>String(u?.email||'').trim().toLowerCase()===needle);
    if(found)return found;
    if(users.length<perPage)return null;
  }
  throw new Error('AUTH_USER_LOOKUP_LIMIT');
}

async function provisionAuthUser(admin:any,clientId:string,email:string){
  const {data:member,error:me}=await admin.from('crm_users')
    .select('client_id,email,auth_user_id,active')
    .eq('client_id',clientId)
    .ilike('email',email)
    .eq('active',true)
    .maybeSingle();
  if(me)throw me;
  if(!member)throw new Error('Kundens ejer-login mangler');

  if(member.auth_user_id){
    const {data,error}=await admin.auth.admin.getUserById(member.auth_user_id);
    if(error)throw error;
    const authUser=data?.user;
    if(!authUser||String(authUser.email||'').toLowerCase()!==email.toLowerCase()){
      throw new Error('Kundens Auth-login matcher ikke invitationen');
    }
    return {userId:authUser.id,created:false};
  }

  const existing=await findAuthUserByEmail(admin,email);
  if(existing){
    const {data:links,error:le}=await admin.from('crm_users')
      .select('client_id,email,active')
      .eq('auth_user_id',existing.id)
      .eq('active',true);
    if(le)throw le;
    if((links||[]).length)throw Object.assign(new Error('Denne e-mail har allerede et aktivt Lead Manager-login.'),{code:'EMAIL_EXISTS'});

    const {error:de}=await admin.auth.admin.deleteUser(existing.id,false);
    if(de)throw new Error('Et gammelt ufuldstændigt login kunne ikke nulstilles: '+de.message);
  }

  const bootstrapPassword='LM!9-'+b64url(crypto.getRandomValues(new Uint8Array(48)))+'aA1!';
  const {data:created,error:ce}=await admin.auth.admin.createUser({
    email,
    password:bootstrapPassword,
    email_confirm:true,
    app_metadata:{lead_manager_first_login_pending:true}
  });
  if(ce||!created?.user)throw ce||new Error('Auth-login kunne ikke klargøres');

  const {error:ue}=await admin.from('crm_users')
    .update({auth_user_id:created.user.id})
    .eq('client_id',clientId)
    .ilike('email',email)
    .eq('active',true);
  if(ue){
    await admin.auth.admin.deleteUser(created.user.id,false).catch(()=>{});
    throw ue;
  }

  return {userId:created.user.id,created:true};
}

async function gmailAccess(admin:any,internalClientId:string,fallbackFrom:string){
  const {data:mat,error}=await admin.rpc('get_gmail_oauth_material',{p_client_id:internalClientId});
  if(error)throw error;
  const clientId=String(mat?.client_id||'');
  const clientSecret=String(mat?.client_secret||'');
  const refreshToken=String(mat?.refresh_token||'');
  const from=String(mat?.account||fallbackFrom||'');
  if(!clientId||!clientSecret||!refreshToken)throw new Error('Den interne Gmail-forbindelse mangler OAuth-materiale');

  const tr=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:clientId,
      client_secret:clientSecret,
      refresh_token:refreshToken,
      grant_type:'refresh_token'
    })
  });
  const td=await tr.json().catch(()=>({}));
  if(!tr.ok||!td.access_token)throw new Error(String(td?.error_description||td?.error||'Google kunne ikke forny adgang'));
  return {accessToken:String(td.access_token),from};
}

async function sendInviteMail(opts:{
  admin:any;
  internalClientId:string;
  fallbackFrom:string;
  email:string;
  companyName:string;
  recipientName?:string;
  inviteLink:string;
  oneTimeCode:string;
  inviteExpires:Date;
  codeExpires:Date;
}){
  const {admin,internalClientId,fallbackFrom,email,companyName,recipientName='',inviteLink,oneTimeCode,inviteExpires,codeExpires}=opts;
  const {accessToken,from}=await gmailAccess(admin,internalClientId,fallbackFrom);
  const hello=recipientName?`Hej ${recipientName}`:'Hej';
  const plain=`${hello}

Du er inviteret til Lead Manager for ${companyName}.

Din engangskode er:

${oneTimeCode}

Sådan kommer du i gang:
1. Åbn invitationslinket nedenfor.
2. Indtast engangskoden fra denne mail.
3. Vælg din egen adgangskode.
4. Opsæt 2-faktor-login i en Authenticator-app.
5. Gennemfør de 4 onboarding-trin: virksomhed, leadprofil, integrationer og gennemgang.

${inviteLink}

Engangskoden kan kun bruges i onboarding-flowet. Den kan ikke bruges som almindeligt Lead Manager-login.
Koden er gyldig til ${codeExpires.toLocaleString('da-DK')} og låses efter ${CODE_MAX_ATTEMPTS} forkerte forsøg.
Invitationslinket er gyldigt i ${INVITE_VALIDITY_DAYS} dage til ${inviteExpires.toLocaleDateString('da-DK')}.

Med venlig hilsen
Lead Manager`;

  const mime=[
    `From: ${from}`,
    `To: ${email}`,
    `Subject: ${encodedWord('Velkommen til Lead Manager – din engangskode')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    plain
  ].join('\r\n');

  const raw=b64url(new TextEncoder().encode(mime));
  const sr=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'POST',
    headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
    body:JSON.stringify({raw})
  });
  const sd=await sr.json().catch(()=>({}));
  if(!sr.ok)throw new Error(String(sd?.error?.message||'Invitationen kunne ikke sendes via Gmail'));
  return {gmailMessageId:sd.id||null};
}

async function listOnboardingStatus(admin:any){
  const {data:clients,error:ce}=await admin.from('crm_clients')
    .select('id,name,settings,created_at')
    .order('created_at',{ascending:false});
  if(ce)throw ce;

  const saasClients=(clients||[]).filter((c:any)=>{
    const saas=c?.settings?.saas;
    return saas && ['self_service_paid','managed'].includes(String(saas.account_mode||'self_service_paid'));
  });
  const ids=saasClients.map((c:any)=>c.id);
  if(!ids.length)return [];

  const [{data:limits,error:le},{data:users,error:ue},{data:invites,error:ie}]=await Promise.all([
    admin.from('crm_usage_limits').select('client_id,plan_code').in('client_id',ids),
    admin.from('crm_users').select('client_id,email,role,active,auth_user_id').in('client_id',ids).eq('active',true),
    admin.from('crm_onboarding_invites')
      .select('id,client_id,email,plan_code,status,expires_at,sent_at,used_at,created_at,metadata')
      .in('client_id',ids)
      .order('created_at',{ascending:false})
  ]);
  if(le)throw le;
  if(ue)throw ue;
  if(ie)throw ie;

  const planBy=new Map((limits||[]).map((x:any)=>[x.client_id,x.plan_code]));
  const ownerBy=new Map<string,any>();
  for(const u of users||[]){
    const current=ownerBy.get(u.client_id);
    if(!current||String(u.role).toLowerCase()==='owner')ownerBy.set(u.client_id,u);
  }
  const inviteBy=new Map<string,any>();
  for(const i of invites||[])if(!inviteBy.has(i.client_id))inviteBy.set(i.client_id,i);

  const authBy=new Map<string,any>();
  const authIds=[...new Set((users||[]).map((u:any)=>u.auth_user_id).filter(Boolean))];
  await Promise.all(authIds.map(async(id:string)=>{
    try{
      const {data,error}=await admin.auth.admin.getUserById(id);
      if(!error&&data?.user)authBy.set(id,data.user);
    }catch{/* keep status page resilient */}
  }));

  const now=Date.now();
  return saasClients.map((c:any)=>{
    const saas=c.settings?.saas||{};
    const owner=ownerBy.get(c.id)||null;
    const invite=inviteBy.get(c.id)||null;
    const meta=invite?.metadata||{};
    const authUser=owner?.auth_user_id?authBy.get(owner.auth_user_id):null;
    const step=Math.max(0,Math.min(4,Number(saas.onboarding_step||0)));
    const completed=saas.onboarding_completed===true;
    const activated=invite?.status==='claimed'||Boolean(invite?.used_at)||Boolean(meta.password_set_at);
    const factors=Array.isArray(authUser?.factors)?authUser.factors:[];
    const hasVerifiedFactor=factors.some((f:any)=>String(f?.status||'').toLowerCase()==='verified');
    const mfaStatus=!activated?'not_started':(hasVerifiedFactor||step>0||completed?'verified':'pending');

    let inviteStatus=String(invite?.status||'none');
    if(invite&&inviteStatus!=='claimed'&&inviteStatus!=='revoked'&&new Date(invite.expires_at).getTime()<now)inviteStatus='expired';

    let codeStatus='none';
    const codeExpiresAt=meta.otp_expires_at||null;
    const attempts=Number(meta.otp_attempts||0);
    if(activated)codeStatus='consumed';
    else if(meta.otp_locked_at||attempts>=Number(meta.otp_max_attempts||CODE_MAX_ATTEMPTS))codeStatus='locked';
    else if(codeExpiresAt&&new Date(codeExpiresAt).getTime()<now)codeStatus='expired';
    else if(meta.otp_verified_at)codeStatus='verified';
    else if(meta.otp_hash)codeStatus='ready';

    const lifecycle=completed?'ACTIVE':(step>0?'ONBOARDING':'INVITED');

    return {
      client_id:c.id,
      company_name:c.name,
      email:owner?.email||saas.invited_email||invite?.email||null,
      plan_code:planBy.get(c.id)||invite?.plan_code||null,
      created_at:c.created_at,
      invite:{
        id:invite?.id||null,
        status:inviteStatus,
        sent_at:invite?.sent_at||null,
        used_at:invite?.used_at||null,
        expires_at:invite?.expires_at||null,
        created_at:invite?.created_at||null
      },
      code:{
        status:codeStatus,
        expires_at:codeExpiresAt,
        attempts,
        max_attempts:Number(meta.otp_max_attempts||CODE_MAX_ATTEMPTS)
      },
      login:{
        provisioned:Boolean(owner?.auth_user_id),
        activated,
        last_sign_in_at:authUser?.last_sign_in_at||null
      },
      mfa_status:mfaStatus,
      onboarding_step:step,
      onboarding_completed:completed,
      lifecycle,
      reissue_allowed:!completed&&!activated
    };
  });
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);

  let createdClientId='';
  let createdAuthUserId='';
  let mailSent=false;

  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login'},401);

    const url=Deno.env.get('SUPABASE_URL')!;
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

    const {data:ud,error:ue}=await admin.auth.getUser(token);
    const user=ud?.user;
    if(ue||!user?.id||!user.email)return json({error:'Ugyldigt login'},401);

    const internal=await getInternalAdmin(admin,user);
    if(!internal)return json({error:'Kun intern ejer/admin kan administrere kunde-onboarding',code:'ADMIN_ONLY'},403);

    const body=await req.json().catch(()=>({}));
    const action=str(body.action||'create',40).toLowerCase();

    if(action==='status'||action==='list'){
      return json({ok:true,customers:await listOnboardingStatus(admin)});
    }

    if(action==='reissue'){
      const clientId=str(body.client_id,100);
      const email=str(body.email,320).toLowerCase();
      if(!clientId||!emailOk(email))return json({error:'Vælg virksomhed og e-mail'},400);

      const {data:client,error:clientErr}=await admin.from('crm_clients')
        .select('id,name,settings')
        .eq('id',clientId)
        .maybeSingle();
      if(clientErr)throw clientErr;
      if(!client)return json({error:'Kundekontoen findes ikke længere',code:'CLIENT_NOT_FOUND'},404);
      if(client?.settings?.saas?.onboarding_completed===true){
        return json({error:'Kunden er allerede aktiv og færdig med onboarding',code:'ALREADY_ACTIVE'},409);
      }

      const {data:claimedInvites,error:claimedErr}=await admin.from('crm_onboarding_invites')
        .select('id')
        .eq('client_id',clientId)
        .ilike('email',email)
        .eq('status','claimed')
        .limit(1);
      if(claimedErr)throw claimedErr;
      if((claimedInvites||[]).length){
        return json({
          error:'Kunden har allerede valgt sit eget password. Brug almindeligt login eller Glemt adgangskode.',
          code:'LOGIN_ALREADY_ACTIVATED'
        },409);
      }

      const provisioned=await provisionAuthUser(admin,clientId,email);
      const inviteOrigin=safeInviteOrigin(req.headers.get('Origin')||'');
      const inviteExpires=new Date(Date.now()+INVITE_VALIDITY_DAYS*86400000);
      const codeExpires=new Date(Date.now()+CODE_VALIDITY_HOURS*3600000);
      const rawToken=b64url(crypto.getRandomValues(new Uint8Array(32)));
      const code=oneTimeCode();

      const result=await admin.rpc('crm_issue_onboarding_invite',{
        p_client_id:clientId,
        p_email:email,
        p_token_hash:await sha256(rawToken),
        p_expires_at:inviteExpires.toISOString(),
        p_actor_id:user.id,
        p_actor_email:user.email
      });
      if(result.error)throw result.error;

      const invitationId=String(result.data?.id||'');
      const {data:inviteRow,error:ire}=await admin.from('crm_onboarding_invites')
        .select('metadata')
        .eq('id',invitationId)
        .maybeSingle();
      if(ire)throw ire;

      const metadata={
        ...(inviteRow?.metadata||{}),
        onboarding_version:'saas_v6',
        invite_origin:inviteOrigin,
        reissued:true,
        auth_user_id:provisioned.userId,
        first_login_mode:'one_time_code',
        otp_hash:await sha256(normalizeCode(code)),
        otp_expires_at:codeExpires.toISOString(),
        otp_attempts:0,
        otp_max_attempts:CODE_MAX_ATTEMPTS,
        otp_verified_at:null,
        otp_locked_at:null,
        password_ticket_hash:null,
        password_ticket_expires_at:null,
        password_set_at:null
      };
      const {error:imu}=await admin.from('crm_onboarding_invites')
        .update({metadata})
        .eq('id',invitationId);
      if(imu)throw imu;

      const inviteLink=inviteOrigin+'/api/app?onboarding='+encodeURIComponent(rawToken);
      try{
        const sent=await sendInviteMail({
          admin,
          internalClientId:internal.client_id,
          fallbackFrom:user.email,
          email,
          companyName:String(result.data?.company_name||client.name||'Lead Manager'),
          recipientName:str(client?.settings?.contact_name||'',240),
          inviteLink,
          oneTimeCode:code,
          inviteExpires,
          codeExpires
        });

        const {error:su}=await admin.from('crm_onboarding_invites').update({
          status:'sent',
          sent_at:new Date().toISOString(),
          metadata:{...metadata,gmail_message_id:sent.gmailMessageId}
        }).eq('id',invitationId);
        if(su)throw su;

        try{
          await admin.from('crm_activities').insert({
            client_id:internal.client_id,
            type:'SaaS invitation',
            actor_type:'user',
            actor_name:user.email,
            summary:`Onboarding-invitation med engangskode gensendt til ${email} (${String(result.data?.company_name||client.name||'')})`,
            metadata:{
              invited_client_id:clientId,
              invitation_id:invitationId,
              plan_code:result.data?.plan_code||null,
              onboarding_version:'saas_v6',
              first_login_mode:'one_time_code',
              invite_origin:inviteOrigin,
              invite_validity_days:INVITE_VALIDITY_DAYS,
              code_validity_hours:CODE_VALIDITY_HOURS,
              reissued:true
            }
          });
        }catch(logError){console.warn('activity log failed',logError)}

        return json({
          ok:true,
          ...result.data,
          sent:true,
          expires_at:inviteExpires.toISOString(),
          code_expires_at:codeExpires.toISOString(),
          invite_validity_days:INVITE_VALIDITY_DAYS,
          code_validity_hours:CODE_VALIDITY_HOURS
        });
      }catch(sendError){
        const {data:current}=await admin.from('crm_onboarding_invites').select('metadata').eq('id',invitationId).maybeSingle();
        await admin.from('crm_onboarding_invites').update({
          status:'send_failed',
          metadata:{
            ...(current?.metadata||metadata),
            send_error:sendError instanceof Error?sendError.message:String(sendError)
          }
        }).eq('id',invitationId);
        throw sendError;
      }
    }

    if(action!=='create')return json({error:'Ukendt handling'},400);

    const companyName=str(body.company_name,240);
    const recipientName=str(body.recipient_name,240);
    const email=str(body.email,320).toLowerCase();
    const plan=str(body.plan_code||'start',20).toLowerCase();
    const serviceModel='self_service_processor';

    if(companyName.length<2)return json({error:'Virksomhedsnavn mangler'},400);
    if(!emailOk(email))return json({error:'Ugyldig e-mail'},400);
    if(!['start','pro','business'].includes(plan))return json({error:'Ugyldig pakke'},400);

    const {data:legalDef,error:ldErr}=await admin.rpc('crm_legal_model_definition',{p_service_model:serviceModel});
    if(ldErr||!legalDef)throw ldErr||new Error('Servicemodellen kunne ikke klassificeres');

    const {data:existing,error:existingErr}=await admin.from('crm_users')
      .select('client_id,email,active')
      .ilike('email',email)
      .eq('active',true)
      .limit(1);
    if(existingErr)throw existingErr;
    if(existing?.length)return json({error:'Denne e-mail er allerede knyttet til en aktiv Lead Manager-konto.',code:'EMAIL_EXISTS'},409);

    const now=new Date();
    const inviteExpires=new Date(now.getTime()+INVITE_VALIDITY_DAYS*86400000);
    const codeExpires=new Date(now.getTime()+CODE_VALIDITY_HOURS*3600000);
    const inviteOrigin=safeInviteOrigin(req.headers.get('Origin')||'');

    const {data:client,error:ce}=await admin.from('crm_clients').insert({
      name:companyName,
      geography:null,
      services:[],
      settings:{
        mail:email,
        contact_name:recipientName||null,
        default_timezone:'Europe/Copenhagen',
        mail_provider:null,
        mail_provider_preference:'later',
        saas:{
          onboarding_completed:false,
          onboarding_step:0,
          onboarding_version:'saas_v6',
          invited_at:now.toISOString(),
          invited_email:email,
          invited_by:user.email,
          account_mode:'self_service_paid',
          legal_service_model:serviceModel,
          first_login_mode:'one_time_code'
        }
      }
    }).select('*').single();
    if(ce||!client)throw ce||new Error('Kunde kunne ikke oprettes');
    createdClientId=client.id;

    const requiresReview=legalDef.requires_legal_review===true;
    const {error:lpErr}=await admin.from('crm_client_legal_profiles').insert({
      client_id:client.id,
      service_model:serviceModel,
      legal_status:requiresReview?'review_required':'draft',
      customer_role:legalDef.customer_role||null,
      platform_role:legalDef.platform_role||null,
      agreement_type:legalDef.agreement_type||null,
      article13_owner:legalDef.article13_owner||null,
      article14_owner:legalDef.article14_owner||null,
      privacy_process:legalDef.privacy_process||null,
      requires_legal_review:requiresReview,
      agreement_status:'pending',
      classification_source:'admin_invite',
      classified_by_email:user.email,
      classified_at:now.toISOString(),
      notes:'Standard betalende Lead Manager-konto: kunden styrer selv workspace, målgrupper, kriterier og opfølgning.'
    });
    if(lpErr)throw lpErr;

    await admin.from('crm_client_legal_profile_audit').insert({
      client_id:client.id,
      actor_email:user.email,
      actor_type:'platform_admin',
      event_type:'classified_on_invite',
      new_service_model:serviceModel,
      new_legal_status:requiresReview?'review_required':'draft',
      metadata:{definition:legalDef}
    });

    const {error:ue2}=await admin.from('crm_users').insert({
      client_id:client.id,
      email,
      role:'owner',
      active:true,
      auth_user_id:null
    });
    if(ue2)throw ue2;

    const provisioned=await provisionAuthUser(admin,client.id,email);
    if(provisioned.created)createdAuthUserId=provisioned.userId;

    const p=await admin.rpc('crm_apply_plan',{p_client_id:client.id,p_plan_code:plan});
    if(p.error)throw p.error;

    const aiClone=await admin.rpc('clone_openai_api_for_service',{
      p_source_client_id:internal.client_id,
      p_target_client_id:client.id
    });
    if(aiClone.error)throw new Error('AI-motoren kunne ikke provisioneres: '+aiClone.error.message);

    const gmailClone=await admin.rpc('clone_gmail_oauth_client_for_service',{
      p_source_client_id:internal.client_id,
      p_target_client_id:client.id
    });
    if(gmailClone.error)console.warn('Google OAuth platform client clone failed',gmailClone.error.message);

    const rawToken=b64url(crypto.getRandomValues(new Uint8Array(32)));
    const code=oneTimeCode();
    const inviteLink=inviteOrigin+'/api/app?onboarding='+encodeURIComponent(rawToken);

    const inviteMetadata={
      company_name:companyName,
      recipient_name:recipientName||null,
      platform_ai:true,
      google_oauth_client_ready:!gmailClone.error,
      onboarding_version:'saas_v6',
      invite_origin:inviteOrigin,
      service_model:serviceModel,
      agreement_type:legalDef.agreement_type||null,
      auth_user_id:provisioned.userId,
      first_login_mode:'one_time_code',
      otp_hash:await sha256(normalizeCode(code)),
      otp_expires_at:codeExpires.toISOString(),
      otp_attempts:0,
      otp_max_attempts:CODE_MAX_ATTEMPTS,
      otp_verified_at:null,
      otp_locked_at:null,
      password_ticket_hash:null,
      password_ticket_expires_at:null,
      password_set_at:null
    };

    const {data:invite,error:ie}=await admin.from('crm_onboarding_invites').insert({
      client_id:client.id,
      email,
      token_hash:await sha256(rawToken),
      plan_code:plan,
      status:'created',
      expires_at:inviteExpires.toISOString(),
      created_by_user_id:user.id,
      created_by_email:user.email,
      metadata:inviteMetadata
    }).select('*').single();
    if(ie||!invite)throw ie||new Error('Invitation kunne ikke oprettes');

    const sent=await sendInviteMail({
      admin,
      internalClientId:internal.client_id,
      fallbackFrom:user.email,
      email,
      companyName,
      recipientName,
      inviteLink,
      oneTimeCode:code,
      inviteExpires,
      codeExpires
    });
    mailSent=true;

    const {error:sentErr}=await admin.from('crm_onboarding_invites').update({
      status:'sent',
      sent_at:new Date().toISOString(),
      metadata:{...inviteMetadata,gmail_message_id:sent.gmailMessageId}
    }).eq('id',invite.id);
    if(sentErr)throw sentErr;

    try{
      await admin.from('crm_activities').insert({
        client_id:internal.client_id,
        type:'SaaS invitation',
        actor_type:'user',
        actor_name:user.email,
        summary:`Onboarding-invitation med engangskode sendt til ${email} (${companyName})`,
        metadata:{
          invited_client_id:client.id,
          invitation_id:invite.id,
          plan_code:plan,
          platform_ai:true,
          onboarding_version:'saas_v6',
          first_login_mode:'one_time_code',
          invite_origin:inviteOrigin,
          invite_validity_days:INVITE_VALIDITY_DAYS,
          code_validity_hours:CODE_VALIDITY_HOURS,
          service_model:serviceModel,
          agreement_type:legalDef.agreement_type||null
        }
      });
    }catch(logError){console.warn('activity log failed',logError)}

    return json({
      ok:true,
      client_id:client.id,
      email,
      company_name:companyName,
      plan_code:plan,
      service_model:serviceModel,
      legal_definition:legalDef,
      expires_at:inviteExpires.toISOString(),
      code_expires_at:codeExpires.toISOString(),
      invite_validity_days:INVITE_VALIDITY_DAYS,
      code_validity_hours:CODE_VALIDITY_HOURS,
      sent:true,
      auth_provisioned:true,
      first_login_mode:'one_time_code',
      platform_ai:true,
      google_oauth_client_ready:!gmailClone.error,
      invite_origin:inviteOrigin
    });
  }catch(err){
    console.error('saas-admin-invite',err);

    if(createdClientId&&!mailSent){
      try{
        const url=Deno.env.get('SUPABASE_URL')!;
        const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const a=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
        if(createdAuthUserId){
          const {error:de}=await a.auth.admin.deleteUser(createdAuthUserId,false);
          if(de)console.error('auth cleanup failed',de);
        }
        await a.from('crm_onboarding_invites').delete().eq('client_id',createdClientId);
        await a.from('crm_usage_limits').delete().eq('client_id',createdClientId);
        await a.from('crm_users').delete().eq('client_id',createdClientId);
        await a.from('crm_integrations').delete().eq('client_id',createdClientId);
        await a.from('crm_clients').delete().eq('id',createdClientId);
      }catch(cleanupError){console.error('cleanup failed',cleanupError)}
    }

    const code=(err as any)?.code||'INVITE_FAILED';
    return json({error:err instanceof Error?err.message:String(err),code},code==='EMAIL_EXISTS'?409:500);
  }
});
