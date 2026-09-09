import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
const trim=(v:unknown,max=5000)=>String(v??'').trim().slice(0,max);
const TYPES=new Set(['bug','improvement','idea','other']);
const STATUSES=new Set(['new','reviewing','planned','parked','rejected','built']);
const REGRESSION_STATUSES=new Set(['queued','implementing','verified']);
const PREVENTION_TYPES=new Set(['regression_test','runtime_guard','data_guard','monitoring','process_guard','other']);
const typeLabel=(v:string)=>({bug:'Fejl',improvement:'Forbedringsforslag',idea:'God idé',other:'Andet'} as Record<string,string>)[v]||v;
const bytesToB64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)};
const b64url=(s:string)=>bytesToB64(new TextEncoder().encode(s)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const b64header=(s:string)=>'=?UTF-8?B?'+bytesToB64(new TextEncoder().encode(s))+'?=';
async function notifyInternal(admin:any,feedback:any,clientName:string){
  try{
    const {data:internalLimit}=await admin.from('crm_usage_limits').select('client_id').eq('plan_code','internal').limit(1).maybeSingle();
    if(!internalLimit?.client_id)return {sent:false,error:'Internal client not found'};
    const {data:mat,error:matError}=await admin.rpc('get_gmail_oauth_material',{p_client_id:internalLimit.client_id});
    if(matError)throw matError;
    const account=trim(mat?.account,320).toLowerCase(),clientId=trim(mat?.client_id,500),clientSecret=trim(mat?.client_secret,500),refreshToken=trim(mat?.refresh_token,4000);
    if(!account||!clientId||!clientSecret||!refreshToken)return {sent:false,error:'Internal Gmail not connected'};
    const tokenResp=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
    const tokenData=await tokenResp.json().catch(()=>({}));
    if(!tokenResp.ok||!tokenData.access_token)throw new Error(String(tokenData?.error_description||tokenData?.error||'Google token error'));
    const recipient=trim(Deno.env.get('FEEDBACK_NOTIFICATION_EMAIL')||account,320).toLowerCase();
    const subject=`[Lead Manager Feedback] ${clientName} · ${typeLabel(feedback.feedback_type)}`;
    const regressionLine=feedback.feedback_type==='bug'?'Regression: Oprettet automatisk. Fejlen må ikke markeres Bygget før forebyggelsen er verificeret.':'';
    const body=[`Feedback ID: ${feedback.id}`,`Kunde: ${clientName}`,`Type: ${typeLabel(feedback.feedback_type)}`,`Bruger: ${feedback.user_email}`,`Område: ${feedback.context_view||feedback.page_path||'ukendt'}`,feedback.title?`Overskrift: ${feedback.title}`:'','',feedback.message,'',regressionLine,'Status: Ny','Feedbacken er gemt i Lead Manager → Feedback & idéer.'].filter(Boolean).join('\r\n');
    const mime=[`From: ${account}`,`To: ${recipient}`,`Subject: ${b64header(subject)}`,'MIME-Version: 1.0','Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',body,''].join('\r\n');
    const sendResp=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+tokenData.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw:b64url(mime)})});
    const sent=await sendResp.json().catch(()=>({}));
    if(!sendResp.ok||!sent.id)throw new Error(String(sent?.error?.message||`Gmail send failed (${sendResp.status})`));
    return {sent:true,id:sent.id};
  }catch(err){return {sent:false,error:err instanceof Error?err.message:String(err)}}
}
async function guardsFor(admin:any,ids:string[]){
  if(!ids.length)return new Map();
  const {data,error}=await admin.from('crm_regression_guards').select('*').in('feedback_id',ids);if(error)throw error;
  return new Map((data||[]).map((x:any)=>[x.feedback_id,x]));
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login-token'},401);
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;
    if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt login'},401);
    const {data:members,error:memberError}=await admin.from('crm_users').select('email,client_id,role,auth_user_id,active').eq('active',true).ilike('email',user.email).limit(5);
    if(memberError)throw memberError;
    const membership=(members||[]).find((m:any)=>!m.auth_user_id||m.auth_user_id===user.id);
    if(!membership)return json({error:'Ingen aktiv kundeadgang'},403);
    const [{data:client,error:clientError},{data:plan,error:planError}]=await Promise.all([admin.from('crm_clients').select('id,name').eq('id',membership.client_id).single(),admin.from('crm_usage_limits').select('plan_code').eq('client_id',membership.client_id).maybeSingle()]);
    if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);if(planError)throw planError;
    const body=await req.json().catch(()=>({})),action=trim(body.action,40)||'submit',internal=plan?.plan_code==='internal';
    if(action==='submit'){
      const feedbackType=trim(body.feedback_type,40),message=trim(body.message,5000),title=trim(body.title,180)||null;
      if(!TYPES.has(feedbackType))return json({error:'Ugyldig feedbacktype'},400);
      if(message.length<10)return json({error:'Feedbacken er for kort'},400);
      const payload={client_id:client.id,user_auth_id:user.id,user_email:user.email.toLowerCase(),feedback_type:feedbackType,title,message,page_path:trim(body.page_path,500)||null,page_title:trim(body.page_title,300)||null,context_view:trim(body.context_view,100)||null,browser:trim(body.browser,500)||null,status:'new',metadata:{source:'lead_manager_ui',regression_required:feedbackType==='bug'}};
      const {data:feedback,error:insertError}=await admin.from('crm_feedback').insert(payload).select('*').single();if(insertError)throw insertError;
      const {data:guard}=feedbackType==='bug'?await admin.from('crm_regression_guards').select('*').eq('feedback_id',feedback.id).maybeSingle():{data:null};
      const notice=await notifyInternal(admin,feedback,client.name);
      const upd:any={notified_at:notice.sent?new Date().toISOString():null,notification_error:notice.sent?null:trim(notice.error,1000)||'Ukendt notifikationsfejl',updated_at:new Date().toISOString()};
      await admin.from('crm_feedback').update(upd).eq('id',feedback.id);
      const queuePayload={client_id:client.id,request_type:feedbackType==='bug'?'customer_bug_regression_review':'customer_feedback_review',request_text:`${typeLabel(feedbackType)} fra ${client.name}: ${title||message.slice(0,160)}`,status:'queued',created_by:user.email,payload:{feedback_id:feedback.id,feedback_type:feedbackType,title,message,source:'customer_feedback',requires_regression_guard:feedbackType==='bug'}};
      await admin.from('crm_agent_requests').insert(queuePayload);
      return json({ok:true,id:feedback.id,notification_sent:notice.sent,regression_guard:guard||null});
    }
    if(action==='mine'){
      const {data,error}=await admin.from('crm_feedback').select('id,feedback_type,title,message,status,admin_note,created_at,updated_at').eq('client_id',client.id).order('created_at',{ascending:false}).limit(20);if(error)throw error;
      const map=await guardsFor(admin,(data||[]).map((x:any)=>x.id));return json({items:(data||[]).map((x:any)=>({...x,regression_guard:map.get(x.id)||null}))});
    }
    if(!internal)return json({error:'Kun intern administrator har adgang'},403);
    if(action==='list'){
      const status=trim(body.status,30),limit=Math.max(1,Math.min(Number(body.limit)||100,200));let q=admin.from('crm_feedback').select('*,client:crm_clients(name)').order('created_at',{ascending:false}).limit(limit);if(status&&STATUSES.has(status))q=q.eq('status',status);const {data,error}=await q;if(error)throw error;
      const map=await guardsFor(admin,(data||[]).map((x:any)=>x.id));return json({items:(data||[]).map((x:any)=>({...x,client_name:x.client?.name||'',regression_guard:map.get(x.id)||null}))});
    }
    if(action==='regression_update'){
      const feedbackId=trim(body.feedback_id,80),status=trim(body.status,30),preventionType=trim(body.prevention_type,40)||'regression_test';
      if(!feedbackId||!REGRESSION_STATUSES.has(status)||!PREVENTION_TYPES.has(preventionType))return json({error:'Ugyldig regression-opdatering'},400);
      const invariant=trim(body.invariant,4000),implementationReference=trim(body.implementation_reference,2000),testReference=trim(body.test_reference,2000),verificationNote=trim(body.verification_note,3000);
      if(status==='verified'&&(!invariant||!implementationReference||!testReference))return json({error:'Verificering kræver regel, implementeringsreference og test/kontrol-reference.'},400);
      const patch:any={status,prevention_type:preventionType};
      if(invariant)patch.invariant=invariant;if(implementationReference||status==='verified')patch.implementation_reference=implementationReference||null;if(testReference||status==='verified')patch.test_reference=testReference||null;if(verificationNote)patch.verification_note=verificationNote;
      const {data,error}=await admin.from('crm_regression_guards').update(patch).eq('feedback_id',feedbackId).select('*').single();if(error)throw error;return json({ok:true,item:data});
    }
    if(action==='update'){
      const id=trim(body.id,80),status=trim(body.status,30),adminNote=trim(body.admin_note,3000)||null;if(!id||!STATUSES.has(status))return json({error:'Ugyldig opdatering'},400);
      const now=new Date().toISOString(),patch:any={status,admin_note:adminNote,updated_at:now};if(status!=='new')patch.reviewed_at=now;
      const {data,error}=await admin.from('crm_feedback').update(patch).eq('id',id).select('*').single();if(error)return json({error:error.message},409);return json({ok:true,item:data});
    }
    return json({error:'Ukendt handling'},400);
  }catch(err){console.error(err);return json({error:err instanceof Error?err.message:'Ukendt fejl'},500)}
});
