(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let saving=false,lastSaved='';
function currentName(){try{return String(state?.client?.settings?.mail_sender_name||state?.client?.settings?.contact_name||state?.client?.name||'').trim()}catch{return''}}
async function session(){if(typeof supabase==='undefined')return null;const {data}=await supabase.auth.getSession();return data?.session||null}
async function saveName(show=true){
  const input=$('#lmMailSenderName');if(!input||typeof state==='undefined'||!state?.client)return false;
  const name=String(input.value||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
  if(!name){if(show)message('Indtast det navn, modtageren skal se som afsender.',true);return false}
  if(saving)return false;if(name===lastSaved)return true;saving=true;
  try{
    const s=await session();if(!s?.access_token)throw new Error('Login-session mangler');
    const r=await fetch(`${API}/functions/v1/mail-provider-auth`,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+s.access_token},body:JSON.stringify({action:'save_sender_name',client_id:state.client.id,sender_name:name})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
    lastSaved=name;
    try{state.client.settings={...(state.client.settings||{}),mail_sender_name:name}}catch{}
    if(show)message(`✓ Afsendernavn gemt. Modtageren vil se “${name}” sammen med mailadressen.`,false,true);
    return true;
  }catch(e){if(show)message('Kunne ikke gemme afsendernavnet: '+(e.message||e),true);return false}finally{saving=false}
}
function message(text,bad=false,ok=false){const el=$('#lmMailProviderMessage');if(!el)return;el.textContent=text;el.style.color=bad?'#9f1239':ok?'#166534':''}
function inject(){
  if($('#lmMailSenderName'))return true;
  const mail=$('#lmMailAccount');if(!mail)return false;
  const field=mail.closest('.field');if(!field)return false;
  const wrap=document.createElement('div');wrap.className='field';wrap.id='lmMailSenderNameWrap';
  wrap.innerHTML=`<label>Navn <span class="sub">(det modtageren ser som afsender)</span></label><input id="lmMailSenderName" autocomplete="name" maxlength="120" placeholder="Fx Jesper Hansen" value="${esc(currentName())}"><div class="sub" style="margin-top:5px">Eksempel: <span id="lmMailSenderPreview"></span></div>`;
  field.insertAdjacentElement('afterend',wrap);
  const input=$('#lmMailSenderName');
  const updatePreview=()=>{const name=String(input.value||'').trim()||'Navn',account=String($('#lmMailAccount')?.value||'mail@virksomhed.dk').trim()||'mail@virksomhed.dk';$('#lmMailSenderPreview').textContent=`${name} <${account}>`};
  input.addEventListener('input',updatePreview);input.addEventListener('change',()=>saveName(false));input.addEventListener('blur',()=>saveName(false));
  $('#lmMailAccount')?.addEventListener('input',updatePreview);updatePreview();
  return true;
}
const originalFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
  let next=init;
  try{
    const url=typeof input==='string'?input:(input?.url||'');
    if(url.includes('/functions/v1/mail-provider-auth')&&init?.body&&typeof init.body==='string'){
      const body=JSON.parse(init.body);
      if(body?.action==='save'&&$('#lmMailSenderName')){
        const sender=String($('#lmMailSenderName').value||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
        if(sender){body.sender_name=sender;next={...init,body:JSON.stringify(body)}}
      }
    }
  }catch{}
  return originalFetch(input,next)
};
function bindConnect(){const b=$('#lmMailProviderConnect');if(!b||b.dataset.senderNameBound)return;b.dataset.senderNameBound='1';b.addEventListener('pointerdown',()=>saveName(false),true);b.addEventListener('focus',()=>saveName(false),true)}
function boot(){inject();bindConnect()}
window.addEventListener('load',()=>setTimeout(boot,120));setTimeout(boot,300);let tries=0;const timer=setInterval(()=>{tries++;boot();if($('#lmMailSenderName')||tries>50)clearInterval(timer)},300);
})();
