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
  function companyName(companyId){try{return company(companyId)?.name||''}catch{return''}}

  function context(scope){
    const lead=currentLeadValue(),offer=currentOfferValue();
    if(scope==='offer'&&offer){
      const c=bestContact(offer.company_id),contactName=String(offer.contact_person||c?.full_name||'').trim();
      return {
        contact:{first_name:firstName(contactName),full_name:contactName,email:String(c?.email||'')},
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

  function ensureManager(){
    if(byId('mailTemplateManager'))return;
    const modal=document.createElement('div');modal.className='modalback';modal.id='mailTemplateManager';
    modal.innerHTML=`<div class="modal" style="width:min(900px,95vw)">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><h2 style="margin:0">Mail-skabeloner</h2><div class="sub">Gem faste mails til leads og tilbud. Felter som kontaktperson og tilbudsnummer udfyldes automatisk.</div></div><button class="btn" id="closeMailTemplateManager">Luk</button></div>
      <div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(300px,.8fr);margin-top:14px">
        <div class="card"><div id="mailTemplateList"></div></div>
        <div class="card">
          <h3 id="mailTemplateFormTitle" style="margin-top:0">Ny skabelon</h3>
          <div class="field"><label>Navn på skabelon</label><input id="mailTemplateName" placeholder="Fx Gensend tilbud"></div>
          <div class="field"><label>Bruges til</label><select id="mailTemplateScope"><option value="lead">Leads</option><option value="offer">Tilbud</option><option value="both">Begge</option></select></div>
          <div class="field"><label>Emne</label><input id="mailTemplateSubject" placeholder="Fx Tilbud {{offer.number}}"></div>
          <div class="field"><label>Mailtekst</label><textarea id="mailTemplateBody" rows="10"></textarea></div>
          <div class="sub" style="margin-bottom:10px">Du kan bruge: {{contact.first_name}}, {{contact.full_name}}, {{company.name}}, {{offer.number}} og {{order.number}}.</div>
          <label class="pill" style="margin-bottom:10px"><input type="checkbox" id="mailTemplateDefault"> Standard for denne type</label>
          <div class="split"><button class="btn" id="newMailTemplate">Ny</button><button class="btn primary" id="saveMailTemplate">Gem skabelon</button><button class="btn danger hidden" id="deleteMailTemplate">Slet</button></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    byId('closeMailTemplateManager').onclick=()=>modal.classList.remove('open');
    byId('newMailTemplate').onclick=()=>resetForm();
    byId('saveMailTemplate').onclick=saveTemplate;
    byId('deleteMailTemplate').onclick=deleteTemplate;
    modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});
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
    ensureManager();await loadTemplates(true);byId('mailTemplateScope').dataset.managerScope=scope;resetForm(scope);renderList();byId('mailTemplateManager').classList.add('open');
  }

  async function saveTemplate(){
    const clientId=currentClientId(),name=String(byId('mailTemplateName').value||'').trim(),scope=byId('mailTemplateScope').value,subject=String(byId('mailTemplateSubject').value||'').trim(),body=String(byId('mailTemplateBody').value||'').trim(),isDefault=byId('mailTemplateDefault').checked;
    if(!name||!body){if(typeof toast==='function')toast('Skriv navn og mailtekst');return}
    if(isDefault){await supabase.from('crm_mail_templates').update({is_default:false}).eq('client_id',clientId).in('scope',[scope,'both'])}
    const payload={client_id:clientId,name,scope,subject,body_text:body,is_active:true,is_default:isDefault,updated_at:new Date().toISOString(),created_by:currentUser()||null};
    const result=editingId?await supabase.from('crm_mail_templates').update(payload).eq('id',editingId):await supabase.from('crm_mail_templates').insert(payload);
    if(result.error){alert('Skabelonen kunne ikke gemmes: '+result.error.message);return}
    await loadTemplates(true);renderList();refreshSelectors();resetForm(scope);if(typeof toast==='function')toast('Mail-skabelon gemt');
  }

  async function deleteTemplate(){
    if(!editingId||!confirm('Slet denne mail-skabelon?'))return;
    const {error}=await supabase.from('crm_mail_templates').delete().eq('id',editingId);if(error){alert('Skabelonen kunne ikke slettes: '+error.message);return}
    await loadTemplates(true);renderList();refreshSelectors();resetForm();if(typeof toast==='function')toast('Mail-skabelon slettet');
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
  new MutationObserver(()=>setTimeout(watch,20)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('click',()=>setTimeout(watch,20),true);
  setInterval(watch,800);
  setTimeout(watch,300);
})();