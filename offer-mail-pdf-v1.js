(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  const firstEmail=value=>(String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
  const lower=v=>String(v||'').trim().toLowerCase();
  let currentPdfSendId=null;
  let pdfSendState='idle';
  let pdfStatusSeq=0;
  let suppressionSeq=0;
  let suppressionBlocked=false;
  let suppressionReason='';
  const pdfStatusCache=new Map();
  const suppressionCache=new Map();

  function offer(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function sender(){try{return String(state?.client?.settings?.mail||'js@klimaeksperten.dk').trim()}catch{return'js@klimaeksperten.dk'}}
  function contacts(o){try{return typeof contactsFor==='function'?contactsFor(o.company_id):((state?.contacts||[]).filter(x=>x.company_id===o.company_id))}catch{return[]}}
  function bounced(email,o){const e=lower(email);return contacts(o).find(x=>lower(x?.email)===e&&String(x?.source_type||'').startsWith('smtp_bounced'))||null}
  function pdfName(o){const ref=String(o?.offer_ref||'').trim();return ref?`Tilbud ${ref}.pdf`:''}
  function makeSendId(){return window.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15,v=c==='x'?r:(r&3|8);return v.toString(16)})}
  const finalizedStatuses=new Set(['sent']);
  const postprocessStatuses=new Set(['sent_pending_postprocess','postprocessing']);
  function isSentResult(data){return finalizedStatuses.has(String(data?.status||''))}
  function isPostprocessPending(data){return postprocessStatuses.has(String(data?.status||''))}
  function mailErrorFrom(result){const e=new Error(result?.error?.message||'Mailafsendelsen fejlede');Object.assign(e,result?.error||{});return e}
  function friendlyMailError(error){
    const status=Number(error?.status||0),code=String(error?.code||''),message=String(error?.message||'');
    if(status===546||/^546(?:\s|$)/.test(message))return 'Mailtjenesten blev afbrudt under afsendelsen. Lead Manager kontrollerer automatisk, om Gmail nåede at sende mailen.';
    if(code==='SEND_INTERRUPTED_NOT_FOUND')return 'Afsendelsen blev afbrudt, og Gmail kunne ikke finde mailen. Du kan prøve at sende igen.';
    if(code==='DUPLICATE_BLOCKED')return message||'En anden afsendelse af den samme mail er allerede aktiv eller registreret som sendt.';
    if(code==='FOLLOWUP_SUPPRESSED'){
      const reason=message.replace(/^Opfølgning er blokeret:\s*/i,'').trim();
      return reason?`Denne kunde/modtager er markeret “ingen opfølgning”. Årsag: ${reason}`:'Denne kunde/modtager er markeret “ingen opfølgning”. Mailen er ikke sendt.';
    }
    if(code==='GMAIL_TOKEN_ERROR'||code==='GMAIL_NOT_CONNECTED')return 'Gmail-forbindelsen skal genetableres, før mailen kan sendes.';
    if(code==='OFFER_PDF_NOT_FOUND')return message||'Tilbuddet findes, men Lead Manager kunne ikke hente eller generere en verificeret tilbuds-PDF. Mailen blev ikke sendt.';
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
  function normalizeFollowDate(value){
    const v=String(value||'').trim();
    if(!v)return null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
    const m=v.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
    if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    return v;
  }
  async function verifyOfferFollowUp(o,expectedDate){
    const expected=normalizeFollowDate(expectedDate);
    if(!expected||!o?.id||!state?.client?.id||typeof supabase==='undefined')return true;
    const local=(state.offers||[]).find(x=>x.id===o.id);
    if(normalizeFollowDate(local?.follow_up_date)===expected){o.follow_up_date=expected;return true}
    const {data,error}=await supabase.from('crm_offers').select('id,client_id,follow_up_date').eq('id',o.id).eq('client_id',state.client.id).limit(1);
    if(error)throw new Error(error.message||'Kunne ikke bekræfte opfølgningsdatoen');
    const row=Array.isArray(data)?data[0]:data;
    if(normalizeFollowDate(row?.follow_up_date)!==expected)throw new Error(`Opfølgningsdatoen er endnu ikke gemt som ${expected}`);
    if(local)local.follow_up_date=expected;
    o.follow_up_date=expected;
    return true;
  }
  async function finishPdfSend(o,to,data,name,follow){
    try{
      if(window.__LM_PERF?.refreshKeys)await window.__LM_PERF.refreshKeys('offers','tasks','mail','activities');
      else if(typeof loadAll==='function')await loadAll({keys:['offers','tasks','mail','activities'],force:true});
      await verifyOfferFollowUp(o,follow);
    }catch(error){
      pdfSendState='uncertain';
      alert('Mailen er sendt, men Lead Manager kunne ikke bekræfte den nye opfølgningsdato endnu. Send ikke mailen igen. Brug “Kontroller status”, så den samme afsendelse genbruges.\n\n'+String(error?.message||''));
      return false;
    }
    byId('offerMailModal')?.classList.remove('open');
    window.dispatchEvent(new CustomEvent('lm:offer-mail-closed',{detail:{offer_id:o.id}}));
    currentPdfSendId=null;pdfSendState='idle';
    if(typeof openOffer==='function')openOffer(o.id);
    if(typeof toast==='function')toast(`Mail sendt til ${to} med ${data?.attachment?.filename||name} · opfølgning gemt`);
    return true;
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
    if(box)box.innerHTML=name?`📎 <strong>${name}</strong><div class="sub" style="margin-top:4px">Lead Manager henter en eksisterende PDF eller genererer den fra tilbudsdata i Minuba. Mailen kan ikke sendes uden en verificeret PDF.</div>`:'📎 Tilbudsnummer mangler – PDF kan ikke vælges sikkert.';
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

  function renderSuppressionStatus(status){
    const box=ensureSuppressionBanner(),field=byId('offerMailSuppressionField'),button=byId('sendOfferMail');
    suppressionBlocked=!!status?.blocked;
    suppressionReason=String(status?.reason||'').trim();
    if(!box||!field)return;
    if(status?.loading){
      field.hidden=false;
      box.innerHTML='<div style="border:2px solid rgba(148,163,184,.45);border-radius:12px;padding:14px 16px;background:rgba(15,23,42,.72);color:#cbd5e1;font-weight:700">Kontrollerer om kunden må følges op…</div>';
      return;
    }
    if(suppressionBlocked){
      const reason=suppressionReason||'Kunden eller modtageren er markeret som “ingen opfølgning”.';
      field.hidden=false;
      box.innerHTML=`<div style="border:2px solid #ef4444;border-radius:12px;padding:16px 18px;background:rgba(127,29,29,.32);color:#fee2e2;box-shadow:0 0 0 1px rgba(239,68,68,.18) inset"><div style="font-size:17px;font-weight:900;letter-spacing:.02em">⛔ MAIL BLOKERET – INGEN OPFØLGNING</div><div style="margin-top:8px;font-weight:700">Denne mail må ikke sendes til den valgte modtager.</div><div style="margin-top:8px;line-height:1.45"><strong>Årsag:</strong> ${reason}</div><div style="margin-top:10px;font-weight:800">Mailen er ikke sendt.</div></div>`;
      if(button&&pdfSendState==='idle'){button.disabled=true;button.textContent='Blokeret – ingen opfølgning'}
      return;
    }
    field.hidden=true;box.innerHTML='';
    if(button&&pdfSendState==='idle'){button.disabled=false;button.textContent='Send mail'}
  }

  async function checkSuppressionStatus(force=false){
    const o=offer(),to=String(byId('offerMailTo')?.value||'').trim();
    if(!o?.id||typeof callProtectedEdge!=='function'||!state?.client?.id||!to){
      renderSuppressionStatus({blocked:false});return {blocked:false};
    }
    const key=o.id+'|'+lower(to),cached=suppressionCache.get(key);
    if(!force&&cached&&Date.now()-cached.at<30000){renderSuppressionStatus(cached.value);return cached.value}
    const seq=++suppressionSeq;renderSuppressionStatus({loading:true});
    try{
      const result=await callProtectedEdge('gmail-offer-send',{action:'preflight',client_id:state.client.id,offer_id:o.id,to});
      if(seq!==suppressionSeq||offer()?.id!==o.id)return;
      if(result?.error)throw mailErrorFrom(result);
      const value=result?.data??result;
      suppressionCache.set(key,{at:Date.now(),value});renderSuppressionStatus(value);return value;
    }catch(error){
      if(seq!==suppressionSeq||offer()?.id!==o.id)return;
      console.warn('[Offer mail] Kunne ikke kontrollere ingen-opfølgning-status',error);
      renderSuppressionStatus({blocked:false});return {blocked:false,error};
    }
  }

  function renderPdfStatus(status){
    const box=byId('offerMailAttachment');if(!box)return;
    const o=offer(),expected=pdfName(o);
    if(status?.loading){box.innerHTML=`⏳ Forbereder verificeret PDF for <strong>${expected||'tilbuddet'}</strong>…`;return}
    if(status?.ready){
      const actual=String(status?.attachment?.filename||expected||'Tilbuds-PDF');
      const generated=status?.generated===true||String(status?.attachment?.source||'')==='minuba_live_render';
      const detail=generated
        ?'Den oprindelige fil var ikke tilgængelig via Minuba API/mailkilden, så Lead Manager har dannet PDF’en direkte af de aktuelle tilbudsdata i Minuba. Den valideres igen ved afsendelse.'
        :'Kilden er verificeret. Ved afsendelse kontrolleres PDF’en igen, så der ikke kan vedhæftes en forkert fil.';
      box.innerHTML=`✅ <strong>PDF klar · ${actual}</strong><div class="sub" style="margin-top:4px">${detail}</div>`;
      return;
    }
    if(status?.error){
      box.innerHTML=`⚠️ <strong>PDF kunne ikke kontrolleres</strong><div class="sub" style="margin-top:4px">${String(status.error)}</div>`;return;
    }
    box.innerHTML=`⚠️ <strong>Tilbuds-PDF er ikke klar endnu</strong><div class="sub" style="margin-top:4px">Tilbuddet findes i Minuba. Lead Manager prøver både eksisterende PDF-kilder og en sikker PDF-generering fra Minuba-data. Der sendes aldrig uden en valideret PDF.</div>`;
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
    const suppression=await checkSuppressionStatus(true);
    if(suppression?.blocked){
      alert('MAIL BLOKERET – INGEN OPFØLGNING\n\n'+(suppression.reason||'Denne kunde/modtager må ikke følges op.')+'\n\nMailen er ikke sendt.');
      return;
    }
    if(pdfSendState!=='uncertain'&&!confirm(`Send mailen nu fra ${sender()} til ${to} med ${name} vedhæftet?`))return;
    if(!currentPdfSendId)currentPdfSendId=makeSendId();
    const requestId=currentPdfSendId,button=byId('sendOfferMail'),old='Send mail';
    if(button){button.disabled=true;button.textContent=pdfSendState==='uncertain'?'Kontrollerer status…':'Forbereder PDF og sender…'}
    const attachment=byId('offerMailAttachment');
    if(attachment&&pdfSendState!=='uncertain')attachment.innerHTML=`⏳ Henter eller genererer <strong>${name}</strong> fra Minuba…`;
    try{
      if(typeof callProtectedEdge!=='function')throw new Error('Mailfunktionen er ikke tilgængelig i denne version af Lead Manager.');
      const result=await callProtectedEdge('gmail-offer-send',{
        client_id:state.client.id,offer_id:o.id,lead_id:o.lead_id||null,to,subject,body,
        follow_up_date:follow||null,request_id:requestId
      });
      if(result?.error)throw mailErrorFrom(result);
      const data=result?.data??result;
      if(isSentResult(data)){await finishPdfSend(o,to,data,name,follow);return}
      if(isPostprocessPending(data)&&button)button.textContent='Gemmer opfølgning…';
      if(data?.status==='sending'||data?.status==='prepared'||isPostprocessPending(data)||data?.code==='SEND_IN_PROGRESS'){
        const checked=await pollOfferSendStatus(requestId,5);
        if(checked.state==='sent'){await finishPdfSend(o,to,checked.data,name,follow);return}
        if(checked.state==='failed')throw Object.assign(new Error(checked.error?.message||'Afsendelsen fejlede'),checked.error||{});
        pdfSendState='uncertain';
        alert('Afsendelsen er stadig ved at blive kontrolleret. Lead Manager genbruger samme send-id, så et nyt klik ikke kan sende mailen dobbelt.');
        return;
      }
      if(!data?.ok)throw new Error(data?.error||'Mailen kunne ikke sendes.');
      pdfSendState='uncertain';
      alert('Lead Manager har endnu ikke fået en endelig bekræftelse på afsendelsen og opfølgningsdatoen. Brug “Kontroller status”; samme send-id genbruges, så mailen ikke sendes dobbelt.');
      return;
    }catch(error){
      const status=Number(error?.status||0),raw=String(error?.message||'');
      if(status===546||/^546(?:\s|$)/.test(raw)){
        const checked=await pollOfferSendStatus(requestId,5);
        if(checked.state==='sent'){await finishPdfSend(o,to,checked.data,name,follow);return}
        if(checked.state==='pending'){
          pdfSendState='uncertain';
          alert('Mailtjenesten blev afbrudt, men Lead Manager har låst dette sendeforsøg og kontrollerer status. Brug “Kontroller status” i stedet for at starte en ny afsendelse.');
          return;
        }
        error=Object.assign(new Error(checked.error?.message||raw),checked.error||{});
      }
      ensureAttachmentRow();
      if(String(error?.code||'')==='FOLLOWUP_SUPPRESSED'){
        const reason=String(error?.message||'').replace(/^Opfølgning er blokeret:\s*/i,'').trim();
        renderSuppressionStatus({blocked:true,reason});
        alert('MAIL BLOKERET – INGEN OPFØLGNING\n\n'+(reason||'Denne kunde/modtager må ikke følges op.')+'\n\nMailen er ikke sendt.');
      }else{
        alert('Mailen blev ikke sendt: '+friendlyMailError(error));
      }
      pdfSendState='idle';currentPdfSendId=makeSendId();
    }finally{
      if(button){button.disabled=false;button.textContent=pdfSendState==='uncertain'?'Kontroller status':old}
    }
  }

  function wire(){
    const button=byId('sendOfferMail');if(!button)return;
    ensureAttachmentRow();ensureSuppressionBanner();
    void checkPdfStatus(false);void checkSuppressionStatus(false);
    const to=byId('offerMailTo');
    if(to&&!to.dataset.suppressionBound){
      to.dataset.suppressionBound='1';
      let timer=null;
      const recheck=()=>{clearTimeout(timer);timer=setTimeout(()=>void checkSuppressionStatus(true),250)};
      to.addEventListener('input',recheck);to.addEventListener('change',recheck);
    }
    if(button.dataset.pdfOfferSend==='1')return;
    button.onclick=sendWithPdf;button.dataset.pdfOfferSend='1';
  }

  const schedule=()=>setTimeout(wire,0);
  window.addEventListener('lm:offer-mail-ready',schedule);
  window.addEventListener('lm:offer-mail-opened',()=>{currentPdfSendId=makeSendId();pdfSendState='idle';suppressionBlocked=false;suppressionReason='';const o=offer();if(o?.id){pdfStatusCache.delete(o.id);for(const key of suppressionCache.keys())if(key.startsWith(o.id+'|'))suppressionCache.delete(key)}schedule();setTimeout(()=>{void checkPdfStatus(true);void checkSuppressionStatus(true)},0)});
  window.addEventListener('lm:data-refreshed',schedule);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-offer-mail],#openOfferMail,#sendOfferMail,[data-open-offer]'))schedule()},true);
  setTimeout(wire,100);
})();
