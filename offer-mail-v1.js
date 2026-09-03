(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const plusDays=days=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+days);return ymd(d)};
  const firstEmail=value=>(String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';

  function offer(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function recipientFor(o){
    const direct=firstEmail(o?.contact_details);if(direct)return direct;
    try{
      const contacts=typeof contactsFor==='function'?contactsFor(o.company_id):((state?.contacts||[]).filter(x=>x.company_id===o.company_id));
      const best=typeof bestEmailContact==='function'?bestEmailContact(contacts):contacts.find(x=>x.email);
      return String(best?.email||'').trim();
    }catch{return ''}
  }
  function greeting(o){
    const name=String(o?.contact_person||'').trim();
    return name?`Hej ${name.split(/\s+/)[0]}`:'Til rette vedkomme';
  }
  function sender(){
    try{return String(state?.client?.settings?.mail||'js@klimaeksperten.dk').trim()}catch{return'js@klimaeksperten.dk'}
  }

  function ensureModal(){
    if(byId('offerMailModal'))return;
    const modal=document.createElement('div');
    modal.className='modalback';modal.id='offerMailModal';
    modal.innerHTML=`<div class="modal" style="width:min(720px,94vw)">
      <h2 style="margin-top:0">Send mail om tilbud</h2>
      <div id="offerMailMeta" class="sub"></div>
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
  }

  function ensureButton(){
    const save=byId('saveOffer');
    if(!save||byId('openOfferMail'))return;
    const button=document.createElement('button');
    button.type='button';button.className='btn';button.id='openOfferMail';button.textContent='✉ Send mail';
    save.parentElement?.insertBefore(button,save);
    button.onclick=openMail;
  }

  function openMail(){
    ensureModal();
    const o=offer();
    if(!o){if(typeof toast==='function')toast('Åbn et tilbud først');return}
    const to=recipientFor(o),ref=String(o.offer_ref||'').trim();
    byId('offerMailMeta').textContent=[`Tilbud ${ref}`,o.customer_name||'',o.installation_address||''].filter(Boolean).join(' · ');
    byId('offerMailTo').value=to;
    byId('offerMailSubject').value=`Opfølgning på tilbud ${ref}`;
    byId('offerMailBody').value=`${greeting(o)}\n\nJeg vil blot følge op på tilbud ${ref}.\n\nHar I haft mulighed for at kigge på det, og er der noget, jeg skal uddybe?\n\nSer frem til at høre fra jer.`;
    byId('offerMailFollow').value=byId('oFollow')?.value||o.follow_up_date||plusDays(7);
    byId('offerMailSender').textContent=`Afsender: ${sender()} · din mailsignatur tilføjes automatisk.`;
    byId('offerMailRecipientNote').textContent=to?'Modtageren er hentet fra kundens/tilbuddets kontaktoplysninger.':'Der er ingen mailadresse gemt på tilbuddet endnu. Skriv kundens mailadresse her; den gemmes på kunden ved afsendelse.';
    byId('offerMailModal').classList.add('open');
    setTimeout(()=>{(to?byId('offerMailSubject'):byId('offerMailTo'))?.focus()},0);
  }

  async function sendMail(){
    const o=offer();if(!o)return;
    const to=String(byId('offerMailTo')?.value||'').trim(),subject=String(byId('offerMailSubject')?.value||'').trim(),body=String(byId('offerMailBody')?.value||'').trim(),follow=String(byId('offerMailFollow')?.value||'').trim();
    if(!to||!subject||!body){if(typeof toast==='function')toast('Udfyld modtager, emne og mailtekst');return}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){if(typeof toast==='function')toast('Mailadressen er ikke gyldig');return}
    if(!confirm(`Send mailen nu fra ${sender()} til ${to}?`))return;
    const button=byId('sendOfferMail'),old=button.textContent;button.disabled=true;button.textContent='Sender…';
    try{
      if(typeof callProtectedEdge!=='function')throw new Error('Mailfunktionen er ikke tilgængelig i denne version af Lead Manager.');
      const result=await callProtectedEdge('gmail-direct-send',{client_id:state.client.id,offer_id:o.id,lead_id:o.lead_id||null,to,subject,body,follow_up_date:follow||null,ai_generated:false,ai_model:null});
      if(result?.error)throw new Error(result.error.message||String(result.error));
      byId('offerMailModal').classList.remove('open');
      if(typeof loadAll==='function')await loadAll();
      if(typeof openOffer==='function')openOffer(o.id);
      if(typeof toast==='function')toast(`Mail sendt til ${to}`);
    }catch(error){alert('Mailen blev ikke sendt: '+(error?.message||String(error)))}
    finally{button.disabled=false;button.textContent=old}
  }

  const observer=new MutationObserver(()=>ensureButton());
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',()=>setTimeout(ensureButton,0),true);
  ensureModal();ensureButton();
})();
