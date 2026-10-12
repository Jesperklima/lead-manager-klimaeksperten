// Passive database-only integrity watchdog. Does not contact Gmail, send mail, or
// change offers. Records anomalies in the existing quality incident dashboard.
const normDate=(value:any)=>String(value||'').slice(0,10);
const statuses=new Set(['unknown','prepared','sending','sent_pending_postprocess','postprocessing']);
const liveOfferStatuses=new Set(['I GANG','AFVENTER','PÅ PAUSE','STATUS UKLAR']);
const localDate=(value:string)=>{
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(value));
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
};

async function issue(admin:any,clientId:string,entityType:string,entityId:string,fingerprint:string,
  summary:string,evidence:Record<string,unknown>,requiredFix:string){
  const now=new Date().toISOString();
  const {error}=await admin.from('crm_quality_incidents').upsert({
    client_id:clientId,rule_key:'mail_integrity',detected_by:'Mail-integritetskontrol',
    offending_agent:'Mail & Conversation Agent',entity_type:entityType,entity_id:entityId,
    fingerprint,error_summary:summary,evidence,required_fix:requiredFix,
    prevention_action:'Kontrollér hele afsendelsesforløbet og registrér resultatet i samme mailjob.',
    status:'open',last_seen_at:now,updated_at:now
  },{onConflict:'client_id,fingerprint'});
  if(error)throw error;
}
async function resolved(admin:any,clientId:string,fingerprint:string){
  const now=new Date().toISOString();
  const {error}=await admin.from('crm_quality_incidents').update({
    status:'resolved',resolved_at:now,verified_at:now,
    verified_by:'Mail-integritetskontrol',
    verification_notes:'Den konkrete fejltilstand findes ikke længere i databasen.',
    updated_at:now
  }).eq('client_id',clientId).eq('fingerprint',fingerprint)
    .in('status',['open','correction_requested','unresolved']);
  if(error)throw error;
}
export async function watchMailIntegrity(admin:any){
  const checkedAt=new Date().toISOString();
  const nowMs=Date.now(),oldest=new Date(nowMs-30*86400000).toISOString();
  const results:any[]=[];
  // Unknown outcomes are not auto-resent; pending jobs with no progress are an operational issue.
  const jobsR=await admin.from('crm_mail_send_jobs')
    .select('id,client_id,status,created_at,updated_at,sent_at,postprocessed_at,error_code')
    .in('status',[...statuses]).gte('created_at',oldest)
    .order('created_at',{ascending:false}).limit(40);
  if(jobsR.error)throw jobsR.error;
  for(const j of jobsR.data||[]){
    const minutes=(nowMs-new Date(j.updated_at||j.created_at).getTime())/60000;
    const threshold=j.status==='unknown'?20:15;
    if(minutes<threshold)continue;
    const key='mail_integrity_stuck_job:'+j.id;
    try{
      await issue(admin,j.client_id,'mail_send_job',j.id,key,
        'Mailafsendelsen mangler en endelig verificeret status ('+j.status+').',
        {job_id:j.id,status:j.status,error_code:j.error_code,created_at:j.created_at,last_changed_at:j.updated_at,checked_at:checkedAt},
        'Kontrollér Gmail Sendt og afslut den eksisterende afsendelse sikkert. Opret ikke en ny mail automatisk.');
      results.push({type:'stuck_send',job_id:j.id,status:j.status});
    }catch(e){results.push({type:'monitor_error',job_id:j.id,error:String(e)})}
  }

  // If a previously reported job is resolved, close its incident automatically.
  const openR=await admin.from('crm_quality_incidents')
    .select('id,client_id,entity_id,fingerprint')
    .eq('rule_key','mail_integrity').eq('entity_type','mail_send_job')
    .in('status',['open','correction_requested','unresolved'])
    .order('last_seen_at',{ascending:false}).limit(50);
  if(openR.error)throw openR.error;
  for(const i of openR.data||[]){
    try{
      const {data:job,error}=await admin.from('crm_mail_send_jobs')
        .select('status,updated_at').eq('id',i.entity_id).eq('client_id',i.client_id).maybeSingle();
      if(error)throw error;
      if(job&&!statuses.has(job.status))await resolved(admin,i.client_id,i.fingerprint);
    }catch(e){results.push({type:'monitor_error',job_id:i.entity_id,error:String(e)})}
  }

  // Last 24h: a finalized outbound message should agree with both the offer's date
  // and its open follow-up task. Later intentional manual planning always wins.
  const sentR=await admin.from('crm_mail_send_jobs')
    .select('id,client_id,offer_id,follow_up_date,sent_at,postprocessed_at')
    .eq('status','sent').not('offer_id','is',null)
    .not('sent_at','is',null).not('postprocessed_at','is',null)
    .gte('sent_at',new Date(nowMs-86400000).toISOString())
    .order('sent_at',{ascending:false}).limit(45);
  if(sentR.error)throw sentR.error;
  const seen=new Set<string>();
  for(const j of sentR.data||[]){
    if(!j.offer_id||seen.has(j.offer_id)||!j.follow_up_date)continue;
    seen.add(j.offer_id);
    const key='mail_integrity_followup:'+j.id;
    try{
      const [offerR,taskR,manualR]=await Promise.all([
        admin.from('crm_offers').select('id,offer_ref,status,follow_up_date')
          .eq('id',j.offer_id).eq('client_id',j.client_id).maybeSingle(),
        admin.from('crm_tasks').select('id,scheduled_at')
          .eq('offer_id',j.offer_id).eq('client_id',j.client_id)
          .eq('task_type','offer_followup').eq('status','open').limit(1),
        admin.from('crm_activities').select('id,metadata')
          .eq('offer_id',j.offer_id).eq('client_id',j.client_id)
          .eq('type','Planlægning').gte('created_at',j.sent_at)
          .order('created_at',{ascending:false}).limit(15)
      ]);
      if(offerR.error||taskR.error||manualR.error)throw offerR.error||taskR.error||manualR.error;
      const offer=offerR.data;
      const manual=(manualR.data||[]).some((a:any)=>a.metadata?.manual===true||a.metadata?.method==='verified_offer_save');
      if(!offer||!liveOfferStatuses.has(offer.status)||manual){await resolved(admin,j.client_id,key);continue}
      const task=taskR.data?.[0],expected=normDate(j.follow_up_date),
        offerDate=normDate(offer.follow_up_date),taskDate=task?.scheduled_at?localDate(task.scheduled_at):null;
      const wrong=offerDate!==expected||taskDate!==expected;
      // Wait for normal postprocessing and short-term automatic repair to settle.
      if(!wrong){await resolved(admin,j.client_id,key);continue}
      if((nowMs-new Date(j.sent_at).getTime())<15*60000)continue;
      await issue(admin,j.client_id,'offer',j.offer_id,key,
        'Bekræftet afsendelse og næste tilbudsopfølgning stemmer ikke overens: '+offer.offer_ref,
        {offer_ref:offer.offer_ref,mail_job_id:j.id,sent_at:j.sent_at,expected_followup:expected,
          offer_followup:offerDate,task_followup:taskDate,checked_at:checkedAt},
        'Undersøg uoverensstemmelsen. Bekræft eventuel manuel ændring; gensend aldrig mailen som rettelse.');
      results.push({type:'followup_mismatch',offer_ref:offer.offer_ref,job_id:j.id});
    }catch(e){results.push({type:'monitor_error',job_id:j.id,error:String(e)})}
  }
  return {checked_at:checkedAt,findings:results};
}
