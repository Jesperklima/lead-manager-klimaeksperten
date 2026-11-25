(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const firstEmail=value=>(String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
  const lower=v=>String(v||'').trim().toLowerCase();
  let currentPdfSendId=null;
  let pdfSendState='idle';
  let pdfStatusSeq=0;
  let suppressionSeq=0;
  let suppressionBlocked=false;
  let suppressionLoading=false;
  let suppressionReason='';
  let suppressionCode='';
  let sendWatchSeq=0;
  const finishingSendIds=new Set();
  const pdfStatusCache=new Map();
  const suppressionCache=new Map();
  const manualRecipients=new Set();
  let invoiceMailboxApproval=null;
  let invoiceMailboxAction=null;
  const recipientKey=(o,to)=>String(state?.client?.id||'')+'|'+String(o?.id||'')+'|'+lower(to);
  function recipientConfirmation(o,to){return manualRecipients.has(recipientKey(o,to))?{confirmed:true,offer_id:o.id,email:lower(to)}:null}
  function invoiceMailboxConfirmation(o,to){
    return invoiceMailboxApproval?.key===recipientKey(o,to)&&invoiceMailboxApproval.request_id===currentPdfSendId
      ?{confirmed:true,offer_id:o.id,email:lower(to),request_id:currentPdfSendId,reason:'only_customer_address'}:null;
  }
  // Mail preparation may be re-rendered many times during CRM refresh. Never
  // start another identical Minuba/PDF/preflight call while one is running.
  const pdfPreflights=new Map();
  const recipientPreflights=new Map();
  const activeSendPolls=new Map();

  function offer(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function sender(){try{return String(state?.client?.settings?.mail||'js@klimaeksperten.dk').trim()}catch{return'js@klimaeksperten.dk'}}
  function contacts(o){try{return typeof contactsFor==='function'?contactsFor(o.company_id):((state?.contacts||[]).filter(x=>x.company_id===o.company_id))}catch{return[]}}
  function bounced(email,o){const e=lower(email);return contacts(o).find(x=>lower(x?.email)===e&&String(x?.source_type||'').startsWith('smtp_bounced'))||null}
  function pdfName(o){const ref=String(o?.offer_ref||'').trim();return ref?`Tilbud ${ref}.pdf`:''}
  function makeSendId(){return window.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15,v=c==='x'?r:(r&3|8);return v.toString(16)})}
  const finalizedStatuses=new Set(['sent']);
  const FINAL_PRE_SEND_CODES=new Set(['GMAIL_TOKEN_ERROR','GMAIL_SEND_ERROR','GMAIL_QUOTA_EXCEEDED','OFFER_CLOSED','OFFER_CLOSED_IN_MINUBA','MAIL_DAILY_LIMIT','OFFER_MAIL_PRE_SEND_ERROR']);
  const postprocessStatuses=new Set(['sent_pending_postprocess','postprocessing']);
  // Gmail acceptance is NOT the same as a completed CRM follow-up commit.
  function isSentResult(data){return finalizedStatuses.has(String(data?.status||''))}
  function isPostprocessPending(data){return postprocessStatuses.has(String(data?.status||''))}
  function mailErrorFrom(result){const e=new Error(result?.error?.message||'Mailafsendelsen fejlede');Object.assign(e,result?.error||{});return e}
  function friendlyMailError(error){
    const status=Number(error?.status||0),code=String(error?.code||''),message=String(error?.message||'');
    if(status===546||/^546(?:\s|$)/.test(message))return 'Mailtjenesten blev afbrudt under afsendelsen. Lead Manager kontrollerer automatisk, om Gmail nåede at sende mailen.';
    if(code==='GMAIL_QUOTA_EXCEEDED')return 'Google begrænser Gmail-forbruget midlertidigt. Mailen er ikke sendt. Åbn tilbuddet og prøv igen senere. Opfølgningsdatoen må ikke flyttes.';
    if(code==='SEND_INTERRUPTED_NOT_FOUND')return 'Afsendelsen blev afbrudt, og Gmail kunne ikke finde mailen. Du kan prøve at sende igen.';
    if(code==='DUPLICATE_BLOCKED')return message||'En anden afsendelse af den samme mail er allerede aktiv eller registreret som sendt.';
    if(code==='FOLLOWUP_SUPPRESSED'){
      const reason=message.replace(/^Opfølgning er blokeret:\s*/i,'').trim();
      return reason?`Denne kunde/modtager er markeret “ingen opfølgning”. Årsag: ${reason}`:'Denne kunde/modtager er markeret “ingen opfølgning”. Mailen er ikke sendt.';
    }
    if(code==='OFFER_RECIPIENT_INVOICE_MAILBOX')return message||'Fakturaadressen kræver en bekræftelse til denne afsendelse.';
    if(code==='OFFER_RECIPIENT_NOT_DIRECT_CUSTOMER')return message||'Tilbud og priser må kun sendes til den direkte kunde. Den valgte modtager er ikke godkendt.';
    if(code==='GMAIL_TOKEN_ERROR'||code==='GMAIL_NOT_CONNECTED')return 'Gmail-forbindelsen skal genetableres, før mailen kan sendes.';
    if(code==='MINUBA_RECONNECT_REQUIRED')return 'Minuba kræver ny godkendelse under Integrationer. Mailen er ikke sendt.';
    if(code==='MINUBA_REFRESH_UNAVAILABLE')return 'Minuba svarer ikke på tokenfornyelse. Prøv igen senere; mailen er ikke sendt.';
    if(code==='OFFER_PDF_NOT_FOUND')return message||'Originalen til den aktuelle tilbudsversion er endnu ikke fundet.';
    if(code==='OFFER_PDF_INVALID')return message||'PDF-kilden blev fundet, men filen kunne ikke valideres som en rigtig PDF. Mailen blev ikke sendt.';
    return message||'Mailen kunne ikke sendes.';
  }
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function pendingSendKey(o){return `lm_offer_send_pending:${String(state?.client?.id||'')}:${String(o?.id||'')}`}
  function savePendingSend(o,requestId,meta={}){
    if(!o?.id||!requestId)return;
    try{localStorage.setItem(pendingSendKey(o),JSON.stringify({request_id:requestId,created_at:Date.now(),...meta}))}catch{}
  }
  function loadPendingSend(o){
    if(!o?.id)return null;
    try{
      const raw=localStorage.getItem(pendingSendKey(o));if(!raw)return null;
      const value=JSON.parse(raw);
      if(!value?.request_id)return null;
      if(Date.now()-Number(value.created_at||0)>30*60*1000){localStorage.removeItem(pendingSendKey(o));return null}
      return value;
    }catch{return null}
  }
  function clearPendingSend(o,requestId=''){
    if(!o?.id)return;
    try{
      const key=pendingSendKey(o),raw=localStorage.getItem(key);
      if(!raw){return}
      const value=JSON.parse(raw);
      if(!requestId||value?.request_id===requestId)localStorage.removeItem(key);
    }catch{}
  }
  function ensureSendStatusBanner(){
    const body=byId('offerMailBody');if(!body)return null;
    let field=byId('offerMailSendStatusField');
    if(!field){
      field=document.createElement('div');field.className='field';field.id='offerMailSendStatusField';field.hidden=true;
      field.innerHTML='<div id="offerMailSendStatus" role="status" aria-live="polite"></div>';
      const attachmentField=byId('offerMailAttachmentField');
      if(attachmentField)attachmentField.insertAdjacentElement('beforebegin',field);
      else body.closest('.field')?.insertAdjacentElement('afterend',field);
    }
    return byId('offerMailSendStatus');
  }
  function renderSendStatus(kind='',title='',detail=''){
    const box=ensureSendStatusBanner(),field=byId('offerMailSendStatusField');if(!box||!field)return;
    if(!kind){field.hidden=true;box.innerHTML='';return}
    const palette=kind==='success'
      ?{border:'#22c55e',bg:'rgba(20,83,45,.34)',fg:'#dcfce7',icon:'✓'}
      :kind==='error'
        ?{border:'#ef4444',bg:'rgba(127,29,29,.32)',fg:'#fee2e2',icon:'⚠'}
        :{border:'#38bdf8',bg:'rgba(7,89,133,.28)',fg:'#e0f2fe',icon:'⏳'};
    field.hidden=false;
    box.innerHTML=`<div style="border:2px solid ${palette.border};border-radius:12px;padding:14px 16px;background:${palette.bg};color:${palette.fg}"><div style="font-size:16px;font-weight:900">${palette.icon} ${escapeHtml(title)}</div>${detail?`<div style="margin-top:6px;line-height:1.45">${escapeHtml(detail)}</div>`:''}</div>`;
  }
  async function pollOfferSendStatus(requestId,maxMs=135000,onProgress=null){
    const started=Date.now();let attempt=0,last=null;
    while(Date.now()-started<maxMs){
      if(attempt){
        const delay=Math.min(12000,1200*Math.pow(1.45,Math.min(attempt,8)));
        await sleep(delay);
      }
      attempt++;
      let check;
      try{check=await callProtectedEdge('gmail-offer-send',{action:'status',client_id:state.client.id,request_id:requestId})}
      catch(error){check={error}}
      last=check;
      if(check?.data&&isSentResult(check.data))return {state:'sent',data:check.data};
      if(check?.data?.status==='unknown'||check?.error?.code==='SEND_INTERRUPTED_NOT_FOUND')return {state:'unknown',error:check.error||check.data};
      if(check?.data?.status==='failed')return {state:'failed',error:check.error||check.data};
      const code=String(check?.error?.code||'');
      const status=Number(check?.error?.status||0);
      if(check?.error&&status!==546&&!['SEND_JOB_NOT_FOUND','SEND_IN_PROGRESS'].includes(code)&&!(status>=500&&status<600)){
        return {state:'failed',error:check.error};
      }
      if(typeof onProgress==='function')onProgress({attempt,elapsed:Date.now()-started,check});
    }
    return {state:'pending',last};
  }
  function normalizeFollowDate(value){
    const v=String(value||'').trim();
    if(!v)return null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
    const m=v.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
    if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    return v;
  }
  function applyFollowDateLocally(o,value){
    const expected=normalizeFollowDate(value);
    if(!expected||!o?.id)return;
    const local=(state.offers||[]).find(x=>x.id===o.id);
    if(local)local.follow_up_date=expected;
    o.follow_up_date=expected;
    if(offer()?.id===o.id&&byId('oFollow'))byId('oFollow').value=expected;
    const task=(state.tasks||[]).find(t=>t.offer_id===o.id&&t.task_type==='offer_followup'&&t.status==='open');
    if(task&&typeof isoFromInputs==='function')task.scheduled_at=isoFromInputs(expected,'09:00');
    for(const fn of ['renderOffers','renderTasks','renderCalendar','renderOfferPipeline']){
      try{if(typeof window[fn]==='function')window[fn]()}catch(error){console.warn('[Offer mail] Kunne ikke opdatere '+fn,error)}
    }
  }
  function effectiveFollowDate(data,fallback){
    return normalizeFollowDate(data?.follow_up_date)||normalizeFollowDate(fallback);
  }

  async function verifyOfferFollowUp(o,expectedDate){
    const expected=normalizeFollowDate(expectedDate);
    if(!expected||!o?.id||!state?.client?.id||typeof supabase==='undefined')return true;
    const local=(state.offers||[]).find(x=>x.id===o.id);
    // Local state is optimistic and cannot prove a database commit.
    const {data,error}=await supabase.from('crm_offers').select('id,client_id,follow_up_date').eq('id',o.id).eq('client_id',state.client.id).limit(1);
    if(error)throw new Error(error.message||'Kunne ikke bekræfte opfølgningsdatoen');
    const row=Array.isArray(data)?data[0]:data;
    if(normalizeFollowDate(row?.follow_up_date)!==expected)throw new Error(`Opfølgningsdatoen er endnu ikke gemt som ${expected}`);
    if(local)local.follow_up_date=expected;
    o.follow_up_date=expected;
    if(offer()?.id===o.id&&byId('oFollow'))byId('oFollow').value=expected;
    return true;
  }
  async function waitForOfferFollowUp(o,expectedDate,maxMs=45000){
    const started=Date.now();let lastError=null,attempt=0;
    while(Date.now()-started<maxMs){
      attempt++;
      try{
        if(await verifyOfferFollowUp(o,expectedDate)){
          // Database confirmation is authoritative. A slow full CRM reload
          // must not keep the mail composer blocked after Gmail succeeded.
          applyFollowDateLocally(o,expectedDate);
          return true;
        }
      }catch(error){lastError=error}
      await sleep(Math.min(5000,650*attempt));
    }
    throw lastError||new Error('Opfølgningsdatoen blev ikke synkroniseret i tide');
  }
  async function finishPdfSend(o,to,data,name,follow){
    // The server-side finalization must have committed before we report completion.
    if(!isSentResult(data))return false;
    const effectiveFollow=effectiveFollowDate(data,follow),completedSendId=currentPdfSendId;
    if(!completedSendId||finishingSendIds.has(completedSendId))return true;
    finishingSendIds.add(completedSendId);
    pdfSendState='uncertain';
    renderSendStatus('checking','Gmail har sendt mailen – kontrollerer opfølgningen',
      'Mailen må ikke sendes igen. Lead Manager kontrollerer, at næste opfølgning faktisk er gemt i databasen.');
    try{
      await waitForOfferFollowUp(o,effectiveFollow,45000);
      clearPendingSend(o,completedSendId);
      renderSendStatus('success','Mail og opfølgning gennemført',
        `Gmail og Lead Manager er afstemt. Næste opfølgning: ${effectiveFollow||'ingen dato'}.`);
      if(typeof currentOffer==='undefined'||currentOffer?.id===o.id)byId('offerMailModal')?.classList.remove('open');
      window.dispatchEvent(new CustomEvent('lm:offer-mail-closed',{detail:{offer_id:o.id}}));
      window.dispatchEvent(new CustomEvent('lm:offer-mail-sent',{detail:{offer_id:o.id}}));
      currentPdfSendId=null;pdfSendState='idle';
      // Refresh only the changed offer/task lists in background, not the entire
      // mail archive and activity log for every completed outbound message.
      Promise.resolve().then(()=>{
        if(window.__LM_PERF?.refreshKeys)return window.__LM_PERF.refreshKeys('offers','tasks');
        if(typeof loadAll==='function')return loadAll({keys:['offers','tasks'],force:true});
      }).catch(e=>console.warn('[Offer mail] Baggrundsopdatering fejlede',e));
      if(typeof toast==='function')toast(`Mail sendt til ${to} med ${data?.attachment?.filename||name} · opfølgning gemt`);
      return true;
    }catch(error){
      console.error('[Offer mail] Gmail send confirmed but CRM follow-up unverified',error);
      renderSendStatus('error','Mailen er sendt – opfølgningsdatoen kræver kontrol',
        'Send ikke mailen igen. Lead Manager beholder det samme send-id og forsøger at verificere datoen. '+String(error?.message||''));
      if(typeof toast==='function')toast('Mailen er sendt, men opfølgningsdatoen skal kontrolleres');
      const button=byId('sendOfferMail');
      if(button){button.disabled=true;button.textContent='Kontrollerer opfølgningsdato…'}
      setTimeout(()=>{
        if(currentPdfSendId===completedSendId)void resumePendingOfferSend(loadPendingSend(o));
      },12000);
      return false;
    }finally{
      finishingSendIds.delete(completedSendId);
    }
  }

  async function resumePendingOfferSend(saved=null){
    const o=offer();
    if(!o?.id)return false;
    const key=String(state?.client?.id||'')+'|'+o.id;
    if(activeSendPolls.has(key))return activeSendPolls.get(key);
    const job=resumePendingOfferSendInternal(saved);
    activeSendPolls.set(key,job);
    try{return await job}finally{if(activeSendPolls.get(key)===job)activeSendPolls.delete(key)}
  }
  async function resumePendingOfferSendInternal(saved=null){
    const o=offer();if(!o?.id||!state?.client?.id||typeof callProtectedEdge!=='function')return false;
    const button=byId('sendOfferMail');
    let pending=saved||loadPendingSend(o);
    if(!pending){
      const to=String(byId('offerMailTo')?.value||'').trim();
      try{
        const result=await callProtectedEdge('gmail-offer-send',{action:'resume',client_id:state.client.id,offer_id:o.id,to:to||null});
        if(result?.error){
          if(String(result.error.code||'')==='SEND_INTERRUPTED_NOT_FOUND')return false;
          throw mailErrorFrom(result);
        }
        const data=result?.data??result;
        if(data?.pending===false||data?.status==='none')return false;
        if(!data?.send_id)return false;
        if(isSentResult(data)){
          renderSendStatus('info','En mail til denne kunde er netop sendt','Kontrollér, at du ikke sender den samme mail igen.');
          return false;
        }
        const backendFollow=effectiveFollowDate(data,'');
        pending={request_id:data.send_id,created_at:Date.now(),to:to||'',follow:backendFollow||String(byId('offerMailFollow')?.value||''),name:pdfName(o)};
        savePendingSend(o,data.send_id,pending);
      }catch(error){
        console.warn('[Offer mail] Kunne ikke genoptage afsendelsesstatus',error);
        return false;
      }
    }
    if(!pending?.request_id)return false;
    currentPdfSendId=pending.request_id;
    pdfSendState='uncertain';
    if(button){button.disabled=true;button.textContent='Kontrollerer afsendelse…'}
    renderSendStatus('checking','Kontrollerer afsendelsen','Lead Manager følger automatisk det eksisterende sendeforsøg. Der startes ikke en ny mail.');
    const seq=++sendWatchSeq;
    const checked=await pollOfferSendStatus(currentPdfSendId,135000,({elapsed})=>{
      if(seq!==sendWatchSeq)return;
      const seconds=Math.max(1,Math.round(elapsed/1000));
      renderSendStatus('checking','Kontrollerer afsendelsen',`Gmail-status kontrolleres automatisk · ${seconds} sek. Der sendes ikke dobbelt.`);
    });
    if(seq!==sendWatchSeq)return true;
    if(checked.state==='sent'){
      const done=await finishPdfSend(o,pending.to||String(byId('offerMailTo')?.value||''),checked.data,pending.name||pdfName(o),pending.follow||String(byId('offerMailFollow')?.value||''));
      if(!done){
        setTimeout(()=>void resumePendingOfferSend(loadPendingSend(o)),2500);
      }
      return true;
    }
    if(checked.state==='unknown'){
      renderSendStatus('error','Afsendelsesstatus ukendt',
        'Gmail kunne ikke bekræfte afsendelsen. Send ikke mailen igen, før Sendt-mappen er kontrolleret. Send-id bevares.');
      if(button){button.disabled=true;button.textContent='Afventer manuel kontrol'}
      return true;
    }
    if(checked.state==='failed'){
      clearPendingSend(o,currentPdfSendId);
      pdfSendState='idle';
      currentPdfSendId=makeSendId();
      const message=friendlyMailError(checked.error||{});
      renderSendStatus('error','Mailen blev ikke sendt',message+' Du kan rette eventuelle fejl og prøve igen.');
      if(typeof toast==='function')toast('Mailen blev ikke sendt · åbn tilbuddet og prøv igen');
      if(button){button.disabled=false;button.textContent='Prøv igen'}
      return true;
    }
    renderSendStatus('checking','Status kontrolleres fortsat','Lead Manager fortsætter automatisk. Send ikke mailen igen – det samme send-id bevares.');
    if(button){button.disabled=true;button.textContent='Kontrollerer automatisk…'}
    setTimeout(()=>void resumePendingOfferSend(loadPendingSend(o)),15000);
    return true;
  }

  function ensureAttachmentRow(){
    const body=byId('offerMailBody');if(!body)return;
    let box=byId('offerMailAttachment');
    if(!box){
      const field=document.createElement('div');field.className='field';field.id='offerMailAttachmentField';
      field.innerHTML='<label>Vedhæftning</label><div id="offerMailAttachment" style="border:1px solid var(--border);border-radius:10px;padding:11px 12px;background:var(--soft);color:var(--text);font-size:14px"></div>';
      body.closest('.field')?.insertAdjacentElement('afterend',field);box=byId('offerMailAttachment');
    }
    const o=offer(),name=pdfName(o);
    if(box)box.innerHTML=name?`📎 <strong>${escapeHtml(name)}</strong><div class="sub" style="margin-top:4px">Lead Manager finder og kontrollerer originalen automatisk.</div>`:'📎 Tilbudsnummer mangler – PDF kan ikke vælges sikkert.';
  }

  function ensureSuppressionBanner(){
    const body=byId('offerMailBody');if(!body)return null;
    let field=byId('offerMailSuppressionField');
    if(!field){
      field=document.createElement('div');field.className='field';field.id='offerMailSuppressionField';field.hidden=true;
      field.innerHTML='<div id="offerMailSuppression" role="alert" aria-live="polite"></div>';
      const attachmentField=byId('offerMailAttachmentField');
      if(attachmentField)attachmentField.insertAdjacentElement('beforebegin',field);
      else body.closest('.field')?.insertAdjacentElement('afterend',field);
    }
    return byId('offerMailSuppression');
  }

  function blockedButtonText(){
    if(suppressionLoading)return 'Kontrollerer modtager…';
    if(suppressionCode==='OFFER_RECIPIENT_INVOICE_MAILBOX')return invoiceMailboxAction?'Bekræft fakturaadresse':'Blokeret – vælg direkte kunde';
    return suppressionCode==='OFFER_RECIPIENT_NOT_DIRECT_CUSTOMER'?'Blokeret – vælg direkte kunde':'Blokeret – ingen opfølgning';
  }
  function renderSuppressionStatus(status){
    const box=ensureSuppressionBanner(),field=byId('offerMailSuppressionField'),button=byId('sendOfferMail');
    invoiceMailboxAction=null;
    suppressionLoading=!!status?.loading;
    suppressionBlocked=!!status?.blocked;
    suppressionReason=String(status?.reason||'').trim();
    suppressionCode=String(status?.code||'').trim();
    if(!box||!field)return;
    if(status?.loading){
      field.hidden=false;
      box.innerHTML='<div style="border:2px solid rgba(148,163,184,.45);border-radius:12px;padding:14px 16px;background:rgba(15,23,42,.72);color:#cbd5e1;font-weight:700">Kontrollerer modtager og opfølgningsregler…</div>';
      if(button&&pdfSendState==='idle'){button.disabled=true;button.textContent=blockedButtonText()}
      return;
    }
    if(suppressionBlocked&&suppressionCode==='OFFER_RECIPIENT_CONFIRMATION_REQUIRED'){
      const o=offer(),to=String(byId('offerMailTo')?.value||'').trim();
      field.hidden=false;
      box.innerHTML='<div role="alert">Mailadressen er indtastet manuelt og findes ikke i kundedata. Bekræft, at '+escapeHtml(to)+' er modtager hos '+escapeHtml(o?.customer_name||'kunden')+'.<br><button type="button" class="btn" id="confirmOfferRecipient">Bekræft modtager</button></div>';
      byId('confirmOfferRecipient').onclick=async()=>{
        if(!o?.id||offer()?.id!==o.id||recipientKey(o,to)!==recipientKey(offer(),byId('offerMailTo')?.value))return;
        if(!window.confirm('Bekræft, at '+to+' er den korrekte modtager hos '+(o.customer_name||'kunden')+' for tilbud '+o.offer_ref+'. Der sendes ingen mail ved denne bekræftelse.'))return;
        manualRecipients.add(recipientKey(o,to));suppressionCache.delete(recipientKey(o,to));await checkSuppressionStatus(true);
      };
      if(button){button.disabled=true;button.textContent='Bekræft modtager først'}
      return;
    }
    if(suppressionBlocked&&suppressionCode==='OFFER_RECIPIENT_INVOICE_MAILBOX'){
      const current=offer(),to=byId('offerMailTo')?.value;
      field.hidden=false;
      box.textContent=suppressionReason;
      if(status.override_allowed&&current?.id&&to)invoiceMailboxAction=recipientKey(current,to);
      if(button&&pdfSendState==='idle'){button.disabled=!invoiceMailboxAction;button.textContent=blockedButtonText()}
      return;
    }
    if(suppressionBlocked){
      const wrongRecipient=suppressionCode==='OFFER_RECIPIENT_NOT_DIRECT_CUSTOMER';
      const reason=suppressionReason||(wrongRecipient?'Tilbud og priser må kun sendes til den direkte kunde.':'Kunden eller modtageren er markeret som “ingen opfølgning”.');
      const title=wrongRecipient?'⛔ TILBUD BLOKERET – FORKERT MODTAGER':'⛔ MAIL BLOKERET – INGEN OPFØLGNING';
      const lead=wrongRecipient?'Den valgte modtager er ikke bekræftet som kontakt hos den direkte kunde.':'Denne mail må ikke sendes til den valgte modtager.';
      box.dataset.guardCode=suppressionCode;
      field.hidden=false;
      box.innerHTML=`<div style="border:2px solid #ef4444;border-radius:12px;padding:16px 18px;background:rgba(127,29,29,.32);color:#fee2e2;box-shadow:0 0 0 1px rgba(239,68,68,.18) inset"><div style="font-size:17px;font-weight:900;letter-spacing:.02em">${title}</div><div style="margin-top:8px;font-weight:700">${lead}</div><div style="margin-top:8px;line-height:1.45"><strong>Årsag:</strong> ${escapeHtml(reason)}</div><div style="margin-top:10px;font-weight:800">Mailen er ikke sendt.</div></div>`;
      if(button&&pdfSendState==='idle'){button.disabled=true;button.textContent=blockedButtonText()}
      return;
    }
    const invoiceConfirmed=status?.recipient_scope==='invoice_mailbox_confirmed';
    field.hidden=!invoiceConfirmed;
    box.textContent=invoiceConfirmed?'Fakturaadressen er bekræftet til denne ene afsendelse.':'';
    box.dataset.guardCode='';
    suppressionCode='';
    if(button&&pdfSendState==='idle'){button.disabled=false;button.textContent='Send mail'}
  }

  async function checkSuppressionStatus(force=false){
    const o=offer(),to=String(byId('offerMailTo')?.value||'').trim();
    if(!o?.id||typeof callProtectedEdge!=='function'||!state?.client?.id||!to){
      renderSuppressionStatus({blocked:false});return {blocked:false};
    }
    const invoice=invoiceMailboxConfirmation(o,to);
    const recipient=recipientKey(o,to),key=invoice?recipient+'|'+invoice.request_id:recipient,cached=suppressionCache.get(key);
    if(!force&&cached&&Date.now()-cached.at<30000){renderSuppressionStatus(cached.value);return cached.value}
    if(recipientPreflights.has(key))return recipientPreflights.get(key);
    const seq=++suppressionSeq;
    const stillCurrent=()=>{
      const current=offer(),address=byId('offerMailTo')?.value;
      return seq===suppressionSeq&&recipient===recipientKey(current,address)&&invoice?.request_id===invoiceMailboxConfirmation(current,address)?.request_id;
    };
    renderSuppressionStatus({loading:true});
    const job=(async()=>{
      try{
        const result=await callProtectedEdge('gmail-offer-send',{action:'preflight',client_id:state.client.id,offer_id:o.id,to,recipient_confirmation:recipientConfirmation(o,to),request_id:invoice?.request_id,invoice_mailbox_confirmation:invoice});
        if(result?.error)throw mailErrorFrom(result);
        const value=result?.data??result;
        suppressionCache.set(key,{at:Date.now(),value});
        if(stillCurrent())renderSuppressionStatus(value);
        return value;
      }catch(error){
        console.warn('[Offer mail] Modtagerkontrol kunne ikke gennemføres',error);
        const value={blocked:true,code:'PREFLIGHT_UNAVAILABLE',reason:'Modtager og ingen-opfølgning kunne ikke kontrolleres. Prøv igen senere.'};
        suppressionCache.set(key,{at:Date.now(),value});
        if(stillCurrent())renderSuppressionStatus(value);
        return value;
      }
    })();
    recipientPreflights.set(key,job);
    try{return await job}finally{if(recipientPreflights.get(key)===job)recipientPreflights.delete(key)}
  }

  function pdfRequest(action, o, data={},expectPdf=false){
    return callProtectedEdge('gmail-offer-send',{action,client_id:state.client.id,offer_id:o.id,...data},expectPdf);
  }

  async function previewPdf(o,status){
    const clientId=state.client.id;
    const tab=window.open('about:blank','_blank');
    if(!tab){toast('Tillad pop op-vinduer for at åbne PDF’en.');return}
    tab.opener=null;
    try{
      const result=await pdfRequest('pdf_preview',o,{pdf_version:status.version,pdf_digest:status.digest,preview_format:'pdf'},true);
      if(result.error)throw mailErrorFrom(result);
      if(offer()?.id!==o.id||state.client.id!==clientId)throw new Error('Tilbuddet blev ændret.');
      if(!(result.data instanceof Blob))throw new Error('Forhåndsvisning kunne ikke åbnes. Opdatér siden og prøv igen.');
      const url=URL.createObjectURL(result.data);
      tab.location.replace(url);
      setTimeout(()=>URL.revokeObjectURL(url),120000);
    }catch(error){tab.close();toast(friendlyMailError(error))}
  }

  function uploadPdf(o,status){
    const input=document.createElement('input');
    input.type='file';input.accept='application/pdf,.pdf';
    input.onchange=async()=>{
      const file=input.files?.[0];
      if(!file||offer()?.id!==o.id)return;
      if(file.size>20*1024*1024){toast('PDF’en må højst fylde 20 MiB.');return}
      if(!confirm(`Er dette det godkendte tilbud ${o.offer_ref}, som du netop har eksporteret fra Minuba?`))return;
      renderPdfStatus({loading:true});
      try{
        const base64=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onerror=reject;reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);
        });
        if(offer()?.id!==o.id)return;
        const result=await pdfRequest('pdf_upload',o,{pdf_base64:base64,pdf_version:status.version,confirmed_original:true});
        if(result.error)throw mailErrorFrom(result);
        pdfStatusCache.set(state.client.id+'|'+o.id,{at:Date.now(),value:result.data});
        if(offer()?.id===o.id)renderPdfStatus(result.data);
        void refreshCrmKeys('offers');
      }catch(error){
        toast(friendlyMailError(error));
        if(offer()?.id===o.id)renderPdfStatus(status);
      }
    };
    input.click();
  }

  function renderPdfStatus(status){
    const box=byId('offerMailAttachment');if(!box)return;
    const o=offer(),expected=pdfName(o);
    if(status?.loading){box.innerHTML=`⏳ Kontrollerer <strong>${escapeHtml(expected||'tilbuds-PDF')}</strong>…`;return}
    if(status?.ready){
      const actual=String(status.attachment?.filename||expected||'Tilbuds-PDF');
      const source={minuba_file:'Minuba',gmail_sent:'Sendt Gmail',gmail_outbound_copy:'Firmamail',gmail_minuba_copy:'Original fra Minuba via firmamail',manual:'Manuel upload'}[status.attachment?.source]||'Privat lager';
      box.innerHTML=`✅ <strong>${escapeHtml(actual)}</strong> · ${source}<div class="sub">PDF’en vedhæftes automatisk.</div>`;
    }else{
      const reason=String(status?.error||status?.message||'Synkronisér tilbuddet, hvis Minuba-versionen mangler.');
      box.innerHTML=`⚠️ <strong>PDF mangler</strong><div class="sub">${escapeHtml(reason)}</div>`;
    }
    const add=(label,action)=>{
      const button=document.createElement('button');
      button.type='button';button.className='btn secondary';button.textContent=label;button.onclick=action;box.append(button);
    };
    if(status?.ready)add('Åbn PDF',()=>void previewPdf(o,status));
    if(status?.version&&!status.ready)add('Upload original fra Minuba',()=>uploadPdf(o,status));
    if(!status?.ready)add('Søg igen',()=>void checkPdfStatus(true,true));
  }

  async function checkPdfStatus(force=false,refreshSources=false){
    const o=offer();if(!o?.id||typeof callProtectedEdge!=='function'||!state?.client?.id)return;
    const key=state.client.id+'|'+o.id,cached=pdfStatusCache.get(key);
    if(!force&&cached&&Date.now()-cached.at<60000){renderPdfStatus(cached.value);return cached.value}
    if(pdfPreflights.has(key))return pdfPreflights.get(key);
    const seq=++pdfStatusSeq;renderPdfStatus({loading:true});
    const job=(async()=>{
      try{
        const result=await pdfRequest('pdf_status',o,{refresh_sources:refreshSources});
        if(result?.error)throw mailErrorFrom(result);
        const value=result?.data??result;
        pdfStatusCache.set(key,{at:Date.now(),value});
        if(seq===pdfStatusSeq&&offer()?.id===o.id)renderPdfStatus(value);
        return value;
      }catch(error){
        const value={ready:false,error:friendlyMailError(error)};
        pdfStatusCache.set(key,{at:Date.now(),value});
        if(seq===pdfStatusSeq&&offer()?.id===o.id)renderPdfStatus(value);
        return value;
      }
    })();
    pdfPreflights.set(key,job);
    try{return await job}finally{if(pdfPreflights.get(key)===job)pdfPreflights.delete(key)}
  }

  async function handleBackgroundSendResult(o,requestId,to,name,follow,result){
    const pending=loadPendingSend(o);
    if(!pending||pending.request_id!==requestId)return;
    if(result?.error){
      const error=mailErrorFrom(result),status=Number(error?.status||0),code=String(error?.code||'');
      if(status===546||code==='SEND_IN_PROGRESS')return;
      // Ambiguous 5xx (timeouts/internal errors) may occur AFTER Gmail received the mail.
      if(status>=500&&status<600&&!FINAL_PRE_SEND_CODES.has(code))return;
      sendWatchSeq++;
      clearPendingSend(o,requestId);
      pdfSendState='idle';currentPdfSendId=makeSendId();
      renderSendStatus('error','Mailen blev ikke sendt',friendlyMailError(error));
      if(typeof toast==='function')toast('Mailen blev ikke sendt · '+friendlyMailError(error));
      wire();
      return;
    }
    const data=result?.data??result;
    if(isSentResult(data)){
      sendWatchSeq++;
      currentPdfSendId=requestId;
      await finishPdfSend(o,to,data,name,follow);
      return;
    }
    if(data?.status==='failed'){
      sendWatchSeq++;
      clearPendingSend(o,requestId);
      pdfSendState='idle';currentPdfSendId=makeSendId();
      if(typeof toast==='function')toast('Mailen blev ikke sendt · '+friendlyMailError(data));
    }
  }

  async function sendWithPdf(){
    const o=offer();if(!o)return;
    if(pdfSendState!=='idle')return;
    if(!window.LMFollowupDate?.snapshot())return;
    let to=String(byId('offerMailTo')?.value||'').trim(),subject=String(byId('offerMailSubject')?.value||'').trim(),body=String(byId('offerMailBody')?.value||'').trim(),follow=String(byId('offerMailFollow')?.value||'').trim(),name=pdfName(o);
    if(!to||!subject||!body){if(typeof toast==='function')toast('Udfyld modtager, emne og mailtekst');return}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){if(typeof toast==='function')toast('Mailadressen er ikke gyldig');return}
    if(bounced(to,o)){alert(`${to} er markeret som ugyldig efter en permanent mailfejl. Vælg en anden adresse.`);return}
    if(!name){alert('Tilbudsnummeret mangler. Mailen sendes ikke, fordi den rigtige PDF ikke kan identificeres sikkert.');return}
    const suppression=await checkSuppressionStatus(false);
    if(suppression?.blocked){
      const invoiceMailbox=String(suppression.code||'')==='OFFER_RECIPIENT_INVOICE_MAILBOX';
      if(invoiceMailbox)return;
      const wrongRecipient=String(suppression.code||'')==='OFFER_RECIPIENT_NOT_DIRECT_CUSTOMER';
      alert((wrongRecipient?'TILBUD BLOKERET – FORKERT MODTAGER':'MAIL BLOKERET – INGEN OPFØLGNING')+'\n\n'+(suppression.reason||(wrongRecipient?'Tilbud og priser må kun sendes til den direkte kunde.':'Denne kunde/modtager må ikke følges op.'))+'\n\nMailen er ikke sendt.');
      return;
    }
    // Verify the attachment BEFORE asking for final approval or creating a send job.
    // The send endpoint verifies again to protect against changes after this check.
    const pdfCheck=await checkPdfStatus(true);
    if(!pdfCheck?.ready){
      const detail=String(pdfCheck?.message||pdfCheck?.error||'En verificeret tilbuds-PDF kunne ikke hentes.').trim();
      renderPdfStatus(pdfCheck||{error:detail});
      renderSendStatus('error','Afsendelse blokeret – PDF ikke klar',detail);
      alert('MAILEN ER IKKE SENDT\n\n'+detail);
      return;
    }
    if(recipientKey(o,to)!==recipientKey(offer(),byId('offerMailTo')?.value))return;
    const prepared=window.LMFollowupDate.snapshot();if(!prepared)return;
    ({body,follow}=prepared);
    if(pdfSendState!=='uncertain'&&!confirm(`Send mailen nu fra ${sender()} til ${to} med ${name} vedhæftet?`))return;
    if(!currentPdfSendId)currentPdfSendId=makeSendId();
    const requestId=currentPdfSendId,button=byId('sendOfferMail'),old='Send mail';
    savePendingSend(o,requestId,{to,subject,follow,name,created_at:Date.now()});
    // Never publish a new follow-up date before provider-confirmed send and server postprocessing.
    renderSendStatus('checking','Forbereder og sender','Lead Manager bruger et unikt send-id og kontrollerer automatisk resultatet, hvis forbindelsen bliver afbrudt.');
    if(button){button.disabled=true;button.textContent='Forbereder PDF og sender…'}
    const attachment=byId('offerMailAttachment');
    if(attachment&&pdfSendState!=='uncertain')attachment.textContent='Kontrollerer den vedhæftede PDF…';
    try{
      if(typeof callProtectedEdge!=='function')throw new Error('Mailfunktionen er ikke tilgængelig i denne version af Lead Manager.');
      const sendRequest=callProtectedEdge('gmail-offer-send',{
        client_id:state.client.id,offer_id:o.id,lead_id:o.lead_id||null,to,subject,body,
        follow_up_date:follow||null,request_id:requestId,recipient_confirmation:recipientConfirmation(o,to),invoice_mailbox_confirmation:invoiceMailboxConfirmation(o,to),
        pdf_version:pdfCheck.version,pdf_digest:pdfCheck.digest
      });
      const result=await Promise.race([
        sendRequest,
        sleep(1200).then(()=>({__background:true}))
      ]);
      if(result?.__background){
        pdfSendState='uncertain';
        renderSendStatus('checking','Afsendelsen kører i baggrunden','Du kan arbejde videre. Opfølgningsdatoen bliver først opdateret efter bekræftet afsendelse og lagring.');
        // Keep the composer and its chosen follow-up date visible until Gmail confirms the outcome.
        // Closing after 1200ms looked like a reload and hid unconfirmed send state.
        if(typeof toast==='function')toast('Afventer Gmail-bekræftelse · behold mailvinduet åbent eller luk det manuelt');
        void sendRequest.then(r=>handleBackgroundSendResult(o,requestId,to,name,follow,r)).catch(error=>console.warn('[Offer mail] Browserforbindelsen blev afbrudt; samme send-id kontrolleres',error));
        setTimeout(()=>{const pending=loadPendingSend(o);if(pending?.request_id===requestId&&currentPdfSendId===requestId&&pdfSendState==='uncertain')void resumePendingOfferSend(pending)},5000);
        return;
      }
      if(result?.error)throw mailErrorFrom(result);
      const data=result?.data??result;
      if(isSentResult(data)){await finishPdfSend(o,to,data,name,follow);return}
      if(isPostprocessPending(data)){
        renderSendStatus('checking','Gmail har sendt mailen – gemmer opfølgningen',
          'Gmail har accepteret mailen. Lead Manager er ved at gemme opfølgningsdatoen. Send ikke igen.');
        if(button)button.textContent='Gemmer opfølgning…';
      }
      if(data?.status==='sending'||data?.status==='prepared'||isPostprocessPending(data)||data?.code==='SEND_IN_PROGRESS'){
        pdfSendState='uncertain';
        renderSendStatus('checking','Afsendelsen fortsætter i baggrunden','Lead Manager følger det samme send-id og beskytter mod dobbelt afsendelse. Du kan arbejde videre.');
        // The send is not final yet. Leave the editor visible while status is checked.
        if(typeof toast==='function')toast('Gmail har endnu ikke bekræftet afsendelsen');
        setTimeout(()=>void resumePendingOfferSend(loadPendingSend(o)),0);
        return;
      }
      if(!data?.ok)throw new Error(data?.error||'Mailen kunne ikke sendes.');
      pdfSendState='uncertain';
      await resumePendingOfferSend(loadPendingSend(o));
      return;
    }catch(error){
      const status=Number(error?.status||0),raw=String(error?.message||'');
      if(status===546||/^546(?:\s|$)/.test(raw)){
        pdfSendState='uncertain';
        renderSendStatus('checking','Afsendelsen kontrolleres i baggrunden','Lead Manager følger det samme send-id og beskytter mod dobbelt afsendelse. Du kan arbejde videre.');
        // A slow Gmail response must not silently dismiss the composer.
        if(typeof toast==='function')toast('Gmail svarede langsomt · afsendelsen kontrolleres med samme send-id');
        setTimeout(()=>void resumePendingOfferSend(loadPendingSend(o)),0);
        return;
      }
      ensureAttachmentRow();
      if(['FOLLOWUP_SUPPRESSED','OFFER_RECIPIENT_NOT_DIRECT_CUSTOMER'].includes(String(error?.code||''))){
        const code=String(error?.code||''),wrongRecipient=code==='OFFER_RECIPIENT_NOT_DIRECT_CUSTOMER';
        const reason=wrongRecipient?String(error?.message||'').trim():String(error?.message||'').replace(/^Opfølgning er blokeret:\s*/i,'').trim();
        renderSuppressionStatus({blocked:true,code,reason});
        alert((wrongRecipient?'TILBUD BLOKERET – FORKERT MODTAGER':'MAIL BLOKERET – INGEN OPFØLGNING')+'\n\n'+(reason||(wrongRecipient?'Tilbud og priser må kun sendes til den direkte kunde.':'Denne kunde/modtager må ikke følges op.'))+'\n\nMailen er ikke sendt.');
      }else{
        renderSendStatus('error','Mailen blev ikke sendt',friendlyMailError(error));
        if(typeof toast==='function')toast('Mailen blev ikke sendt');
      }
      clearPendingSend(o,requestId);
      pdfSendState='idle';currentPdfSendId=makeSendId();
      if(invoiceMailboxApproval){invoiceMailboxApproval=null;void checkSuppressionStatus(true)}
    }finally{
      if(button){
        const waiting=pdfSendState!=='idle';
        button.disabled=waiting||suppressionLoading||(suppressionBlocked&&!invoiceMailboxAction);
        button.textContent=waiting?'Kontrollerer automatisk…':(suppressionLoading||suppressionBlocked?blockedButtonText():old);
      }
    }
  }

  function handleOfferMailPrimary(){
    if(pdfSendState!=='idle'||suppressionLoading)return;
    if(!invoiceMailboxAction){void sendWithPdf();return}
    const current=offer(),to=byId('offerMailTo')?.value;
    if(!current?.id||invoiceMailboxAction!==recipientKey(current,to)){void checkSuppressionStatus(true);return}
    if(!currentPdfSendId)currentPdfSendId=makeSendId();
    invoiceMailboxApproval={key:invoiceMailboxAction,request_id:currentPdfSendId};
    void checkSuppressionStatus(true);
  }

  function wire(){
    // The composer exists in the DOM even while closed. Do not keep issuing
    // PDF and recipient preflight requests for hidden modal content.
    if(!byId('offerMailModal')?.classList.contains('open'))return;
    const button=byId('sendOfferMail');if(!button)return;
    ensureAttachmentRow();ensureSuppressionBanner();ensureSendStatusBanner();
    if(pdfSendState!=='idle'){button.disabled=true;button.textContent='Kontrollerer afsendelse…'}
    void checkPdfStatus(false);void checkSuppressionStatus(false);
    const to=byId('offerMailTo');
    if(to&&!to.dataset.suppressionBound){
      to.dataset.suppressionBound='1';
      let timer=null;
      let lastRecipient=recipientKey(offer(),to.value);
      const recheck=()=>{
        const key=recipientKey(offer(),to.value);
        if(key===lastRecipient)return;
        lastRecipient=key;
        if(invoiceMailboxApproval?.key===key)return;
        invoiceMailboxApproval=null;suppressionSeq++;recipientPreflights.clear();renderSuppressionStatus({loading:true});
        clearTimeout(timer);
        timer=setTimeout(()=>{if(byId('offerMailModal')?.classList.contains('open'))void checkSuppressionStatus(true)},250);
      };
      to.addEventListener('input',recheck);to.addEventListener('change',recheck);
    }
    if(button.dataset.pdfOfferSend==='1')return;
    button.onclick=handleOfferMailPrimary;button.dataset.pdfOfferSend='1';
  }

  const schedule=()=>setTimeout(wire,0);
  window.addEventListener('lm:offer-mail-ready',schedule);
  window.addEventListener('lm:offer-mail-closed',()=>{invoiceMailboxApproval=null;invoiceMailboxAction=null;suppressionSeq++;recipientPreflights.clear()});
  window.addEventListener('lm:offer-mail-opened',()=>{manualRecipients.clear();invoiceMailboxApproval=null;invoiceMailboxAction=null;currentPdfSendId=null;pdfSendState='checking';suppressionBlocked=false;suppressionLoading=false;suppressionReason='';suppressionCode='';suppressionSeq++;recipientPreflights.clear();sendWatchSeq++;const o=offer();if(o?.id){pdfStatusCache.delete(String(state?.client?.id||'')+'|'+o.id);for(const key of suppressionCache.keys())if(key.startsWith(String(state?.client?.id||'')+'|'+o.id+'|'))suppressionCache.delete(key)}schedule();setTimeout(async()=>{const resumed=await resumePendingOfferSend();if(!resumed&&offer()?.id===o?.id){pdfSendState='idle';if(!currentPdfSendId)currentPdfSendId=makeSendId();renderSendStatus();wire()}},0)});
  window.addEventListener('lm:data-refreshed',schedule);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-offer-mail],#openOfferMail,#sendOfferMail,[data-open-offer]'))schedule()},true);
  setTimeout(wire,100);
})();
