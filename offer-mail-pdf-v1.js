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
  let sendWatchSeq=0;
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
    box.innerHTML=`<div style="border:2px solid ${palette.border};border-radius:12px;padding:14px 16px;background:${palette.bg};color:${palette.fg}"><div style="font-size:16px;font-weight:900">${palette.icon} ${title}</div>${detail?`<div style="margin-top:6px;line-height:1.45">${detail}</div>`:''}</div>`;
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
      if(check?.data?.status==='failed'||check?.error?.code==='SEND_INTERRUPTED_NOT_FOUND')return {state:'failed',error:check.error||check.data};
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
      renderSendStatus('checking','Mailen er sendt – gemmer opfølgningen','Lead Manager kontrollerer automatisk opfølgningsdatoen. Du skal ikke sende mailen igen.');
      return false;
    }
    clearPendingSend(o,currentPdfSendId);
    renderSendStatus('success','Mail sendt','Afsendelsen er bekræftet, og opfølgningsdatoen er gemt.');
    byId('offerMailModal')?.classList.remove('open');
    window.dispatchEvent(new CustomEvent('lm:offer-mail-closed',{detail:{offer_id:o.id}}));
    currentPdfSendId=null;pdfSendState='idle';
    if(typeof openOffer==='function')openOffer(o.id);
    if(typeof toast==='function')toast(`Mail sendt til ${to} med ${data?.attachment?.filename||name} · opfølgning gemt`);
    return true;
  }

  async function resumePendingOfferSend(saved=null){
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
        pending={request_id:data.send_id,created_at:Date.now(),to:to||'',follow:String(byId('offerMailFollow')?.value||''),name:pdfName(o)};
        savePendingSend(o,data.send_id,pending);
        if(isSentResult(data)){
          currentPdfSendId=data.send_id;
          pdfSendState='uncertain';
          const done=await finishPdfSend(o,pending.to||to,data,pending.name||pdfName(o),pending.follow||String(byId('offerMailFollow')?.value||''));
          return done||true;
        }
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
    if(checked.state==='failed'){
      clearPendingSend(o,currentPdfSendId);
      pdfSendState='idle';
      currentPdfSendId=makeSendId();
      const message=friendlyMailError(checked.error||{});
      renderSendStatus('error','Mailen blev ikke sendt',message+' Du kan rette eventuelle fejl og prøve igen.');
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
    if(pdfSendState!=='idle')return;
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
    savePendingSend(o,requestId,{to,subject,follow,name,created_at:Date.now()});
    renderSendStatus('checking','Forbereder og sender','Lead Manager bruger et unikt send-id og kontrollerer automatisk resultatet, hvis forbindelsen bliver afbrudt.');
    if(button){button.disabled=true;button.textContent='Forbereder PDF og sender…'}
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
        pdfSendState='uncertain';
        await resumePendingOfferSend(loadPendingSend(o));
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
        renderSendStatus('checking','Forbindelsen blev afbrudt','Lead Manager kontrollerer nu automatisk, om Gmail nåede at sende mailen. Du skal ikke gøre noget.');
        await resumePendingOfferSend(loadPendingSend(o));
        return;
      }
      ensureAttachmentRow();
      if(String(error?.code||'')==='FOLLOWUP_SUPPRESSED'){
        const reason=String(error?.message||'').replace(/^Opfølgning er blokeret:\s*/i,'').trim();
        renderSuppressionStatus({blocked:true,reason});
        alert('MAIL BLOKERET – INGEN OPFØLGNING\n\n'+(reason||'Denne kunde/modtager må ikke følges op.')+'\n\nMailen er ikke sendt.');
      }else{
        renderSendStatus('error','Mailen blev ikke sendt',friendlyMailError(error));
        if(typeof toast==='function')toast('Mailen blev ikke sendt');
      }
      clearPendingSend(o,requestId);
      pdfSendState='idle';currentPdfSendId=makeSendId();
    }finally{
      if(button){
        const waiting=pdfSendState!=='idle';
        button.disabled=waiting||suppressionBlocked;
        button.textContent=waiting?'Kontrollerer automatisk…':(suppressionBlocked?'Blokeret – ingen opfølgning':old);
      }
    }
  }

  function wire(){
    const button=byId('sendOfferMail');if(!button)return;
    ensureAttachmentRow();ensureSuppressionBanner();ensureSendStatusBanner();
    if(pdfSendState!=='idle'){button.disabled=true;button.textContent='Kontrollerer afsendelse…'}
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
  window.addEventListener('lm:offer-mail-opened',()=>{currentPdfSendId=null;pdfSendState='checking';suppressionBlocked=false;suppressionReason='';sendWatchSeq++;const o=offer();if(o?.id){pdfStatusCache.delete(o.id);for(const key of suppressionCache.keys())if(key.startsWith(o.id+'|'))suppressionCache.delete(key)}schedule();setTimeout(async()=>{void checkPdfStatus(true);void checkSuppressionStatus(true);const resumed=await resumePendingOfferSend();if(!resumed&&offer()?.id===o?.id){pdfSendState='idle';currentPdfSendId=makeSendId();renderSendStatus();wire()}},0)});
  window.addEventListener('lm:data-refreshed',schedule);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-offer-mail],#openOfferMail,#sendOfferMail,[data-open-offer]'))schedule()},true);
  setTimeout(wire,100);
})();
