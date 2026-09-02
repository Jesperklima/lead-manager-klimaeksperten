(()=>{
  'use strict';

  const approvalSafe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const approvalPick=(payload,keys)=>{
    for(const key of keys){
      const value=payload?.[key];
      if(value!==undefined&&value!==null&&value!=='')return value;
    }
    return null;
  };
  const approvalText=value=>{
    if(value===undefined||value===null||value==='')return '';
    if(typeof value==='object')return String(value.offer_ref||value.ref||value.id||value.name||'');
    return String(value);
  };
  const approvalActionLabel=type=>({
    send_email:'Mail klar til gennemsyn',
    offer_mail_update:'Opdatér tilbud ud fra mail',
    offer_update:'Opdatér tilbud',
    lead_update:'Opdatér lead',
    create_lead:'Opret lead',
    create_offer:'Opret tilbud'
  }[type]||String(type||'Handling').replaceAll('_',' '));

  function approvalSubject(payload){
    const direct=approvalPick(payload,['mail_subject','source_subject','email_subject']);
    if(direct)return approvalText(direct);
    const comment=approvalText(payload?.comment);
    const match=comment.match(/(?:^|\s)Mail:\s*([^\n\r]+)/i);
    return match?.[1]?.trim()||'';
  }

  function approvalMailMatch(item){
    if(typeof state==='undefined')return null;
    const payload=item?.payload||{};
    const messages=state.mail||[];
    const identifiers=[
      approvalPick(payload,['mail_id','crm_mail_id','source_mail_id']),
      approvalPick(payload,['message_id','external_message_id','gmail_message_id','microsoft_message_id'])
    ].filter(Boolean).map(String);
    if(identifiers.length){
      const exact=messages.find(message=>[
        message.id,message.message_id,message.external_id,message.provider_message_id,message.gmail_message_id,message.microsoft_message_id
      ].filter(Boolean).map(String).some(value=>identifiers.includes(value)));
      if(exact)return exact;
    }
    const subject=approvalSubject(payload).toLowerCase();
    const from=approvalText(approvalPick(payload,['from','from_email','sender'])).toLowerCase();
    if(!subject&&!from)return null;
    const candidates=messages.filter(message=>{
      const messageSubject=String(message.subject||'').toLowerCase();
      const messageFrom=String(message.from_email||'').toLowerCase();
      const subjectMatch=subject&&(messageSubject===subject||messageSubject.includes(subject)||subject.includes(messageSubject));
      const fromMatch=from&&messageFrom===from;
      return subject&&from?subjectMatch&&fromMatch:subject?subjectMatch:false;
    });
    if(!candidates.length)return null;
    const createdAt=new Date(item.created_at||0).getTime();
    return candidates.sort((a,b)=>Math.abs(new Date(a.message_at||0).getTime()-createdAt)-Math.abs(new Date(b.message_at||0).getTime()-createdAt))[0];
  }

  function approvalOfferMatch(item){
    if(typeof state==='undefined')return null;
    const payload=item?.payload||{};
    const raw=approvalPick(payload,['offer_id','offer_ref','offer_number','offer']);
    const object=typeof raw==='object'&&raw?raw:null;
    const id=approvalText(object?.id||approvalPick(payload,['offer_id']));
    const ref=approvalText(object?.offer_ref||object?.ref||approvalPick(payload,['offer_ref','offer_number'])||(typeof raw==='string'||typeof raw==='number'?raw:''));
    return (state.offers||[]).find(offer=>(id&&String(offer.id)===id)||(ref&&String(offer.offer_ref||'')===ref))||null;
  }

  function approvalRow(label,value,wide=false){
    if(value===undefined||value===null||value==='')return '';
    return `<div class="approval-detail${wide?' approval-detail-wide':''}"><span>${approvalSafe(label)}</span><strong>${approvalSafe(value)}</strong></div>`;
  }

  function approvalSourceUrl(payload,mail){
    const url=approvalPick(payload,['source_url','web_link','mail_url','message_url'])||mail?.web_link||mail?.source_url||mail?.web_url;
    if(!url)return '';
    try{
      const parsed=new URL(String(url),location.origin);
      if(!['http:','https:'].includes(parsed.protocol))return '';
      return parsed.href;
    }catch{return '';}
  }

  function approvalProposal(item,mail,offer){
    const payload=item.payload||{};
    if(item.action_type==='send_email')return 'Mailen sendes først, når du godkender den.';
    if(item.action_type==='offer_mail_update'){
      const parts=[];
      const status=approvalText(approvalPick(payload,['status','new_status','offer_status']));
      const follow=approvalText(approvalPick(payload,['follow_up_date','next_follow_up','followup_date','scheduled_at']));
      if(offer)parts.push(`Tilbud ${offer.offer_ref||''} opdateres`);
      else parts.push('Et tilbud foreslås opdateret');
      if(status)parts.push(`status: ${status}`);
      if(follow)parts.push(`opfølgning: ${follow}`);
      return parts.join(' · ')+'.';
    }
    return 'Gennemgå oplysningerne herunder før du godkender handlingen.';
  }

  function renderApprovalCard(item){
    const payload=item.payload||{};
    const cid=payload.company_id||(typeof leadById==='function'?leadById(item.lead_id)?.company_id:null);
    const mail=approvalMailMatch(item);
    const offer=approvalOfferMatch(item);
    const subject=mail?.subject||approvalSubject(payload);
    const from=mail?.from_email||approvalText(approvalPick(payload,['from','from_email','sender']));
    const owner=approvalText(approvalPick(payload,['owner','owner_email','assigned_to']));
    const status=approvalText(approvalPick(payload,['status','new_status','offer_status']));
    const follow=approvalText(approvalPick(payload,['follow_up_date','next_follow_up','followup_date','scheduled_at']));
    const reason=approvalText(approvalPick(payload,['reason','explanation']));
    const comment=approvalText(payload.comment);
    const sourceUrl=approvalSourceUrl(payload,mail);
    const companyName=typeof company==='function'?company(cid).name||'':'';
    const offerLabel=offer?`Tilbud ${offer.offer_ref||''}${offer.customer_name?` · ${offer.customer_name}`:''}`:approvalText(approvalPick(payload,['offer_ref','offer_number','offer']));
    const mailPreview=mail?.body_text?String(mail.body_text).trim().slice(0,420):'';
    const canEdit=item.action_type==='send_email';
    const technical=JSON.stringify(payload,null,2);

    if(item.action_type==='send_email'){
      const sig=typeof clientMailSignature==='function'?clientMailSignature():'';
      return `<article class="approval-card"><div class="approval-card-main"><div class="approval-head"><div><div class="approval-type">${approvalSafe(approvalActionLabel(item.action_type))}</div><div class="approval-meta">${approvalSafe(companyName)}${companyName?' · ':''}${approvalSafe(typeof fmt==='function'?fmt(item.created_at):item.created_at||'')}${item.edited_at?` · redigeret ${approvalSafe(typeof fmt==='function'?fmt(item.edited_at):item.edited_at)}`:''}</div></div></div><div class="approval-proposal">${approvalSafe(approvalProposal(item,mail,offer))}</div><div class="approval-mail-subject">${approvalSafe(payload.subject||'Uden emne')}</div><div class="approval-meta">Til: ${approvalSafe(payload.to||'')}</div><div class="approval-mail-preview">${approvalSafe(payload.body||'')}</div>${sig?`<div class="approval-meta" style="margin-top:9px">Signatur tilføjes automatisk:</div><div class="approval-mail-preview">${approvalSafe(sig)}</div>`:''}<details class="approval-technical"><summary>Tekniske detaljer</summary><pre>${approvalSafe(technical)}</pre></details></div><div class="approval-actions">${canEdit?`<button class="btn small" data-edit-approval="${approvalSafe(item.id)}">Redigér</button>`:''}<button class="btn small primary" data-approve="${approvalSafe(item.id)}">Godkend</button><button class="btn small danger" data-reject="${approvalSafe(item.id)}">Afvis</button></div></article>`;
    }

    return `<article class="approval-card"><div class="approval-card-main"><div class="approval-head"><div><div class="approval-type">${approvalSafe(approvalActionLabel(item.action_type))}</div><div class="approval-meta">${approvalSafe(companyName||'Ikke koblet til virksomhed')} · ${approvalSafe(typeof fmt==='function'?fmt(item.created_at):item.created_at||'')}</div></div>${item.action_type==='offer_mail_update'&&!offer?'<span class="approval-warning-badge">Tilbud ikke identificeret</span>':''}</div><div class="approval-proposal"><strong>Foreslået handling:</strong> ${approvalSafe(approvalProposal(item,mail,offer))}</div><div class="approval-details">${approvalRow('Mail',subject)}${approvalRow('Fra',from)}${approvalRow('Tilbud',offerLabel||'Ikke identificeret')}${approvalRow('Ny status',status)}${approvalRow('Opfølgning',follow||(/7 dage/i.test(reason)?'Standard: 7 dage':''))}${approvalRow('Ansvarlig',owner)}${approvalRow('Begrundelse',reason,true)}${approvalRow('Kommentar',comment,true)}</div>${mailPreview?`<div class="approval-source-preview"><div class="approval-source-title">Uddrag af kildemail</div>${approvalSafe(mailPreview)}${String(mail?.body_text||'').length>420?'…':''}</div>`:''}<div class="approval-links">${mail?`<button class="btn small" data-approval-mail="${approvalSafe(mail.id)}">Vis kildemail</button>`:subject||from?`<button class="btn small" data-approval-mail-search="${approvalSafe(subject||from)}">Find mail</button>`:''}${offer?`<button class="btn small" data-approval-offer="${approvalSafe(offer.id)}">Åbn tilbud</button>`:''}${item.lead_id?`<button class="btn small" data-approval-lead="${approvalSafe(item.lead_id)}">Åbn lead</button>`:''}${sourceUrl?`<a class="btn small" href="${approvalSafe(sourceUrl)}" target="_blank" rel="noopener noreferrer">Åbn original</a>`:''}</div>${item.action_type==='offer_mail_update'&&!offer?'<div class="approval-warning">Systemet har ikke knyttet forslaget til et konkret tilbud. Brug oplysningerne ovenfor og kildemailen til at kontrollere sagen, før du godkender.</div>':''}<details class="approval-technical"><summary>Tekniske detaljer</summary><pre>${approvalSafe(technical)}</pre></details></div><div class="approval-actions"><button class="btn small primary" data-approve="${approvalSafe(item.id)}">Godkend</button><button class="btn small danger" data-reject="${approvalSafe(item.id)}">Afvis</button></div></article>`;
  }

  function enhancedRenderApprovals(){
    if(typeof state==='undefined')return;
    const target=document.getElementById('approvalFeed');
    if(!target)return;
    const pending=(state.approvals||[]).filter(item=>item.status==='pending');
    target.innerHTML=pending.length?pending.map(renderApprovalCard).join(''):'<div class="oknotice">Ingen handlinger venter på godkendelse.</div>';
    if(typeof wireApprovalButtons==='function')wireApprovalButtons();
  }

  function ensureApprovalModal(){
    let back=document.getElementById('approvalSourceModal');
    if(back)return back;
    back=document.createElement('div');
    back.id='approvalSourceModal';
    back.className='modalback';
    back.innerHTML='<div class="modal approval-source-modal"><div class="drawer-head"><div><strong id="approvalSourceSubject">Kildemail</strong><div class="sub" id="approvalSourceMeta"></div></div><button class="btn" type="button" data-close-approval-source>Luk</button></div><div class="approval-source-body" id="approvalSourceBody"></div></div>';
    document.body.appendChild(back);
    back.addEventListener('click',event=>{if(event.target===back||event.target.closest('[data-close-approval-source]'))back.classList.remove('open')});
    return back;
  }

  function showApprovalMail(id){
    const mail=(typeof state!=='undefined'?state.mail||[]:[]).find(message=>String(message.id)===String(id));
    if(!mail)return;
    const back=ensureApprovalModal();
    document.getElementById('approvalSourceSubject').textContent=mail.subject||'(uden emne)';
    document.getElementById('approvalSourceMeta').textContent=`Fra: ${mail.from_email||''} · Til: ${mail.to_email||''} · ${typeof fmt==='function'?fmt(mail.message_at):mail.message_at||''}`;
    document.getElementById('approvalSourceBody').textContent=mail.body_text||'';
    back.classList.add('open');
  }

  function findApprovalMail(query){
    const nav=document.querySelector('.nav button[data-view="mail"]');
    nav?.click();
    setTimeout(()=>{
      const input=document.getElementById('mailSearch');
      if(!input)return;
      input.value=query||'';
      if(typeof renderMail==='function')renderMail();
      input.focus();
    },0);
  }

  function installApprovalStyles(){
    if(document.getElementById('approval-center-v2-styles'))return;
    const style=document.createElement('style');
    style.id='approval-center-v2-styles';
    style.textContent=`
      #approvalFeed{display:grid;gap:12px}.approval-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:18px;border:1px solid var(--border);border-radius:13px;background:#fff;box-shadow:0 4px 16px rgba(16,40,59,.045)}
      .approval-card-main{min-width:0}.approval-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.approval-type{font-weight:850;font-size:1rem;color:var(--executive-navy,#10283b)}.approval-meta{font-size:.78rem;color:var(--muted);margin-top:3px}.approval-proposal{margin-top:12px;padding:11px 12px;border-radius:9px;background:#f4f7fa;color:#334155;font-size:.86rem;line-height:1.45}.approval-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.approval-detail{padding:10px 11px;border:1px solid #e5eaee;border-radius:9px;background:#fbfcfd;min-width:0}.approval-detail-wide{grid-column:1/-1}.approval-detail span{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.055em;color:#7a8792;font-weight:800;margin-bottom:4px}.approval-detail strong{display:block;font-size:.84rem;line-height:1.4;color:#243541;overflow-wrap:anywhere}.approval-actions{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;justify-content:flex-end}.approval-links{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.approval-warning-badge{display:inline-flex;padding:5px 8px;border-radius:999px;background:#fff3cd;color:#7a5400;font-size:.7rem;font-weight:800;white-space:nowrap}.approval-warning{margin-top:12px;padding:10px 12px;border:1px solid #f0cf7d;border-radius:9px;background:#fff8e7;color:#6f4a00;font-size:.8rem;line-height:1.45}.approval-source-preview{margin-top:12px;padding:12px;border-left:3px solid #7395c8;background:#f7f9fc;border-radius:0 9px 9px 0;white-space:pre-wrap;font-size:.8rem;line-height:1.45;color:#475569;max-height:145px;overflow:hidden}.approval-source-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.055em;font-weight:850;color:#65788b;margin-bottom:6px}.approval-technical{margin-top:12px;font-size:.75rem;color:#6b7781}.approval-technical summary{cursor:pointer}.approval-technical pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:#f6f8fa;border-radius:8px;border:1px solid #e5eaee}.approval-mail-subject{font-weight:800;margin-top:12px}.approval-mail-preview{white-space:pre-wrap;max-height:180px;overflow:auto;color:#475569;font-size:.82rem;margin-top:6px}.approval-source-modal{width:min(780px,94vw)}.approval-source-body{white-space:pre-wrap;margin-top:16px;padding:14px;border:1px solid var(--border);border-radius:9px;background:#fbfcfd;line-height:1.5;max-height:62vh;overflow:auto}
      @media(max-width:900px){.approval-card{grid-template-columns:1fr}.approval-actions{justify-content:flex-start}.approval-details{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:620px){.approval-details{grid-template-columns:1fr}.approval-detail-wide{grid-column:auto}.approval-head{flex-direction:column}.approval-card{padding:14px}}
    `;
    document.head.appendChild(style);
  }

  installApprovalStyles();
  try{window.renderApprovals=enhancedRenderApprovals;}catch(error){console.warn('Kunne ikke opgradere godkendelsescenteret',error);}
  document.addEventListener('click',event=>{
    const mailButton=event.target.closest('[data-approval-mail]');
    if(mailButton){showApprovalMail(mailButton.dataset.approvalMail);return;}
    const searchButton=event.target.closest('[data-approval-mail-search]');
    if(searchButton){findApprovalMail(searchButton.dataset.approvalMailSearch);return;}
    const offerButton=event.target.closest('[data-approval-offer]');
    if(offerButton&&typeof openOffer==='function'){openOffer(offerButton.dataset.approvalOffer);return;}
    const leadButton=event.target.closest('[data-approval-lead]');
    if(leadButton&&typeof openLead==='function'){openLead(leadButton.dataset.approvalLead);return;}
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(enhancedRenderApprovals,0));
  else setTimeout(enhancedRenderApprovals,0);
})();
