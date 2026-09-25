(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  const firstEmail=value=>(String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
  const lower=v=>String(v||'').trim().toLowerCase();
  let currentPdfSendId=null;
  let pdfSendState='idle';
  let pdfStatusSeq=0;
  const pdfStatusCache=new Map();

  function offer(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function sender(){try{return String(state?.client?.settings?.mail||'js@klimaeksperten.dk').trim()}catch{return'js@klimaeksperten.dk'}}
  function contacts(o){try{return typeof contactsFor==='function'?contactsFor(o.company_id):((state?.contacts||[]).filter(x=>x.company_id===o.company_id))}catch{return[]}}
  function bounced(email,o){const e=lower(email);return contacts(o).find(x=>lower(x?.email)===e&&String(x?.source_type||'').startsWith('smtp_bounced'))||null}
  function pdfName(o){const ref=String(o?.offer_ref||'').trim();return ref?`Tilbud ${ref}.pdf`:''}
  function makeSendId(){return window.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15,v=c==='x'?r:(r&3|8);return v.toString(16)})}
  const sentStatuses=new Set(['sent','sent_pending_postprocess','postprocessing']);
  function isSentResult(data){return !!data?.sent||sentStatuses.has(String(data?.status||''))}
  function mailErrorFrom(result){const e=new Error(result?.error?.message||'Mailafsendelsen fejlede');Object.assign(e,result?.error||{});return e}
  function friendlyMailError(error){
    const status=Number(error?.status||0),code=String(error?.code||''),message=String(error?.message||'');
    if(status===546||/^546(?:\s|$)/.test(message))return 'Mailtjenesten blev afbrudt under afsendelsen. Lead Manager kontrollerer automatisk, om Gmail nåede at sende mailen.';
    if(code==='SEND_INTERRUPTED_NOT_FOUND')return 'Afsendelsen blev afbrudt, og Gmail kunne ikke finde mailen. Du kan prøve at sende igen.';
    if(code==='DUPLICATE_BLOCKED')return message||'En anden afsendelse af den samme mail er allerede aktiv eller registreret som sendt.';
    if(code==='GMAIL_TOKEN_ERROR'||code==='GMAIL_NOT_CONNECTED')return 'Gmail-forbindelsen skal genetableres, før mailen kan sendes.';
    if(code==='OFFER_PDF_NOT_FOUND')return message||'Tilbuddet findes, men Lead Manager kunne ikke finde en verificeret original PDF. Mailen blev ikke sendt.';
    if(code==='OFFER_PDF_INVALID')return message||'PDF-kilden blev fundet, men filen kunne ikke valideres som en rigtig PDF. Mailen blev ikke sendt.';
    return message||'Mailen kunne ikke sendes.';
  }
  async function pollOfferSendStatus(requestId,tries=5){
    for(let i=0;i<tries;i++){
      if(i)await new Promise(r=>setTimeout(r,800));
      const check=await callProtectedEdge('gmail-offer-send',{action:'status',client_id:state.client.id,request_id:requestId});
      if(check?.data&&isSentResult(check.data))return {state:'sent',data:check.data};
      if(check?.data?.status==='failed'||check?.error?.code==='SEND_INTERRUPTED_NOT_FOUND')return {state:'failed',error:check.error||check.data};
      if(check?.error&&Number(check.error.status)!==546&&check.error.code!=='SEND_JOB_NOT_FOUND')return {state:'failed',error:check.error};
    }
    return {state:'pending'};
  }
  async function finishPdfSend(o,to,data,name){
    byId('offerMailModal')?.classList.remove('open');
    window.dispatchEvent(new CustomEvent('lm:offer-mail-closed',{detail:{offer_id:o.id}}));
    currentPdfSendId=null;pdfSendState='idle';
    if(window.__LM_PERF?.refreshKeys)await window.__LM_PERF.refreshKeys('offers','mail','activities');
    else if(typeof loadAll==='function')await loadAll({keys:['offers','mail','activities'],force:true});
    if(typeof openOffer==='function')openOffer(o.id);
    if(typeof toast==='function')toast(`Mail sendt til ${to} med ${data?.attachment?.filename||name}`);
  }

  function ensureAttachmentRow(){
    const body=byId('offerMailBody');if(!body)return;
    let box=byId('offerMailAttachment');
    if(!box){
      const field=document.createElement('div');field.className='field';field.id='offerMailAttachmentField';
      field.innerHTML='<label>Vedhæftning</label><div id="offerMailAttachment" style="border:1px solid #dfe4ea;border-radius:10px;padding:11px 12px;background:#f8fafc;font-size:14px"></div>';
      body.closest('.field')?.insertAdjacentElement('afterend',field);box=byId('offerMailAttachment');
    }
    const o=offer(),name=pdfName(o);
    if(box)box.innerHTML=name?`📎 <strong>${name}</strong><div class="sub" style="margin-top:4px">Kontrollerer den originale PDF fra Minuba/mailkilden. Mailen kan ikke sendes uden en verificeret PDF.</div>`:'📎 Tilbudsnummer mangler – PDF kan ikke vælges sikkert.';
  }

  function renderPdfStatus(status){
    const box=byId('offerMailAttachment');if(!box)return;
    const o=offer(),expected=pdfName(o);
    if(status?.loading){box.innerHTML=`⏳ Kontrollerer original PDF for <strong>${expected||'tilbuddet'}</strong>…`;return}
    if(status?.ready){
      const actual=String(status?.attachment?.filename||expected||'Tilbuds-PDF');
      box.innerHTML=`✅ <strong>PDF klar · ${actual}</strong><div class="sub" style="margin-top:4px">Kilden er verificeret. Ved afsendelse kontrolleres PDF'en igen, så der ikke kan vedhæftes en forkert fil.</div>`;
      return;
    }
    if(status?.error){
      box.innerHTML=`⚠️ <strong>PDF kunne ikke kontrolleres</strong><div class="sub" style="margin-top:4px">${String(status.error)}</div>`;return;
    }
    box.innerHTML=`⚠️ <strong>Original PDF er ikke fundet endnu</strong><div class="sub" style="margin-top:4px">Tilbuddet findes i Minuba, men Lead Manager har endnu ikke en verificeret PDF-kilde. Systemet prøver igen ved afsendelse og sender aldrig uden en valideret PDF.</div>`;
  }

  async function checkPdfStatus(force=false){
    const o=offer();if(!o?.id||typeof callProtectedEdge!=='function'||!state?.client?.id)return;
    const cached=pdfStatusCache.get(o.id);
    if(!force&&cached&&Date.now()-cached.at<60000){renderPdfStatus(cached.value);return cached.value}
    const seq=++pdfStatusSeq;renderPdfStatus({loading:true});
    try{
      const result=await callProtectedEdge('gmail-offer-send',{action:'pdf_status',client_id:state.client.id,offer_id:o.id});
      if(seq!==pdfStatusSeq||offer()?.id!==o.id)return;
      if(result?.error)throw mailErrorFrom(result);
      const value=result?.data??result;
      pdfStatusCache.set(o.id,{at:Date.now(),value});renderPdfStatus(value);return value;
    }catch(error){
      if(seq!==pdfStatusSeq||offer()?.id!==o.id)return;
      const value={ready:false,error:friendlyMailError(error)};
      pdfStatusCache.set(o.id,{at:Date.now(),value});renderPdfStatus(value);return value;
    }
  }

  async function sendWithPdf(){
    const o=offer();if(!o)return;
    const to=String(byId('offerMailTo')?.value||'').trim(),subject=String(byId('offerMailSubject')?.value||'').trim(),body=String(byId('offerMailBody')?.value||'').trim(),follow=String(byId('offerMailFollow')?.value||'').trim(),name=pdfName(o);
    if(!to||!subject||!body){if(typeof toast==='function')toast('Udfyld modtager, emne og mailtekst');return}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){if(typeof toast==='function')toast('Mailadressen er ikke gyldig');return}
    if(bounced(to,o)){alert(`${to} er markeret som ugyldig efter en permanent mailfejl. Vælg en anden adresse.`);return}
    if(!name){alert('Tilbudsnummeret mangler. Mailen sendes ikke, fordi den rigtige PDF ikke kan identificeres sikkert.');return}
    if(pdfSendState!=='uncertain'&&!confirm(`Send mailen nu fra ${sender()} til ${to} med ${name} vedhæftet?`))return;
    if(!currentPdfSendId)currentPdfSendId=makeSendId();
    const requestId=currentPdfSendId,button=byId('sendOfferMail'),old='Send mail';
    if(button){button.disabled=true;button.textContent=pdfSendState==='uncertain'?'Kontrollerer status…':'Henter PDF og sender…'}
    const attachment=byId('offerMailAttachment');
    if(attachment&&pdfSendState!=='uncertain')attachment.innerHTML=`⏳ Henter <strong>${name}</strong> fra den oprindelige Minuba-mail…`;
    try{
      if(typeof callProtectedEdge!=='function')throw new Error('Mailfunktionen er ikke tilgængelig i denne version af Lead Manager.');
      const result=await callProtectedEdge('gmail-offer-send',{
        client_id:state.client.id,offer_id:o.id,lead_id:o.lead_id||null,to,subject,body,
        follow_up_date:follow||null,request_id:requestId
      });
      if(result?.error)throw mailErrorFrom(result);
      const data=result?.data??result;
      if(isSentResult(data)){await finishPdfSend(o,to,data,name);return}
      if(data?.status==='sending'||data?.status==='prepared'||data?.code==='SEND_IN_PROGRESS'){
        const checked=await pollOfferSendStatus(requestId,5);
        if(checked.state==='sent'){await finishPdfSend(o,to,checked.data,name);return}
        if(checked.state==='failed')throw Object.assign(new Error(checked.error?.message||'Afsendelsen fejlede'),checked.error||{});
        pdfSendState='uncertain';
        alert('Afsendelsen er stadig ved at blive kontrolleret. Lead Manager genbruger samme send-id, så et nyt klik ikke kan sende mailen dobbelt.');
        return;
      }
      if(!data?.ok)throw new Error(data?.error||'Mailen kunne ikke sendes.');
      await finishPdfSend(o,to,data,name);
    }catch(error){
      const status=Number(error?.status||0),raw=String(error?.message||'');
      if(status===546||/^546(?:\s|$)/.test(raw)){
        const checked=await pollOfferSendStatus(requestId,5);
        if(checked.state==='sent'){await finishPdfSend(o,to,checked.data,name);return}
        if(checked.state==='pending'){
          pdfSendState='uncertain';
          alert('Mailtjenesten blev afbrudt, men Lead Manager har låst dette sendeforsøg og kontrollerer status. Brug “Kontroller status” i stedet for at starte en ny afsendelse.');
          return;
        }
        error=Object.assign(new Error(checked.error?.message||raw),checked.error||{});
      }
      ensureAttachmentRow();
      pdfSendState='idle';currentPdfSendId=makeSendId();
      alert('Mailen blev ikke sendt: '+friendlyMailError(error));
    }finally{
      if(button){button.disabled=false;button.textContent=pdfSendState==='uncertain'?'Kontroller status':old}
    }
  }

  function wire(){
    const button=byId('sendOfferMail');if(!button)return;
    ensureAttachmentRow();
    void checkPdfStatus(false);
    if(button.dataset.pdfOfferSend==='1')return;
    button.onclick=sendWithPdf;button.dataset.pdfOfferSend='1';
  }

  const schedule=()=>setTimeout(wire,0);
  window.addEventListener('lm:offer-mail-ready',schedule);
  window.addEventListener('lm:offer-mail-opened',()=>{currentPdfSendId=makeSendId();pdfSendState='idle';const o=offer();if(o?.id)pdfStatusCache.delete(o.id);schedule();setTimeout(()=>void checkPdfStatus(true),0)});
  window.addEventListener('lm:data-refreshed',schedule);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-offer-mail],#openOfferMail,#sendOfferMail,[data-open-offer]'))schedule()},true);
  setTimeout(wire,100);
})();
