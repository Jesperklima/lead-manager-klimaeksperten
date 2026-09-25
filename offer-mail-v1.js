(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  function setNodeText(id,value){const el=byId(id);if(!el){console.warn('[Offer mail] DOM element mangler:',id);return false}el.textContent=value??'';return true}
  function setNodeValue(id,value){const el=byId(id);if(!el){console.warn('[Offer mail] DOM element mangler:',id);return false}el.value=value??'';return true}
  function composerReady(){const ids=['offerMailMeta','offerMailTo','offerMailContactName','offerMailSubject','offerMailBody','offerMailFollow','offerMailSender','sendOfferMail'];const missing=ids.filter(id=>!byId(id));if(missing.length){console.warn('[Offer mail] Composer mangler elementer:',missing.join(', '));return false}return true}
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const plusDays=days=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+days);return ymd(d)};
  const firstEmail=value=>(String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
  const lower=v=>String(v||'').trim().toLowerCase();
  let minubaContactOptions=[];
  let currentSendId=null;
  let sendState='idle';

  function offer(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function companyContacts(o){try{return typeof contactsFor==='function'?contactsFor(o.company_id):((state?.contacts||[]).filter(x=>x.company_id===o.company_id))}catch{return[]}}
  function bouncedContact(email,o){const e=lower(email);return companyContacts(o).find(x=>lower(x?.email)===e&&String(x?.source_type||'').startsWith('smtp_bounced'))||null}
  function usableContacts(o){return companyContacts(o).filter(x=>x?.email&&!String(x?.source_type||'').startsWith('smtp_bounced'))}
  function recipientFor(o){
    const direct=firstEmail(o?.contact_details);
    if(direct&&!bouncedContact(direct,o))return direct;
    try{
      const contacts=usableContacts(o);
      const best=typeof bestEmailContact==='function'?bestEmailContact(contacts):contacts.find(x=>x.email);
      return String(best?.email||'').trim();
    }catch{return ''}
  }
  function greeting(o){const name=String(o?.contact_person||'').trim();return name?`Hej ${name.split(/\s+/)[0]}`:'Hej'}
  function sender(){try{return String(state?.client?.settings?.mail||'js@klimaeksperten.dk').trim()}catch{return'js@klimaeksperten.dk'}}
  function rawAddressCandidates(raw){
    const out=[],seen=new Set();
    const push=(address,source,baseScore=0)=>{
      if(!address||typeof address!=='object')return;
      const key=String(address.id||'')+'|'+String(address.email||'')+'|'+String(address.att||address.contactName||'')+'|'+source;
      if(seen.has(key))return;seen.add(key);
      const name=String(address.att||address.contactName||address.referencePerson||address.theirref||address.theirRef||'').trim();
      const email=firstEmail(address.email||address.mail||address.emailAddress||'');
      const phone=String(address.cellPhone||address.mobile||address.phone||'').trim();
      const score=baseScore+(name?55:0)+(email?65:0)+(phone?5:0);
      if(name||email||phone)out.push({name,email,phone,source,score,address_id:String(address.id||''),address_type:String(address.addressType||'')});
    };
    push(raw?.deliveryAddress,'offer_delivery_address',120);
    push(raw?.contactAddress,'offer_contact_address',85);
    push(raw?.billingAddress,'offer_billing_address',55);
    for(const a of (Array.isArray(raw?.addresses)?raw.addresses:[])){
      const type=String(a?.addressType||'').toUpperCase();
      push(a,'offer_address',type==='DELIVERY'?100:type==='CONTACT'?75:type==='BILLING'?45:30);
    }
    for(const a of (Array.isArray(raw?.client?.addresses)?raw.client.addresses:[])){
      const type=String(a?.addressType||'').toUpperCase();
      push(a,'client_address',type==='DELIVERY'?70:type==='CONTACT'?60:type==='BILLING'?35:20);
    }
    return out.sort((a,b)=>b.score-a.score);
  }
  function bestRawContact(raw){
    const options=rawAddressCandidates(raw);
    return options.find(x=>x.name&&x.email)||options.find(x=>x.email)||options.find(x=>x.name)||null;
  }
  function alternateEmails(o){
    const raw=o?.minuba_raw||{};
    const values=[
      raw?.deliveryAddress?.email,raw?.contactAddress?.email,raw?.billingAddress?.email,raw?.client?.email,
      ...rawAddressCandidates(raw).map(x=>x.email)
    ].filter(Boolean).join(', ');
    return [...new Set((values.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(x=>x.trim()))];
  }
  function applyRawMinubaContact(o,raw,sourceLabel='Gemt Minuba-tilbud'){
    if(!o||!raw||typeof raw!=='object')return null;
    const best=bestRawContact(raw);if(!best)return null;
    minubaContactOptions=rawAddressCandidates(raw);
    const name=String(best.name||'').trim(),email=String(best.email||'').trim(),phone=String(best.phone||'').trim();
    if(name)o.contact_person=name;
    if(email)o.contact_details=[email,phone].filter(Boolean).join(' · ');
    o.minuba_raw=raw;
    updateComposerFromOffer(o,name&&email?`${sourceLabel}: ${name} · ${email}`:email?`${sourceLabel}: ${email}`:name?`${sourceLabel}: ${name}`:`${sourceLabel}: kontakt fundet`);
    refreshGreeting(o);
    return {name,email,phone,source:best.source};
  }
  async function loadStoredMinubaContact(o){
    if(!o?.id||typeof supabase==='undefined'||!state?.client?.id)return null;
    if(o.minuba_raw&&typeof o.minuba_raw==='object'){
      const local=applyRawMinubaContact(o,o.minuba_raw,'Kontakt fundet i tilbuddet fra Minuba');
      if(local?.name||local?.email)return local;
    }
    try{
      const {data,error}=await supabase.from('crm_offers')
        .select('id,contact_person,contact_details,minuba_raw,minuba_record_type,minuba_order_number,minuba_status,minuba_last_checked_at')
        .eq('client_id',state.client.id).eq('id',o.id).limit(1);
      if(error)throw error;
      const row=Array.isArray(data)?data[0]:data;if(!row)return null;
      for(const key of ['minuba_raw','minuba_record_type','minuba_order_number','minuba_status','minuba_last_checked_at'])if(row[key]!=null)o[key]=row[key];
      if(!o.contact_person&&row.contact_person)o.contact_person=row.contact_person;
      if(!o.contact_details&&row.contact_details)o.contact_details=row.contact_details;
      const local=applyRawMinubaContact(o,row.minuba_raw,'Kontakt fundet i tilbuddet fra Minuba');
      if(!local)updateComposerFromOffer(o);
      return local;
    }catch(error){
      console.warn('[Offer mail] Kunne ikke læse gemte Minuba-kontaktdata',error);
      return null;
    }
  }
  function stripKnownBounced(details,o){
    const email=firstEmail(details);if(!email||!bouncedContact(email,o))return String(details||'').trim();
    return String(details||'').replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),'').replace(/^\s*[·,;|-]+\s*|\s*[·,;|-]+\s*$/g,'').trim();
  }
  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function emitOfferMailLifecycle(name){window.dispatchEvent(new CustomEvent(name,{detail:{offer_id:offer()?.id||null}}))}
  function openOfferMailModal(){const modal=byId('offerMailModal');if(!modal)return;modal.classList.add('open');emitOfferMailLifecycle('lm:offer-mail-opened')}
  function closeOfferMailModal(){const modal=byId('offerMailModal');if(!modal)return;modal.classList.remove('open');emitOfferMailLifecycle('lm:offer-mail-closed')}
  function makeSendId(){return window.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15,v=c==='x'?r:(r&3|8);return v.toString(16)})}
  const sentStatuses=new Set(['sent','sent_pending_postprocess','postprocessing']);
  function isSentResult(data){return !!data?.sent||sentStatuses.has(String(data?.status||''))}
  function mailErrorFrom(result){const e=new Error(result?.error?.message||'Mailafsendelsen fejlede');Object.assign(e,result?.error||{});return e}
  function friendlyMailError(error){
    const status=Number(error?.status||0),code=String(error?.code||''),message=String(error?.message||'');
    if(status===546||/^546(?:\s|$)/.test(message))return 'Mailtjenesten blev afbrudt under afsendelsen. Lead Manager kontrollerer automatisk, om Gmail nåede at sende mailen.';
    if(code==='SEND_INTERRUPTED_NOT_FOUND')return 'Afsendelsen blev afbrudt, og Gmail kunne ikke finde mailen. Du kan prøve at sende igen.';
    if(code==='GMAIL_TOKEN_ERROR'||code==='GMAIL_NOT_CONNECTED')return 'Gmail-forbindelsen skal genetableres, før mailen kan sendes.';
    return message||'Mailen kunne ikke sendes.';
  }
  async function pollSendStatus(requestId,tries=4){
    for(let i=0;i<tries;i++){
      if(i)await new Promise(r=>setTimeout(r,800));
      const check=await callProtectedEdge('gmail-direct-send',{action:'status',client_id:state.client.id,request_id:requestId});
      if(check?.data&&isSentResult(check.data))return {state:'sent',data:check.data};
      if(check?.data?.status==='failed'||check?.error?.code==='SEND_INTERRUPTED_NOT_FOUND')return {state:'failed',error:check.error||check.data};
      if(check?.error&&Number(check.error.status)!==546&&check.error.code!=='SEND_JOB_NOT_FOUND')return {state:'failed',error:check.error};
    }
    return {state:'pending'};
  }
  async function finishSuccessfulSend(o,name,to){
    closeOfferMailModal();
    currentSendId=null;sendState='idle';
    if(window.__LM_PERF?.refreshKeys)await window.__LM_PERF.refreshKeys('offers','mail','activities');
    else if(typeof loadAll==='function')await loadAll({keys:['offers','mail','activities'],force:true});
    if(typeof openOffer==='function')openOffer(o.id);
    if(typeof toast==='function')toast(`Mail sendt til ${name||to}`);
  }

  function ensureModal(){
    if(byId('offerMailModal'))return;
    const modal=document.createElement('div');
    modal.className='modalback';modal.id='offerMailModal';
    modal.innerHTML=`<div class="modal" style="width:min(720px,94vw)">
      <h2 style="margin-top:0">Send mail om tilbud</h2>
      <div id="offerMailMeta" class="sub"></div>
      <div id="offerMailContactSource" class="sub" style="margin-top:6px"></div>
      <div class="field hidden" id="offerMailContactChoiceField"><label>Kontakt fra Minuba</label><select id="offerMailContactChoice"></select><div class="sub" style="margin-top:5px">Navn og mail hentes fra tilbuddet/kundekortet i Minuba. Vælg den rette kontakt hvis Minuba har flere.</div></div>
      <div class="field"><label>Kontaktperson</label><input id="offerMailContactName" placeholder="Navn på kontaktperson" autocomplete="name"><div class="sub" id="offerMailContactNameNote" style="margin-top:5px"></div></div>
      <div class="field"><label>Til</label><input id="offerMailTo" type="email" placeholder="kunde@firma.dk" autocomplete="email"><div class="sub" id="offerMailRecipientNote" style="margin-top:5px"></div></div>
      <div class="field"><label>Emne</label><input id="offerMailSubject"></div>
      <div class="field"><label>Mailtekst</label><textarea id="offerMailBody" rows="10"></textarea></div>
      <div class="field"><label>Næste opfølgning</label><input id="offerMailFollow" type="date"><div class="sub" style="margin-top:5px">Datoen opdaterer tilbuddet og tilbudspipelinen efter afsendelse.</div></div>
      <div id="offerMailSender" class="sub" style="margin-top:10px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="cancelOfferMail">Annuller</button><button class="btn primary" id="sendOfferMail">Send mail</button></div>
    </div>`;
    document.body.appendChild(modal);
    byId('cancelOfferMail').onclick=closeOfferMailModal;
    modal.addEventListener('click',event=>{if(event.target===modal)closeOfferMailModal()});
    byId('sendOfferMail').onclick=sendMail;
    byId('offerMailContactChoice').onchange=()=>applySelectedMinubaContact();
    byId('offerMailContactName').addEventListener('input',()=>syncContactName(true));
    emitOfferMailLifecycle('lm:offer-mail-ready');
  }

  function ensureButton(){
    const save=byId('saveOffer');
    if(!save||byId('openOfferMail'))return;
    const button=document.createElement('button');
    button.type='button';button.className='btn';button.id='openOfferMail';button.textContent='✉ Send mail';
    save.parentElement?.insertBefore(button,save);button.onclick=openMail;
  }

  function refreshGreeting(o){
    const body=byId('offerMailBody');if(!body)return;
    const text=String(body.value||'');
    const lines=text.split('\n');
    if(lines.length&&/^Hej(?:\s+[^,\n]+)?\s*,?$/i.test(lines[0].trim())){lines[0]=greeting(o);body.value=lines.join('\n')}
  }
  function syncContactName(refreshBody=false){
    const o=offer();if(!o)return;
    o.contact_person=String(byId('offerMailContactName')?.value||'').trim();
    if(refreshBody)refreshGreeting(o);
    document.dispatchEvent(new CustomEvent('lm:offer-contact-updated',{detail:{offer_id:o.id,contact_person:o.contact_person||'',contact_details:o.contact_details||''}}));
  }
  function renderContactChoices(o){
    const field=byId('offerMailContactChoiceField'),select=byId('offerMailContactChoice');if(!field||!select)return;
    const options=(minubaContactOptions||[]).filter(x=>x?.email&&!bouncedContact(x.email,o));
    if(options.length<2){field.classList.add('hidden');select.innerHTML='';return}
    select.innerHTML='<option value="">Vælg kontakt…</option>'+options.map((x,i)=>`<option value="${i}">${esc([x.name,x.email,x.phone].filter(Boolean).join(' · '))}</option>`).join('');
    const currentEmail=lower(byId('offerMailTo')?.value),currentName=lower(byId('offerMailContactName')?.value);
    const idx=options.findIndex(x=>lower(x.email)===currentEmail&&(!currentName||!x.name||lower(x.name)===currentName));
    if(idx>=0)select.value=String(idx);
    field.classList.remove('hidden');
  }
  function applySelectedMinubaContact(){
    const o=offer(),select=byId('offerMailContactChoice');if(!o||!select||select.value==='')return;
    const options=(minubaContactOptions||[]).filter(x=>x?.email&&!bouncedContact(x.email,o));
    const selected=options[Number(select.value)];if(!selected)return;
    const name=String(selected.name||'').trim(),email=String(selected.email||'').trim(),phone=String(selected.phone||'').trim();
    o.contact_person=name;o.contact_details=[email,phone].filter(Boolean).join(' · ');
    setNodeValue('offerMailContactName',name);setNodeValue('offerMailTo',email);
    setNodeText('offerMailContactNameNote',name?'Navnet er hentet fra Minuba.':'Minuba har mailadressen, men ikke et navn på denne kontakt.');
    setNodeText('offerMailRecipientNote','Mailadressen er hentet fra Minuba.');
    refreshGreeting(o);
    const selectedTemplate=byId('offerTemplateSelect');if(selectedTemplate?.value)selectedTemplate.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function updateComposerFromOffer(o,contactSource=''){
    const direct=firstEmail(o?.contact_details),blocked=direct?bouncedContact(direct,o):null,to=recipientFor(o);
    setNodeValue('offerMailTo',to);
    setNodeValue('offerMailContactName',String(o?.contact_person||'').trim());
    const alternatives=alternateEmails(o).filter(x=>lower(x)!==lower(direct));
    if(byId('offerMailContactSource')){
      if(blocked)byId('offerMailContactSource').textContent=`${direct} er markeret ugyldig efter mailserveren svarede "Account disabled".${alternatives.length?' Andre adresser i Minuba: '+alternatives.join(', '):''}`;
      else byId('offerMailContactSource').textContent=contactSource||(o.contact_person?`Kontaktperson: ${o.contact_person}`:'Kontaktperson mangler i Lead Manager. Minuba kontrolleres automatisk.');
    }
    setNodeText('offerMailContactNameNote',o.contact_person?'Kontaktperson hentet fra tilbuddet/kunden.':'Navnet udfyldes automatisk, hvis det findes på tilbuddet eller kundekortet i Minuba.');
    setNodeText('offerMailRecipientNote',to?'Modtageren er hentet fra kundens/tilbuddets kontaktoplysninger.':'Ingen sikker modtager er valgt automatisk. Vælg eller skriv en anden mailadresse.');
    renderContactChoices(o);
    document.dispatchEvent(new CustomEvent('lm:offer-contact-updated',{detail:{offer_id:o.id,contact_person:o.contact_person||'',contact_details:o.contact_details||''}}));
    const selectedTemplate=byId('offerTemplateSelect');if(selectedTemplate?.value)selectedTemplate.dispatchEvent(new Event('change',{bubbles:true}));
  }

  async function enrichFromMinuba(o){
    const ref=String(o?.offer_ref||'').trim();
    if(!ref||!state?.client?.id)return;
    await loadStoredMinubaContact(o);
    if(typeof callProtectedEdge!=='function')return;
    if(byId('offerMailContactSource'))byId('offerMailContactSource').textContent=`Kontrollerer de aktuelle kontaktoplysninger i Minuba på tilbud ${ref}…`;
    try{
      const response=await callProtectedEdge('minuba-offer-lookup',{client_id:state.client.id,offer_ref:ref});
      if(response?.error)throw new Error(response.error.message||String(response.error));
      const data=response?.data??response;
      if(!data?.found){if(byId('offerMailContactSource'))byId('offerMailContactSource').textContent=o.contact_person?`Kontaktperson: ${o.contact_person}`:`Ingen kontaktinformation fundet i Minuba på tilbud ${ref}.`;return}
      const rawContact=applyRawMinubaContact(o,data.raw||o.minuba_raw||{},'Kontakt fundet direkte på Minuba-tilbuddet');
      const apiOptions=Array.isArray(data.contact_options)?data.contact_options:[];
      minubaContactOptions=[...rawAddressCandidates(data.raw||o.minuba_raw||{}),...apiOptions].filter((x,i,a)=>x?.email&&a.findIndex(y=>lower(y?.email)===lower(x?.email)&&lower(y?.name)===lower(x?.name))===i);
      const person=String(data.contact_person||rawContact?.name||'').trim(),email=String(data.contact_email||rawContact?.email||'').trim(),phone=String(data.contact_phone||rawContact?.phone||'').trim();
      if(person)o.contact_person=person;
      o.minuba_raw=data.raw||o.minuba_raw||{};o.minuba_record_type=data.record_type||o.minuba_record_type||null;o.minuba_order_number=data.order_number||o.minuba_order_number||null;o.minuba_status=data.status_raw||o.minuba_status||null;o.minuba_last_checked_at=new Date().toISOString();
      const incomingDetails=String(data.contact_details||[email,phone].filter(Boolean).join(' · ')).trim(),cleanDetails=stripKnownBounced(incomingDetails,o);if(cleanDetails)o.contact_details=cleanDetails;
      const patch={contact_person:o.contact_person||null,contact_details:o.contact_details||null,minuba_raw:o.minuba_raw,minuba_record_type:o.minuba_record_type,minuba_order_number:o.minuba_order_number,minuba_status:o.minuba_status,minuba_last_checked_at:o.minuba_last_checked_at,updated_at:new Date().toISOString()};
      if(typeof supabase!=='undefined'){const {error}=await supabase.from('crm_offers').update(patch).eq('id',o.id);if(error)console.warn('Kunne ikke gemme Minuba-kontakt på tilbud',error)}
      let source='Minuba fandt tilbuddet';
      if(person&&email)source=`Navn og mail hentet fra Minuba: ${person} · ${email}`;
      else if(email)source=`Mail hentet fra Minuba: ${email}. Der er ikke angivet et navn på kontakten.`;
      else if(person)source=`Kontaktperson hentet fra Minuba: ${person}. Der er ikke angivet en mailadresse.`;
      else source='Minuba fandt tilbuddet, men ingen navngiven kontakt var angivet.';
      updateComposerFromOffer(o,source);
      refreshGreeting(o);
    }catch(error){console.warn('Minuba kontaktopslag fejlede',error);if(byId('offerMailContactSource'))byId('offerMailContactSource').textContent=o.contact_person?`Kontaktperson: ${o.contact_person}`:'Minuba kunne ikke hente kontaktoplysningerne lige nu.'}
  }

  function openMail(){
    ensureModal();const o=offer();if(!o){if(typeof toast==='function')toast('Åbn et tilbud først');return}if(!composerReady()){if(typeof toast==='function')toast('Mailvinduet kunne ikke indlæses. Genindlæs siden.');return}
    minubaContactOptions=[];currentSendId=makeSendId();sendState='idle';
    const to=recipientFor(o),ref=String(o.offer_ref||'').trim();
    setNodeText('offerMailMeta',[`Tilbud ${ref}`,o.customer_name||'',o.installation_address||''].filter(Boolean).join(' · '));
    setNodeValue('offerMailTo',to);setNodeValue('offerMailContactName',String(o.contact_person||''));setNodeValue('offerMailSubject',`Opfølgning på tilbud ${ref}`);setNodeValue('offerMailBody',`${greeting(o)}\n\nJeg vil blot følge op på tilbud ${ref}.\n\nHar I haft mulighed for at kigge på det, og er der noget, jeg skal uddybe?\n\nSer frem til at høre fra jer.`);setNodeValue('offerMailFollow',byId('oFollow')?.value||o.follow_up_date||plusDays(7));setNodeText('offerMailSender',`Afsender: ${sender()} · din mailsignatur tilføjes automatisk.`);
    updateComposerFromOffer(o);openOfferMailModal();enrichFromMinuba(o);setTimeout(()=>{(to?byId('offerMailSubject'):byId('offerMailTo'))?.focus()},0);
  }

  async function sendMail(){
    const o=offer();if(!o)return;
    syncContactName(false);
    const name=String(byId('offerMailContactName')?.value||'').trim(),to=String(byId('offerMailTo')?.value||'').trim(),subject=String(byId('offerMailSubject')?.value||'').trim(),body=String(byId('offerMailBody')?.value||'').trim(),follow=String(byId('offerMailFollow')?.value||'').trim();
    if(!to||!subject||!body){if(typeof toast==='function')toast('Udfyld modtager, emne og mailtekst');return}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){if(typeof toast==='function')toast('Mailadressen er ikke gyldig');return}
    if(bouncedContact(to,o)){alert(`${to} er markeret som ugyldig efter en permanent mailfejl (Account disabled). Vælg en anden adresse.`);return}
    o.contact_person=name;o.contact_details=to;
    if(typeof supabase!=='undefined')await supabase.from('crm_offers').update({contact_person:name||null,contact_details:to,updated_at:new Date().toISOString()}).eq('id',o.id);
    if(sendState!=='uncertain'&&!confirm(`Send mailen nu fra ${sender()} til ${name?name+' · ':''}${to}?`))return;
    if(!currentSendId)currentSendId=makeSendId();
    const requestId=currentSendId,button=byId('sendOfferMail');
    if(!button){console.warn('[Offer mail] Send-knap mangler efter render');return}
    const old='Send mail';button.disabled=true;button.textContent=sendState==='uncertain'?'Kontrollerer…':'Sender…';
    try{
      if(typeof callProtectedEdge!=='function')throw new Error('Mailfunktionen er ikke tilgængelig i denne version af Lead Manager.');
      const result=await callProtectedEdge('gmail-direct-send',{
        client_id:state.client.id,offer_id:o.id,lead_id:o.lead_id||null,to,subject,body,
        follow_up_date:follow||null,ai_generated:false,ai_model:null,request_id:requestId
      });
      if(result?.error)throw mailErrorFrom(result);
      if(isSentResult(result?.data)){await finishSuccessfulSend(o,name,to);return}
      if(result?.data?.status==='sending'||result?.data?.code==='SEND_IN_PROGRESS'){
        const checked=await pollSendStatus(requestId,5);
        if(checked.state==='sent'){await finishSuccessfulSend(o,name,to);return}
        if(checked.state==='failed')throw Object.assign(new Error(checked.error?.message||'Afsendelsen fejlede'),checked.error||{});
        sendState='uncertain';
        alert('Afsendelsen er stadig ved at blive kontrolleret. Lead Manager genbruger samme send-id, så et nyt klik kan ikke sende mailen dobbelt.');
        return;
      }
      throw new Error('Gmail returnerede ingen sikker afsendelsesstatus.');
    }catch(error){
      const status=Number(error?.status||0),raw=String(error?.message||'');
      if(status===546||/^546(?:\s|$)/.test(raw)){
        const checked=await pollSendStatus(requestId,5);
        if(checked.state==='sent'){await finishSuccessfulSend(o,name,to);return}
        if(checked.state==='pending'){
          sendState='uncertain';
          alert('Mailtjenesten blev afbrudt, men Lead Manager har låst dette sendeforsøg og kontrollerer status. Brug “Kontroller status” i stedet for at oprette en ny afsendelse.');
          return;
        }
        error=Object.assign(new Error(checked.error?.message||raw),checked.error||{});
      }
      sendState='idle';currentSendId=makeSendId();
      alert('Mailen blev ikke sendt: '+friendlyMailError(error));
    }finally{
      button.disabled=false;
      button.textContent=sendState==='uncertain'?'Kontroller status':old;
    }
  }

  function scheduleButton(){setTimeout(ensureButton,0)}
  ensureModal();ensureButton();
  window.addEventListener('lm:client-data-ready',scheduleButton);
  window.addEventListener('lm:data-refreshed',scheduleButton);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-open-offer],#openOfferMail,#offerMailModal,.nav button[data-view="offers"],.nav button[data-view="offerpipeline"]'))scheduleButton()},true);
})();