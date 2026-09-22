(()=>{
'use strict';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let busy=false;

function isPlatformAdmin(){
  return window.LM_ACCESS?.platform_admin===true;
}

async function edge(payload){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Login-session mangler');
  const response=await fetch(SUPABASE_URL+'/functions/v1/saas-admin-invite',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_KEY,
      Authorization:'Bearer '+session.access_token
    },
    body:JSON.stringify(payload)
  });
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
  if(!response.ok){
    const error=new Error(data.error||('HTTP '+response.status));
    error.code=data.code;
    throw error;
  }
  return data;
}

function style(){
  if($('#lmAdminCustomerInviteStyle'))return;
  const node=document.createElement('style');
  node.id='lmAdminCustomerInviteStyle';
  node.textContent=`
    #lmAdminCustomerInvite{margin-top:20px;padding-top:18px;border-top:1px solid var(--border,#e6eaf0)}
    #lmAdminCustomerInvite .lmaci-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}
    #lmAdminCustomerInvite .lmaci-head h3{margin:0 0 4px;font-size:16px}
    #lmAdminCustomerInvite .lmaci-badge{display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:#eef2ff;color:#3157e8;font-size:11px;font-weight:850;white-space:nowrap}
    #lmAdminCustomerInvite .lmaci-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    #lmAdminCustomerInvite .field{margin:0}
    #lmAdminCustomerInvite label{display:block;font-size:12px;font-weight:800;color:var(--muted,#64748b);margin-bottom:5px}
    #lmAdminCustomerInvite input,#lmAdminCustomerInvite select{width:100%;min-height:42px;padding:9px 10px;border:1px solid var(--border,#e6eaf0);border-radius:10px;background:var(--panel,#fff);color:var(--text,#10203a)}
    #lmAdminCustomerInvite .lmaci-plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:6px}
    #lmAdminCustomerInvite .lmaci-plan{border:1px solid var(--border,#e6eaf0);background:var(--panel,#fff);color:var(--text,#10203a);border-radius:10px;padding:10px;cursor:pointer;text-align:left}
    #lmAdminCustomerInvite .lmaci-plan strong{display:block;font-size:13px}
    #lmAdminCustomerInvite .lmaci-plan span{display:block;font-size:11px;color:var(--muted,#64748b);margin-top:2px}
    #lmAdminCustomerInvite .lmaci-plan.active{border-color:#3157e8;background:#f6f8ff;box-shadow:0 0 0 1px rgba(49,87,232,.14)}
    #lmAdminCustomerInvite .lmaci-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
    #lmAdminCustomerInvite .lmaci-msg{font-size:12px;color:var(--muted,#64748b);min-height:18px}
    #lmAdminCustomerInvite .lmaci-success{margin-top:12px;padding:11px 13px;border-radius:11px;background:#ecfdf5;border:1px solid #bbf7d0;color:#166534;font-size:12px}
    @media(max-width:720px){#lmAdminCustomerInvite .lmaci-grid{grid-template-columns:1fr}#lmAdminCustomerInvite .lmaci-plans{grid-template-columns:1fr}}
  `;
  document.head.appendChild(node);
}

function card(){
  if(!isPlatformAdmin())return null;
  const account=$('#lmSettingsAccountCard');
  if(!account)return null;

  let host=$('#lmAdminCustomerInvite');
  if(!host){
    host=document.createElement('section');
    host.id='lmAdminCustomerInvite';
  }
  if(host.parentElement!==account){
    const users=$('#lmWorkspaceUsers');
    if(users?.parentElement===account)account.insertBefore(host,users);
    else account.appendChild(host);
  }
  return host;
}

function bindPlans(host){
  host.querySelectorAll('[data-lmaci-plan]').forEach(button=>{
    button.addEventListener('click',()=>{
      const value=button.dataset.lmaciPlan;
      const hidden=host.querySelector('#lmaciPlan');
      if(hidden)hidden.value=value;
      host.querySelectorAll('[data-lmaci-plan]').forEach(item=>{
        const active=item.dataset.lmaciPlan===value;
        item.classList.toggle('active',active);
        item.setAttribute('aria-pressed',active?'true':'false');
      });
    });
  });
}

async function submit(host){
  if(busy)return;
  const company=String(host.querySelector('#lmaciCompany')?.value||'').trim();
  const name=String(host.querySelector('#lmaciName')?.value||'').trim();
  const email=String(host.querySelector('#lmaciEmail')?.value||'').trim().toLowerCase();
  const plan=String(host.querySelector('#lmaciPlan')?.value||'start');
  const msg=host.querySelector('#lmaciMsg');
  const button=host.querySelector('#lmaciSend');

  if(company.length<2){
    msg.textContent='Indtast virksomhedens navn.';
    return;
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    msg.textContent='Indtast en gyldig e-mail.';
    return;
  }

  busy=true;
  button.disabled=true;
  msg.textContent='Opretter nyt workspace og sender invitation…';
  host.querySelector('#lmaciSuccess')?.remove();

  try{
    const result=await edge({
      company_name:company,
      recipient_name:name,
      email,
      plan_code:plan
    });
    const days=Number(result.invite_validity_days||14);
    const success=document.createElement('div');
    success.id='lmaciSuccess';
    success.className='lmaci-success';
    success.innerHTML='<strong>✓ Kunden er oprettet.</strong><br>'+
      esc(result.company_name||company)+' har fået sit eget workspace på '+esc(plan.toUpperCase())+
      ', og invitationen er sendt til '+esc(result.email||email)+'. Linket er gyldigt i '+days+' dage.';
    host.appendChild(success);
    host.querySelector('#lmaciCompany').value='';
    host.querySelector('#lmaciName').value='';
    host.querySelector('#lmaciEmail').value='';
    msg.textContent='';
    if(typeof toast==='function')toast('Ny kunde oprettet og invitation sendt');
    window.dispatchEvent(new CustomEvent('lm:admin-customer-created',{detail:{
      client_id:result.client_id||null,
      company_name:result.company_name||company,
      email:result.email||email,
      plan_code:plan
    }}));
  }catch(error){
    msg.textContent=error.message||String(error);
  }finally{
    busy=false;
    button.disabled=false;
  }
}

function mount(){
  if(!isPlatformAdmin())return;
  style();
  const host=card();
  if(!host)return;

  if(host.dataset.ready==='1')return;
  host.dataset.ready='1';
  host.innerHTML=`
    <div class="lmaci-head">
      <div>
        <h3>Invitér ny kunde</h3>
        <div class="sub">Opret en ny virksomhed med eget Lead Manager-workspace og send kundens onboarding-link.</div>
      </div>
      <span class="lmaci-badge">Platform-admin</span>
    </div>
    <div class="lmaci-grid">
      <div class="field">
        <label for="lmaciCompany">Virksomhedsnavn</label>
        <input id="lmaciCompany" autocomplete="organization" placeholder="Fx Firma ApS">
      </div>
      <div class="field">
        <label for="lmaciName">Kontaktperson</label>
        <input id="lmaciName" autocomplete="name" placeholder="Fx Peter Jensen">
      </div>
      <div class="field">
        <label for="lmaciEmail">Kundens e-mail</label>
        <input id="lmaciEmail" type="email" autocomplete="email" placeholder="peter@firma.dk">
      </div>
      <div class="field">
        <label>Pakke</label>
        <input id="lmaciPlan" type="hidden" value="start">
        <div class="lmaci-plans">
          <button type="button" class="lmaci-plan active" data-lmaci-plan="start" aria-pressed="true"><strong>Start</strong><span>149 kr./md.</span></button>
          <button type="button" class="lmaci-plan" data-lmaci-plan="pro" aria-pressed="false"><strong>Pro</strong><span>199 kr./md.</span></button>
          <button type="button" class="lmaci-plan" data-lmaci-plan="business" aria-pressed="false"><strong>Business</strong><span>249 kr./md.</span></button>
        </div>
      </div>
    </div>
    <div class="lmaci-actions">
      <button type="button" class="btn primary" id="lmaciSend">Opret kunde og send invitation</button>
      <div id="lmaciMsg" class="lmaci-msg" role="status" aria-live="polite"></div>
    </div>
    <div class="lm-settings-note" style="margin-top:12px">Denne funktion opretter en helt ny kundekonto. Brug <strong>+ Invitér bruger</strong> længere nede, når en person skal ind på en eksisterende kundekonto.</div>
  `;

  bindPlans(host);
  host.querySelector('#lmaciSend')?.addEventListener('click',()=>submit(host));
}

window.LMAdminCustomerInvite={mount};
window.addEventListener('lm:client-switched',()=>setTimeout(mount,0));
window.addEventListener('lm:settings-open-request',()=>setTimeout(mount,0));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});
else setTimeout(mount,0);
})();