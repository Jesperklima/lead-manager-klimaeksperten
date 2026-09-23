import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const trim=(v:unknown,max=200)=>String(v??'').trim().slice(0,max);

async function finalizeJob(admin:any,jobId:string){
  const {data,error}=await admin.rpc('crm_finalize_mail_send_job',{p_job_id:jobId});
  if(error)throw error;

  const {data:job,error:jobError}=await admin.from('crm_mail_send_jobs')
    .select('id,client_id,gmail_message_id,attachment_filename,attachment_source,source_message_id')
    .eq('id',jobId).maybeSingle();
  if(jobError)throw jobError;

  if(job?.gmail_message_id&&job?.attachment_filename){
    const {data:mail,error:mailError}=await admin.from('crm_mail_messages')
      .select('id,metadata')
      .eq('client_id',job.client_id)
      .eq('provider','gmail')
      .eq('external_message_id',job.gmail_message_id)
      .maybeSingle();
    if(mailError)throw mailError;
    if(mail?.id){
      const metadata={
        ...(mail.metadata||{}),
        attachment_filename:job.attachment_filename,
        attachment_source:job.attachment_source||'minuba_original_mail',
        source_message_id:job.source_message_id||null
      };
      const {error:updateError}=await admin.from('crm_mail_messages').update({metadata}).eq('id',mail.id);
      if(updateError)throw updateError;
    }
  }
  return data;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);

  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const supplied=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!serviceKey||supplied!==serviceKey)return json({error:'Unauthorized'},401);

  const supabaseUrl=Deno.env.get('SUPABASE_URL')!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  try{
    const body=await req.json().catch(()=>({}));
    const jobId=trim(body.job_id,80);
    if(jobId){
      const data=await finalizeJob(admin,jobId);
      return json({ok:true,result:data});
    }

    const limit=Math.max(1,Math.min(20,Number(body.limit||10)));
    const {data:jobs,error:jobsError}=await admin.from('crm_mail_send_jobs')
      .select('id,status,created_at')
      .in('status',['sent_pending_postprocess','postprocessing'])
      .order('created_at',{ascending:true})
      .limit(limit);
    if(jobsError)throw jobsError;

    const results:any[]=[];
    for(const job of jobs||[]){
      try{
        const data=await finalizeJob(admin,job.id);
        results.push({job_id:job.id,ok:true,result:data});
      }catch(e){
        results.push({job_id:job.id,ok:false,error:e instanceof Error?e.message:String(e)});
      }
    }
    return json({ok:true,processed:results.length,results});
  }catch(err){
    console.error(err);
    return json({error:err instanceof Error?err.message:'Ukendt fejl',code:'MAIL_POSTPROCESS_ERROR'},500);
  }
});
