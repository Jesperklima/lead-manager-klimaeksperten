// Repair short-lived race conditions after a provider-confirmed offer send.
// This module never sends messages, modifies completed/closed offers, or overwrites
// an explicitly logged manual follow-up adjustment.
const activeOfferStatuses=new Set(['I GANG','AFVENTER','PÅ PAUSE','STATUS UKLAR']);
const asDate=(x:any)=>String(x??'').slice(0,10);

export async function reconcileSentOfferFollowups(admin:any,limit=10){
  const since=new Date(Date.now()-35*60000).toISOString();
  const {data:jobs,error:jobsError}=await admin.from('crm_mail_send_jobs')
    .select('id,client_id,offer_id,provider,provider_message_id,gmail_message_id,follow_up_date,sent_at,postprocessed_at')
    .eq('status','sent').not('offer_id','is',null)
    .not('sent_at','is',null).not('postprocessed_at','is',null)
    .gte('sent_at',since).order('sent_at',{ascending:false})
    .limit(Math.min(40,Math.max(1,limit)*4));
  if(jobsError)throw jobsError;
  const results:any[]=[],seen=new Set<string>();
  for(const j of jobs||[]){
    if(results.length>=limit)break;
    if(!j.offer_id||!j.follow_up_date||seen.has(j.offer_id))continue;
    seen.add(j.offer_id);
    const messageId=String(j.provider_message_id||j.gmail_message_id||'');
    if(!messageId)continue;

    try{
      // Only a successfully postprocessed job that has a persisted provider-accepted
      // outbound message for the same client and offer is allowed to correct a date.
      const [offerR,mailR]=await Promise.all([
        admin.from('crm_offers')
          .select('id,client_id,offer_ref,status,follow_up_date,status_updated_at')
          .eq('id',j.offer_id).eq('client_id',j.client_id).maybeSingle(),
        admin.from('crm_mail_messages')
          .select('id,metadata')
          .eq('client_id',j.client_id).eq('offer_id',j.offer_id)
          .eq('provider',j.provider).eq('direction','outbound')
          .eq('external_message_id',messageId).maybeSingle()
      ]);
      if(offerR.error||mailR.error)throw offerR.error||mailR.error;
      const o=offerR.data,m=mailR.data;
      if(!o||!activeOfferStatuses.has(String(o.status||''))||!m||m.metadata?.provider_accepted!==true)continue;
      const expected=asDate(j.follow_up_date),actual=asDate(o.follow_up_date);
      if(actual===expected)continue;
      // A stale editor save can update status_updated_at without changing the status
      // or actually selecting a new follow-up. Use explicit manual planning evidence,
      // not that timestamp alone, to distinguish a deliberate reschedule.
      // An explicit manually logged post-send reschedule takes priority over the send.
      const manualR=await admin.from('crm_activities')
        .select('id,metadata')
        .eq('client_id',j.client_id).eq('offer_id',j.offer_id)
        .eq('type','Planlægning').gte('created_at',j.sent_at)
        .order('created_at',{ascending:false}).limit(15);
      if(manualR.error)throw manualR.error;
      if((manualR.data||[]).some((a:any)=>a.metadata?.manual===true||a.metadata?.method==='verified_offer_save'))continue;

      let update=admin.from('crm_offers')
        .update({follow_up_date:expected})
        .eq('client_id',j.client_id).eq('id',j.offer_id)
        .eq('status',o.status);
      update=actual?update.eq('follow_up_date',actual):update.is('follow_up_date',null);
      const {data:corrected,error:updateError}=await update.select('id,follow_up_date').maybeSingle();
      if(updateError)throw updateError;
      if(!corrected)continue; // Another process changed the row; never clobber it.

      // Offer update invokes the existing offer->task synchronization trigger.
      const {error:auditError}=await admin.from('crm_activities').insert({
        client_id:j.client_id,offer_id:j.offer_id,
        type:'Planlægning',actor_type:'agent',actor_name:'Lead Manager',
        summary:'Opfølgningsdato genskabt efter bekræftet mailafsendelse: '+o.offer_ref,
        metadata:{source:'verified_send_followup_reconciliation',mail_send_job_id:j.id,
          gmail_message_id:messageId,previous_follow_up_date:actual||null,
          restored_follow_up_date:expected,reason:'followup_date_mismatch_after_confirmed_send'}
      });
      if(auditError)console.error('[mail-followup-reconcile] audit failed',j.id,auditError.message);
      results.push({offer_ref:o.offer_ref,status:'corrected',from:actual,to:expected,job_id:j.id});
    }catch(e){
      results.push({offer_id:j.offer_id,status:'error',error:e instanceof Error?e.message:String(e)});
    }
  }
  return results;
}
