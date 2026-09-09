(()=>{
  'use strict';

  const byId=id=>document.getElementById(id);
  const firstEmail=value=>(String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
  const lower=v=>String(v||'').trim().toLowerCase();

  function offer(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function sender(){try{return String(state?.client?.settings?.mail||'js@klimaeksperten.dk').trim()}catch{return'js@klimaeksperten.dk'}}
  function contacts(o){try{return typeof contactsFor==='function'?contactsFor(o.company_id):((state?.contacts||[]).filter(x=>x.company_id===o.company_id))}catch{return[]}}
  function bounced(email,o){const e=lower(email);return contacts(o).find(x=>lower(x?.email)===e&&String(x?.source_type||'').startsWith('smtp_bounced'))||null}
  function pdfName(o){const ref=String(o?.offer_ref||'').trim();return ref?`Tilbud ${ref}.pdf`:''}

  function ensureAttachmentRow(){
    const body=byId('offerMailBody');if(!body)return;
    let box=byId('offerMailAttachment');
    if(!box){
      const field=document.createElement('div');field.className='field';field.id='offerMailAttachmentField';
      field.innerHTML='<label>Vedhæftning</label><div id="offerMailAttachment" style="border:1px solid #dfe4ea;border-radius:10px;padding:11px 12px;background:#f8fafc;font-size:14px"></div>';
      body.closest('.field')?.insertAdjacentElement('afterend',field);box=byId('offerMailAttachment');
    }
    const o=offer(),name=pdfName(o);
    if(box)box.innerHTML=name?`📎 <strong>${name}</strong><div class="sub" style="margin-top:4px">Den originale tilbuds-PDF fra Minuba hentes automatisk. Mailen kan ikke sendes, hvis den rigtige PDF ikke findes.</div>`:'📎 Tilbudsnummer mangler – PDF kan ikke vælges sikkert.';
  }

  async function sendWithPdf(){
    const o=offer();if(!o)return;
    const to=String(byId('offerMailTo')?.value||'').trim(),subject=String(byId('offerMailSubject')?.value||'').trim(),body=String(byId('offerMailBody')?.value||'').trim(),follow=String(byId('offerMailFollow')?.value||'').trim(),name=pdfName(o);
    if(!to||!subject||!body){if(typeof toast==='function')toast('Udfyld modtager, emne og mailtekst');return}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){if(typeof toast==='function')toast('Mailadressen er ikke gyldig');return}
    if(bounced(to,o)){alert(`${to} er markeret som ugyldig efter en permanent mailfejl. Vælg en anden adresse.`);return}
    if(!name){alert('Tilbudsnummeret mangler. Mailen sendes ikke, fordi den rigtige PDF ikke kan identificeres sikkert.');return}
    if(!confirm(`Send mailen nu fra ${sender()} til ${to} med ${name} vedhæftet?`))return;
    const button=byId('sendOfferMail'),old=button?.textContent||'Send mail';if(button){button.disabled=true;button.textContent='Henter PDF og sender…'}
    const attachment=byId('offerMailAttachment');if(attachment)attachment.innerHTML=`⏳ Henter <strong>${name}</strong> fra den oprindelige Minuba-mail…`;
    try{
      if(typeof callProtectedEdge!=='function')throw new Error('Mailfunktionen er ikke tilgængelig i denne version af Lead Manager.');
      const result=await callProtectedEdge('gmail-offer-send',{client_id:state.client.id,offer_id:o.id,lead_id:o.lead_id||null,to,subject,body,follow_up_date:follow||null});
      if(result?.error)throw new Error(result.error.message||String(result.error));
      const data=result?.data??result;
      if(!data?.ok)throw new Error(data?.error||'Mailen kunne ikke sendes.');
      byId('offerMailModal')?.classList.remove('open');
      if(typeof loadAll==='function')await loadAll();
      if(typeof openOffer==='function')openOffer(o.id);
      if(typeof toast==='function')toast(`Mail sendt til ${to} med ${data?.attachment?.filename||name}`);
    }catch(error){
      ensureAttachmentRow();
      alert('Mailen blev ikke sendt: '+(error?.message||String(error)));
    }finally{if(button){button.disabled=false;button.textContent=old}}
  }

  function wire(){
    const button=byId('sendOfferMail');if(!button)return;
    ensureAttachmentRow();
    if(button.dataset.pdfOfferSend==='1')return;
    button.onclick=sendWithPdf;button.dataset.pdfOfferSend='1';
  }

  new MutationObserver(()=>setTimeout(wire,10)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('click',()=>setTimeout(wire,15),true);
  setInterval(()=>{if(byId('offerMailModal')?.classList.contains('open'))wire()},500);
  setTimeout(wire,100);
})();
