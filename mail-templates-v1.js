(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  let templates=[];
  let loadedForClient='';
  let editingId=null;

  function currentClientId(){try{return String(state?.client?.id||'')}catch{return''}}
  function currentUser(){try{return String(state?.user?.email||state?.session?.user?.email||'')}catch{return''}}
  function currentLeadValue(){try{return typeof currentLead!=='undefined'?currentLead:null}catch{return null}}
  function currentOfferValue(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function contactsForCompany(companyId){try{return typeof contactsFor==='function'?contactsFor(companyId):(state?.contacts||[]).filter(x=>x.company_id===companyId)}catch{return[]}}
  function bestContact(companyId){
    const arr=contactsForCompany(companyId);
    try{if(typeof bestEmailContact==='function')return bestEmailContact(arr)||arr[0]||null}catch{}
    return arr.find(x=>x?.email)||arr[0]||null;
  }
  function firstName(value){return String(value||'').trim().split(/\s+/)[0]||''}
  function firstEmail(value){return (String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||''}
  const personalMailDomains=new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.dk','outlook.com','outlook.dk','live.com','live.dk','msn.com','icloud.com','me.com','mac.com','yahoo.com','yahoo.dk','proton.me','protonmail.com','mail.dk','ofir.dk','gmx.com','gmx.de']);
  function looksLikePersonName(value){
    const name=String(value||'').trim().replace(/\s+/g,' ');
    if(!name||name.length>100||/[@\d]/.test(name)||/[,&/+]/.test(name))return '';
    if(name===name.toUpperCase())return '';
    if(/\b(?:aps|a\/s|i\/s|ivs|p\/s|amba|holding|kommune|region|service|services|vvs|køl|klima|byg|entreprise|ejendom|ejendomme|hotel|restaurant|skole|center|fonden|forening|group|consult|consulting|solution|solutions|system|systems|bank|forsikring|transport|teknik|auto)\b/i.test(name))return '';
    const parts=name.split(/\s+/).filter(Boolean);
    if(parts.length<2||parts.length>5)return '';
    if(parts.some(part=>!/^[A-Za-zÆØÅæøåÀ-ÖØ-öø-ÿ'’.-]+$/u.test(part)))return '';
    return name;
  }
  function isPersonalMailbox(value){
    const email=firstEmail(value).toLowerCase(),at=email.lastIndexOf('@');
    return at>0&&personalMailDomains.has(email.slice(at+1));
  }
  function offerContactName(offer,c){
    const direct=String(offer?.contact_person||c?.full_name||'').trim();if(direct)return direct;
    const email=firstEmail(offer?.contact_details)||String(c?.email||'').trim();
    return isPersonalMailbox(email)?looksLikePersonName(offer?.customer_name):'';
  }
  function companyName(companyId){try{return company(companyId)?.name||''}catch{return''}}

  function context(scope){
    const lead=currentLeadValue(),offer=currentOfferValue();
    if(scope==='offer'&&offer){
      const c=bestContact(offer.company_id),contactName=offerContactName(offer,c);
      return {
        contact:{first_name:firstName(contactName),full_name:contactName,email:firstEmail(offer.contact_details)||String(c?.email||'')},
        company:{name:String(offer.customer_name||companyName(offer.company_id)||'')},
        offer:{number:String(offer.offer_ref||'')},
        order:{number:String(offer.offer_ref||'')},
        lead:{status:String(lead?.status||'')}
      };
    }
    const c=lead?bestContact(lead.company_id):null,contactName=String(c?.full_name||'').trim();
    return {
      contact:{first_name:firstName(contactName),full_name:contactName,email:String(c?.email||'')},
      company:{name:String(lead?companyName(lead.company_id):'')},
      offer:{number:''},order:{number:''},lead:{status:String(lead?.status||'')}
    };
  }

  function resolve(text,scope){
    const ctx=context(scope);
    return String(text||'').replace(/{{\s*([\w.]+)\s*}}/g,(_,path)=>{
      const value=path.split('.').reduce((obj,key)=>obj&&obj[key],ctx);
      return value==null?'':String(value);
    });
  }

  async function loadTemplates(force=false){
    const clientId=currentClientId();if(!clientId||typeof supabase==='undefined')return [];
    if(!force&&loadedForClient===clientId)return templates;
    const {data,error}=await supabase.from('crm_mail_templates').select('*').eq('client_id',clientId).eq('is_active',true).order('name');
    if(error){console.warn('mail templates',error);return templates}
    templates=data||[];loadedForClient=clientId;refreshSelectors();return templates;
  }

  function options(scope){
    return templates.filter(t=>t.scope===scope||t.scope==='both').map(t=>`<option value="${String(t.id).replaceAll('"','&quot;')}">${String(t.name||'Skabelon').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}</option>`).join('');
  }

  function refreshSelectors(){
    [['leadTemplateSelect','lead'],['offerTemplateSelect','offer']].forEach(([id,scope])=>{
      const el=byId(id);if(!el)return;
      const value=el.value;
      el.innerHTML='<option value="">Vælg mail-skabelon…</option>'+options(scope);
      if([...el.options].some(o=>o.value===value))el.value=value;
    });
  }

  function applyTemplate(scope,id){
    const t=templates.find(x=>x.id===id);if(!t)return;
    if(scope==='offer'){
      if(byId('offerMailSubject'))byId('offerMailSubject').value=resolve(t.subject,scope);
      if(byId('offerMailBody'))byId('offerMailBody').value=resolve(t.body_text,scope);
    }else{
      if(byId('mSubject'))byId('mSubject').value=resolve(t.subject,scope);
      if(byId('mBody'))byId('mBody').value=resolve(t.body_text,scope);
    }
  }

  function ensureComposerControls(){
    const leadSubject=byId('mSubject');
    if(leadSubject&&!byId('leadTemplateSelect')){
      const field=leadSubject.closest('.field');
      const wrap=document.createElement('div');wrap.className='field';
      wrap.innerHTML='<label>Mail-skabelon</label><div class="split"><select id="leadTemplateSelect" style="min-width:220px;flex:1"></select><button type="button" class="btn small" id="manageLeadTemplates">Administrér skabeloner</button></div>';
      field?.insertAdjacentElement('beforebegin',wrap);
      byId('leadTemplateSelect').onchange=e=>applyTemplate('lead',e.target.value);
      byId('manageLeadTemplates').onclick=()=>openManager('lead');
    }
    const offerSubject=byId('offerMailSubject');
    if(offerSubject&&!byId('offerTemplateSelect')){
      const field=offerSubject.closest('.field');
      const wrap=document.createElement('div');wrap.className='field';
      wrap.innerHTML='<label>Mail-skabelon</label><div class="split"><select id="offerTemplateSelect" style="min-width:220px;flex:1"></select><button type="button" class="btn small" id="manageOfferTemplates">Administrér skabeloner</button></div>';
      field?.insertAdjacentElement('beforebegin',wrap);
      byId('offerTemplateSelect').onchange=e=>applyTemplate('offer',e.target.value);
      byId('manageOfferTemplates').onclick=()=>openManager('offer');
    }
    refreshSelectors();
  }

  function ensureManagerStyle(){
    if(byId('lmMailTemplateManagerStyle'))return;
    const style=document.createElement('style');style.id='lmMailTemplateManagerStyle';style.textContent=`
      #mailTemplateManager{inset:0!important;margin:0!important;padding:18px!important;border:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;background:transparent!important}
      #mailTemplateManager::backdrop{background:rgba(2,10,16,.72)!important}
      #mailTemplateManager .modal{background:#0b1f2a!important;color:#e8f1f5!important;border:1px solid #1f3a47!important;box-shadow:0 24px 60px rgba(0,0,0,.45)!important}
      #mailTemplateManager .card{background:#102a36!important;color:#e8f1f5!important;border-color:#274553!important}
      #mailTemplateManager input,#mailTemplateManager select,#mailTemplateManager textarea{background:#203543!important;color:#e8f1f5!important;border:1px solid #2c4a5a!important}
      #mailTemplateManager input::placeholder,#mailTemplateManager textarea::placeholder{color:#88a2b0!important}
      #mailTemplateManager .sub{color:#a9bfcb!important}
      #mailTemplateManager .task{border-color:#274553!important}
      #mailTemplateManager .mailbody{color:#cfe0e8!important}
      #mailTemplateManager .btn:not(.primary){background:#17303c!important;color:#e8f1f5!important;border-color:#2b4655!important}
      #mailTemplateManager .btn.primary{background:#4de0b0!important;color:#06261d!important;border-color:#4de0b0!important}
      #mailTemplateManager .pill{background:#17303c!important;color:#e8f1f5!important;border-color:#2b4655!important}
      @media(max-width:760px){#mailTemplateManager .grid2{grid-template-columns:1fr!important}}
    `;document.head.appendChild(style);
  }

  function ensureManager(){
    if(byId('mailTemplateManager'))return;
    ensureManagerStyle();
    const modal=document.createElement('dialog');modal.className='modalback lm-native-dialog';modal.id='mailTemplateManager';
    modal.innerHTML=`<form method="dialog" id="mailTemplateManagerCloseForm"></form><div class="modal" style="width:min(900px,95vw)">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><h2 style="margin:0">Mail-skabeloner</h2><div class="sub">Opret faste mails til leads og tilbud. Vælg evt. én som standard.</div></div><button type="submit" form="mailTemplateManagerCloseForm" class="btn" id="closeMailTemplateManager" value="close">Luk</button></div>
      <div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(300px,.8fr);margin-top:14px">
        <div class="card"><div id="mailTemplateList"></div></div>
        <div class="card">
          <h3 id="mailTemplateFormTitle" style="margin-top:0">Ny skabelon</h3>
          <div class="field"><label>Navn på skabelon</label><input id="mailTemplateName" placeholder="Fx Opfølgning efter samtale"></div>
          <div class="field"><label>Bruges til</label><select id="mailTemplateScope"><option value="lead">Leads</option><option value="offer">Tilbud</option><option value="both">Begge</option></select></div>
          <div class="field"><label>Emne</label><input id="mailTemplateSubject" placeholder="Fx Opfølgning til {{company.name}}"></div>
          <div class="field"><label>Mailtekst</label><textarea id="mailTemplateBody" rows="10" placeholder="Skriv den faste mailtekst her..."></textarea></div>
          <div class="sub" style="margin-bottom:10px">Dynamiske felter: {{contact.first_name}}, {{contact.full_name}}, {{company.name}}, {{offer.number}} og {{order.number}}. Signaturen tilføjes automatisk og skal ikke skrives i skabelonen.</div>
          <label class="pill" style="margin-bottom:10px"><input type="checkbox" id="mailTemplateDefault"> Brug automatisk som standard for denne type</label>
          <div class="split"><button type="button" class="btn" id="newMailTemplate">Ny skabelon</button><button type="button" class="btn primary" id="saveMailTemplate">Gem skabelon</button><button type="button" class="btn danger hidden" id="deleteMailTemplate">Slet</button></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    byId('newMailTemplate').onclick=()=>resetForm();
    byId('saveMailTemplate').onclick=saveTemplate;
    byId('deleteMailTemplate').onclick=deleteTemplate;
    modal.addEventListener('close',()=>{editingId=null});
  }

  function renderList(){
    const box=byId('mailTemplateList');if(!box)return;
    const scope=byId('mailTemplateScope')?.dataset?.managerScope||'';
    const arr=templates.filter(t=>!scope||t.scope===scope||t.scope==='both');
    box.innerHTML=arr.length?arr.map(t=>`<div class="task"><div><strong>${String(t.name||'')}</strong><div class="sub">${t.scope==='offer'?'Tilbud':t.scope==='lead'?'Leads':'Leads + tilbud'}${t.is_default?' · Standard':''}</div><div class="mailbody">${String(t.body_text||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}</div></div><button class="btn small" data-edit-template="${t.id}">Redigér</button></div>`).join(''):'<div class="empty">Ingen skabeloner endnu.</div>';
    box.querySelectorAll('[data-edit-template]').forEach(b=>b.onclick=()=>editTemplate(b.dataset.editTemplate));
  }

  function resetForm(scope){
    editingId=null;byId('mailTemplateFormTitle').textContent='Ny skabelon';byId('mailTemplateName').value='';byId('mailTemplateSubject').value='';byId('mailTemplateBody').value='';byId('mailTemplateDefault').checked=false;byId('deleteMailTemplate').classList.add('hidden');
    if(scope)byId('mailTemplateScope').value=scope;
  }

  function editTemplate(id){
    const t=templates.find(x=>x.id===id);if(!t)return;editingId=id;byId('mailTemplateFormTitle').textContent='Redigér skabelon';byId('mailTemplateName').value=t.name||'';byId('mailTemplateScope').value=t.scope||'both';byId('mailTemplateSubject').value=t.subject||'';byId('mailTemplateBody').value=t.body_text||'';byId('mailTemplateDefault').checked=!!t.is_default;byId('deleteMailTemplate').classList.remove('hidden');
  }

  async function openManager(scope){
    ensureManager();await loadTemplates(true);byId('mailTemplateScope').dataset.managerScope=scope;resetForm(scope);renderList();
    const modal=byId('mailTemplateManager');
    try{if(modal&&!modal.open)modal.showModal()}catch(e){console.error('Kunne ikke åbne mail-skabeloner',e);if(typeof toast==='function')toast('Skabelonvinduet kunne ikke åbnes')}
  }

  async function saveTemplate(){
    const clientId=currentClientId(),name=String(byId('mailTemplateName').value||'').trim(),scope=byId('mailTemplateScope').value,subject=String(byId('mailTemplateSubject').value||'').trim(),body=String(byId('mailTemplateBody').value||'').trim(),isDefault=byId('mailTemplateDefault').checked;
    if(!name||!body){if(typeof toast==='function')toast('Skriv navn og mailtekst');return}
    if(isDefault){
      await supabase.from('crm_mail_templates').update({is_default:false}).eq('client_id',clientId).eq('scope',scope);
      if(scope!=='both')await supabase.from('crm_mail_templates').update({is_default:false}).eq('client_id',clientId).eq('scope','both');
    }
    const payload={client_id:clientId,name,scope,subject,body_text:body,is_active:true,is_default:isDefault,updated_at:new Date().toISOString(),created_by:currentUser()||null};
    const result=editingId?await supabase.from('crm_mail_templates').update(payload).eq('id',editingId):await supabase.from('crm_mail_templates').insert(payload);
    if(result.error){alert('Skabelonen kunne ikke gemmes: '+result.error.message);return}
    await loadTemplates(true);renderList();refreshSelectors();resetForm(scope);if(typeof toast==='function')toast('Mail-skabelon gemt');
  }

  async function deleteTemplate(){
    if(!editingId||!confirm('Slet denne mail-skabelon?'))return;
    const {error}=await supabase.from('crm_mail_templates').update({is_active:false,updated_at:new Date().toISOString()}).eq('id',editingId);if(error){alert('Skabelonen kunne ikke deaktiveres: '+error.message);return}
    await loadTemplates(true);renderList();refreshSelectors();resetForm();if(typeof toast==='function')toast('Mail-skabelon fjernet');
  }

  async function applyDefaultWhenOpened(){
    await loadTemplates();
    if(byId('offerMailModal')?.classList.contains('open')&&byId('offerTemplateSelect')){
      const t=templates.find(x=>x.is_default&&(x.scope==='offer'||x.scope==='both'));
      if(t&&!byId('offerTemplateSelect').dataset.defaultApplied){byId('offerTemplateSelect').dataset.defaultApplied='1';byId('offerTemplateSelect').value=t.id;applyTemplate('offer',t.id)}
    }else if(byId('offerTemplateSelect'))byId('offerTemplateSelect').dataset.defaultApplied='';
    if(byId('mailModal')?.classList.contains('open')&&byId('leadTemplateSelect')){
      const t=templates.find(x=>x.is_default&&(x.scope==='lead'||x.scope==='both'));
      if(t&&!byId('leadTemplateSelect').dataset.defaultApplied){byId('leadTemplateSelect').dataset.defaultApplied='1';byId('leadTemplateSelect').value=t.id;applyTemplate('lead',t.id)}
    }else if(byId('leadTemplateSelect'))byId('leadTemplateSelect').dataset.defaultApplied='';
  }

  function watch(){ensureComposerControls();ensureManager();applyDefaultWhenOpened()}
  const schedule=()=>setTimeout(watch,0);
  window.addEventListener('lm:client-data-ready',schedule);
  window.addEventListener('lm:data-refreshed',schedule);
  window.addEventListener('lm:mail-opened',schedule);
  window.addEventListener('lm:offer-mail-ready',schedule);
  window.addEventListener('lm:offer-mail-opened',schedule);
  document.addEventListener('click',e=>{if(e.target.closest?.('#openMailComposer,#openOfferMail,.nav button[data-view="mail"],.nav button[data-view="offers"],.nav button[data-view="offerpipeline"]'))schedule()},true);
  setTimeout(watch,300);
})();