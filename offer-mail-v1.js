(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const plusDays=days=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+days);return ymd(d)};
  const firstEmail=value=>(String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
  const lower=v=>String(v||'').trim().toLowerCase();
  let minubaContactOptions=[];

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
  function alternateEmails(o){
    const raw=o?.minuba_raw||{};
    const values=[raw?.contactAddress?.email,raw?.billingAddress?.email,raw?.client?.email].filter(Boolean).join(', ');
    return [...new Set((values.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(x=>x.trim()))];
  }
  function stripKnownBounced(details,o){
    const email=firstEmail(details);if(!email||!bouncedContact(email,o))return String(details||'').trim();
    return String(details||'').replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),'').replace(/^\s*[·,;|-]+\s*|\s*[·,;|-]+\s*$/g,'').trim();
  }
  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

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
    byId('cancelOfferMail').onclick=()=>modal.classList.remove('open');
    modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.remove('open')});
    byId('sendOfferMail').onclick=sendMail;
    byId('offerMailContactChoice').onchange=()=>applySelectedMinubaContact();
    byId('offerMailContactName').addEventListener('input',()=>syncContactName(true));
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
    byId('offerMailContactName').value=name;byId('offerMailTo').value=email;
    byId('offerMailContactNameNote').textContent=name?'Navnet er hentet fra Minuba.':'Minuba har mailadressen, men ikke et navn på denne kontakt.';
    byId('offerMailRecipientNote').textContent='Mailadressen er hentet fra Minuba.';
    refreshGreeting(o);
    const selectedTemplate=byId('offerTemplateSelect');if(selectedTemplate?.value)selectedTemplate.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function updateComposerFromOffer(o,contactSource=''){
    const direct=firstEmail(o?.contact_details),blocked=direct?bouncedContact(direct,o):null,to=recipientFor(o);
    byId('offerMailTo').value=to;
    byId('offerMailContactName').value=String(o?.contact_person||'').trim();
    const alternatives=alternateEmails(o).filter(x=>lower(x)!==lower(direct));
    if(byId('offerMailContactSource')){
      if(blocked)byId('offerMailContactSource').textContent=`${direct} er markeret ugyldig efter mailserveren svarede "Account disabled".${alternatives.length?' Andre adresser i Minuba: '+alternatives.join(', '):''}`;
      else byId('offerMailContactSource').textContent=contactSource||(o.contact_person?`Kontaktperson: ${o.contact_person}`:'Kontaktperson mangler i Lead Manager. Minuba kontrolleres automatisk.');
    }
    byId('offerMailContactNameNote').textContent=o.contact_person?'Kontaktperson hentet fra tilbuddet/kunden.':'Navnet udfyldes automatisk, hvis det findes på tilbuddet eller kundekortet i Minuba.';
    byId('offerMailRecipientNote').textContent=to?'Modtageren er hentet fra kundens/tilbuddets kontaktoplysninger.':'Ingen sikker modtager er valgt automatisk. Vælg eller skriv en anden mailadresse.';
    renderContactChoices(o);
    document.dispatchEvent(new CustomEvent('lm:offer-contact-updated',{detail:{offer_id:o.id,contact_person:o.contact_person||'',contact_details:o.contact_details||''}}));
    const selectedTemplate=byId('offerTemplateSelect');if(selectedTemplate?.value)selectedTemplate.dispatchEvent(new Event('change',{bubbles:true}));
  }

  async function enrichFromMinuba(o){
    const ref=String(o?.offer_ref||'').trim();
    if(!ref||typeof callProtectedEdge!=='function'||!state?.client?.id)return;
    if(byId('offerMailContactSource'))byId('offerMailContactSource').textContent=`Henter navn og mail fra Minuba på tilbud ${ref}…`;
    try{
      const response=await callProtectedEdge('minuba-offer-lookup',{client_id:state.client.id,offer_ref:ref});
      if(response?.error)throw new Error(response.error.message||String(response.error));
      const data=response?.data??response;
      if(!data?.found){if(byId('offerMailContactSource'))byId('offerMailContactSource').textContent=o.contact_person?`Kontaktperson: ${o.contact_person}`:`Ingen kontaktinformation fundet i Minuba på tilbud ${ref}.`;return}
      minubaContactOptions=Array.isArray(data.contact_options)?data.contact_options:[];
      const person=String(data.contact_person||'').trim(),email=String(data.contact_email||'').trim(),phone=String(data.contact_phone||'').trim();
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
    ensureModal();const o=offer();if(!o){if(typeof toast==='function')toast('Åbn et tilbud først');return}
    minubaContactOptions=[];
    const to=recipientFor(o),ref=String(o.offer_ref||'').trim();
    byId('offerMailMeta').textContent=[`Tilbud ${ref}`,o.customer_name||'',o.installation_address||''].filter(Boolean).join(' · ');
    byId('offerMailTo').value=to;byId('offerMailContactName').value=String(o.contact_person||'');byId('offerMailSubject').value=`Opfølgning på tilbud ${ref}`;byId('offerMailBody').value=`${greeting(o)}\n\nJeg vil blot følge op på tilbud ${ref}.\n\nHar I haft mulighed for at kigge på det, og er der noget, jeg skal uddybe?\n\nSer frem til at høre fra jer.`;byId('offerMailFollow').value=byId('oFollow')?.value||o.follow_up_date||plusDays(7);byId('offerMailSender').textContent=`Afsender: ${sender()} · din mailsignatur tilføjes automatisk.`;
    updateComposerFromOffer(o);byId('offerMailModal').classList.add('open');enrichFromMinuba(o);setTimeout(()=>{(to?byId('offerMailSubject'):byId('offerMailTo'))?.focus()},0);
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
    if(!confirm(`Send mailen nu fra ${sender()} til ${name?name+' · ':''}${to}?`))return;
    const button=byId('sendOfferMail'),old=button.textContent;button.disabled=true;button.textContent='Sender…';
    try{
      if(typeof callProtectedEdge!=='function')throw new Error('Mailfunktionen er ikke tilgængelig i denne version af Lead Manager.');
      const result=await callProtectedEdge('gmail-direct-send',{client_id:state.client.id,offer_id:o.id,lead_id:o.lead_id||null,to,subject,body,follow_up_date:follow||null,ai_generated:false,ai_model:null});
      if(result?.error)throw new Error(result.error.message||String(result.error));
      byId('offerMailModal').classList.remove('open');if(typeof loadAll==='function')await loadAll();if(typeof openOffer==='function')openOffer(o.id);if(typeof toast==='function')toast(`Mail sendt til ${name||to}`);
    }catch(error){alert('Mailen blev ikke sendt: '+(error?.message||String(error)))}finally{button.disabled=false;button.textContent=old}
  }

  const observer=new MutationObserver(()=>ensureButton());observer.observe(document.documentElement,{subtree:true,childList:true});document.addEventListener('click',()=>setTimeout(ensureButton,0),true);ensureModal();ensureButton();
})();