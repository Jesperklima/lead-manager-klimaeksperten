(()=>{
  'use strict';
  const text=v=>String(v??'').trim();
  const client=()=>{try{return typeof state!=='undefined'?state?.client:null}catch{return null}};
  const session=()=>{try{return typeof state!=='undefined'?state?.session:null}catch{return null}};
  const plan=()=>window.__LM_SAAS_PLAN||null;
  const external=()=>!!plan()&&plan().plan_code!=='internal';
  const mail=()=>text(client()?.settings?.mail)||text(session()?.user?.email)||'din forbundne mailkonto';
  const owner=()=>text(client()?.settings?.contact_name)||text(session()?.user?.email)||'Kundeejer';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function patchBrand(){
    const c=client(),p=plan(),brand=document.querySelector('.brand');
    if(!c||!p||!brand)return;
    if(p.plan_code==='internal'){
      brand.innerHTML='<span class="lm-leaf"></span><span>Klimaeksperten<small>Lead Manager</small></span>';
      document.title='Lead Manager – Klimaeksperten';
    }else{
      const name=text(c.name)||'Lead Manager';
      brand.innerHTML=`<span class="lm-leaf"></span><span>${esc(name)}<small>Lead Manager</small></span>`;
      document.title=`Lead Manager – ${name}`;
    }
  }

  function replaceVisibleText(){
    if(!plan())return;
    const wantedMail=mail();
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const nodes=[];let n;
    while((n=walker.nextNode()))nodes.push(n);
    for(const node of nodes){
      const v=node.nodeValue||'';
      let next=v.replaceAll('din forbundne mailkonto',wantedMail);
      if(external()) next=next.replaceAll('js@klimaeksperten.dk',wantedMail).replaceAll('Klimaeksperten · Pilot',text(client()?.name)||'Kundekonto');
      if(next!==v)node.nodeValue=next;
    }
  }

  function patchGenericContactPriority(){
    if(!external()||typeof window.contactUseScore!=='function'||window.contactUseScore.__saasGeneric)return;
    const fn=function(x){
      let s=0;
      const role=String([x?.full_name,x?.title,x?.role_relevance].filter(Boolean).join(' ')).toLowerCase();
      const local=String(x?.email||'').toLowerCase().split('@')[0];
      if(x?.is_decision_maker)s+=120;
      if(x?.verified)s+=30;
      if(x?.full_name&&!/generel kontakt|general contact/i.test(x.full_name))s+=20;
      if(/owner|ejer|founder|partner|director|direktør|head|chef|manager|leder|ansvarlig|decision|procurement|indkøb|operations|drift/i.test(role))s+=60;
      if(/^(booking|book|reservation|reservations|reception|receptionen|restaurant|job|jobs|career|careers|hr|event|events|conference|meeting|meetings|wedding|spa|takeaway|order|orders)$/i.test(local))s-=160;
      else if(/^(info|mail|kontakt|contact|office|admin|hello)$/i.test(local))s-=35;
      if(x?.email)s+=10;
      return s;
    };
    fn.__saasGeneric=true;
    window.contactUseScore=fn;
  }

  function patchNoContact(){
    if(!external())return;
    const b=document.getElementById('requestNoContactMail');
    if(!b||b.dataset.saasGeneric==='1')return;
    b.dataset.saasGeneric='1';
    b.onclick=async()=>{
      try{
        if(typeof currentLead==='undefined'||!currentLead)return;
        const profile=client()?.settings?.capability_profile||{};
        const services=Array.isArray(profile.lead_trigger_capabilities)?profile.lead_trigger_capabilities:[];
        const segments=Array.isArray(profile.documented_segments)?profile.documented_segments:[];
        const context=[services.length?'Ydelser: '+services.join(', '):'',segments.length?'Målgrupper: '+segments.join(', '):''].filter(Boolean).join('. ');
        const prompt='Lav et kort no-contact mailudkast med primært mål at finde den rette beslutningstager hos virksomheden for denne kundes egne ydelser og målgrupper. '+context+'. Brug ikke Klimaeksperten-specifikke roller eller brancher. Send ikke uden godkendelse.';
        if(typeof queueAgentRequest==='function'&&await queueAgentRequest('draft_no_contact_mail',prompt)){
          if(typeof loadAll==='function')await loadAll();
          if(typeof toast==='function')toast('No-contact mail sendt til agentkø');
        }
      }catch(e){console.warn('generic no-contact',e)}
    };
  }

  function patchAssignmentsInInputs(){
    if(!external())return;
    document.querySelectorAll('[data-assigned-to],[data-owner-name]').forEach(el=>{
      if(el.dataset.assignedTo==='Jesper'||el.dataset.assignedTo==='JS')el.dataset.assignedTo=owner();
      if(el.dataset.ownerName==='Jesper')el.dataset.ownerName=owner();
    });
  }

  function apply(){
    if(!client()||!plan())return;
    patchBrand();
    replaceVisibleText();
    patchGenericContactPriority();
    patchNoContact();
    patchAssignmentsInInputs();
  }
  new MutationObserver(()=>setTimeout(apply,0)).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  document.addEventListener('click',()=>setTimeout(apply,0),true);
  setInterval(apply,500);
  setTimeout(apply,100);
})();
