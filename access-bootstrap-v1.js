(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
let bootPromise=null,rescuePromise=null;
async function centralBootstrap(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session?.access_token)return {authenticated:false,next_route:'login'};
 const r=await fetch(API+'/functions/v1/session-bootstrap',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}'});
 const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}};
 if(!r.ok)throw new Error(d.error||('Adgangskontrol fejlede ('+r.status+')'));
 return d;
}
async function openWorkspace(access){
 let clientId=access.workspace_id||null;
 const email=state.session?.user?.email||'';
 if(access.platform_admin){
  const preferred=localStorage.getItem('lm_admin_active_client_v1')||localStorage.getItem('lm_admin_client_id')||'';
  if(preferred)clientId=preferred;
 }
 if(!clientId)throw new Error('Intet workspace kunne vælges.');
 let [cr,maps]=await Promise.all([
  supabase.from('crm_clients').select('*').eq('id',clientId),
  supabase.from('crm_users').select('*').eq('email',email)
 ]);
 if((cr.error||!cr.data?.length)&&access.platform_admin&&access.workspace_id&&String(access.workspace_id)!==String(clientId)){
  clientId=access.workspace_id;
  cr=await supabase.from('crm_clients').select('*').eq('id',clientId);
 }
 if(cr.error||!cr.data?.length)throw new Error(cr.error?.message||'Workspace kunne ikke hentes');
 state.client=cr.data[0];
 state.userMap=maps.data?.find(x=>x.client_id===clientId)||maps.data?.[0]||null;
 document.body.dataset.lmRole=access.role||'';document.body.dataset.lmPlatformAdmin=access.platform_admin?'1':'0';
 document.getElementById('lmOb4')?.remove();document.getElementById('lmObError')?.remove();document.getElementById('lmBootRescueError')?.remove();
 showApp();
 if(document.getElementById('brandClient'))document.getElementById('brandClient').textContent=state.client.name+' · '+(access.platform_admin?'Platform admin':'Kundeworkspace');
 try{await loadAll({startup:true})}catch(loadErr){console.error('CRM dataindlæsning',loadErr);if(typeof toast==='function')toast('Workspace åbnet, men nogle data kunne ikke hentes endnu.')}
 window.dispatchEvent(new CustomEvent('lm:workspace-ready',{detail:{client_id:state.client?.id||clientId,platform_admin:!!access.platform_admin}}));
}
async function controlledStartApp(){
 if(bootPromise)return bootPromise;
 bootPromise=(async()=>{
  const loading=document.getElementById('loading');if(loading)loading.classList.remove('hidden');
  try{
   let access=await centralBootstrap();
   const activating=new URLSearchParams(location.search).get('activated')==='1';
   if(activating&&access.authenticated&&access.next_route==='onboarding'){
    for(let i=0;i<5&&access.next_route==='onboarding';i++){await new Promise(r=>setTimeout(r,300));access=await centralBootstrap()}
   }
   window.LM_ACCESS=access;
   window.dispatchEvent(new CustomEvent('lm:access-ready',{detail:access}));
   if(!access.authenticated){showAuth();return}
   if(access.next_route==='denied'){showAuth('Denne konto har ikke adgang til et workspace.');await supabase.auth.signOut();return}
   if(access.next_route==='onboarding'){
    document.getElementById('authScreen')?.classList.add('hidden');document.getElementById('appShell')?.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('lm:central-onboarding-required',{detail:access}));
    return;
   }
   if(activating){const u=new URL(location.href);u.searchParams.delete('activated');history.replaceState({},'',u.pathname+(u.search||''))}
   await openWorkspace(access);
  }catch(e){console.error('Central adgangskontrol',e);showAuth('Lead Manager kunne ikke kontrollere din adgang. '+(e.message||e));}
  finally{if(loading)loading.classList.add('hidden');bootPromise=null}
 })();return bootPromise;
}
async function rescueActiveWorkspace(){
 if(rescuePromise)return rescuePromise;
 const app=document.getElementById('appShell');if(!app||!app.classList.contains('hidden'))return;
 rescuePromise=(async()=>{try{
  const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)return;
  state.session=session;
  const access=await centralBootstrap();window.LM_ACCESS=access;window.dispatchEvent(new CustomEvent('lm:access-ready',{detail:access}));
  if(access.authenticated&&access.next_route==='app'){
   await openWorkspace(access);
   app.classList.remove('hidden');document.getElementById('authScreen')?.classList.add('hidden');
  }
 }catch(e){
  console.error('Workspace rescue',e);
  if(document.getElementById('lmBootRescueError'))return;
  const x=document.createElement('div');x.id='lmBootRescueError';x.style.cssText='position:fixed;inset:0;z-index:15000;background:#f5f7fb;display:grid;place-items:center;padding:24px';
  x.innerHTML='<div style="max-width:620px;background:#fff;padding:28px;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.12)"><h2>Lead Manager kunne ikke åbne workspace</h2><p id="lmBootRescueMsg"></p><button class="btn primary" type="button" onclick="location.reload()">Prøv igen</button></div>';
  document.body.appendChild(x);document.getElementById('lmBootRescueMsg').textContent=e?.message||String(e);
 }finally{rescuePromise=null}})();
 return rescuePromise;
}
startApp=controlledStartApp;
window.LMAccess={bootstrap:centralBootstrap,start:controlledStartApp,rescue:rescueActiveWorkspace};
authInit();
setTimeout(rescueActiveWorkspace,900);
setTimeout(rescueActiveWorkspace,2200);
})();