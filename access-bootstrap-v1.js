(()=>{
'use strict';
let bootPromise=null,rescuePromise=null,onboardingScriptPromise=null,adminBundlesPromise=null,settingsHubPromise=null,regressionCenterPromise=null;
const ADMIN_BUNDLES=[
 '/saas-platform-admin-v1.js?v=20260919-4',
 '/saas-compliance-admin-v1.js?v=20260919-6',
 '/saas-admin-client-switcher-v1.js?v=20260919-2',
 '/saas-admin-users-v1.js?v=20260919-3',
 '/saas-impersonation-v1.js?v=20260919-2',
 '/saas-marketing-connections-v1.js?v=20260919-4'
];
function loadLazyScript(src){
 return new Promise((resolve,reject)=>{
  if(document.querySelector('script[src="'+src+'"]')){resolve();return}
  const script=document.createElement('script');script.src=src;script.async=true;
  script.onload=()=>resolve();script.onerror=()=>reject(new Error('Modul kunne ikke indlæses: '+src));
  document.head.appendChild(script);
 });
}
function ensureAdminBundles(){
 if(adminBundlesPromise)return adminBundlesPromise;
 adminBundlesPromise=Promise.all(ADMIN_BUNDLES.map(loadLazyScript)).catch(error=>{adminBundlesPromise=null;throw error});
 return adminBundlesPromise;
}
function ensureSettingsHub(){
 if(settingsHubPromise)return settingsHubPromise;
 const scripts=['/saas-mail-providers-v1.js?v=20260919-3','/saas-gmail-platform-ui-v1.js?v=20260919-4','/saas-minuba-v1.js?v=20260919-3'];
 if(window.LM_ACCESS?.platform_admin!==true)scripts.unshift('/saas-settings-hub-v1.js?v=20260919-14');
 settingsHubPromise=Promise.all(scripts.map(loadLazyScript)).catch(error=>{settingsHubPromise=null;throw error});
 return settingsHubPromise;
}
function settingsReturnCallback(){
 const q=new URLSearchParams(location.search);
 return !!(q.get('microsoft')||q.get('gmail')||q.get('google')||q.has('minuba'));
}
function ensureRegressionCenter(){
 if(regressionCenterPromise)return regressionCenterPromise;
 regressionCenterPromise=loadLazyScript('/saas-regression-center-v1.js?v=20260919-4').catch(error=>{regressionCenterPromise=null;throw error});
 return regressionCenterPromise;
}
function onboardingToken(){return new URLSearchParams(location.search).get('onboarding')||''}
function ensureOnboardingScript(){
 if(window.__LM_ONBOARDING_V5)return Promise.resolve();
 if(onboardingScriptPromise)return onboardingScriptPromise;
 onboardingScriptPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='/saas-onboarding-v5.js?v=20260919-5';
  script.async=true;
  script.onload=()=>resolve();
  script.onerror=()=>{onboardingScriptPromise=null;reject(new Error('Onboarding-modulet kunne ikke indlæses'))};
  document.head.appendChild(script);
 });
 return onboardingScriptPromise;
}
async function centralBootstrap(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session?.access_token)return {authenticated:false,next_route:'login'};
 const {data,error}=await supabase.rpc('crm_session_bootstrap');
 if(error)throw new Error(error.message||'Adgangskontrol fejlede');
 return data||{authenticated:false,next_route:'login'};
}
async function openWorkspace(access){
 let clientId=access.workspace_id||null;
 const email=state.session?.user?.email||'';
 if(access.platform_admin){
  const preferred=localStorage.getItem('lm_admin_active_client_v1')||localStorage.getItem('lm_admin_client_id')||'';
  if(preferred)clientId=preferred;
 }
 if(!clientId)throw new Error('Intet workspace kunne vælges.');
 let cr=null;
 if(!access.platform_admin&&access.client&&String(access.client.id)===String(clientId)){
  cr={data:[access.client],error:null};
 }else{
  cr=await supabase.from('crm_clients').select('*').eq('id',clientId);
 }
 if((cr.error||!cr.data?.length)&&access.platform_admin&&access.workspace_id&&String(access.workspace_id)!==String(clientId)){
  clientId=access.workspace_id;
  cr=await supabase.from('crm_clients').select('*').eq('id',clientId);
 }
 if(cr.error||!cr.data?.length)throw new Error(cr.error?.message||'Workspace kunne ikke hentes');
 state.client=cr.data[0];
 const fallbackRole=access.platform_admin?'platform_admin':access.role==='workspace_owner'?'owner':access.role==='workspace_admin'?'admin':'member';
 state.userMap=access.membership||{email,client_id:clientId,role:fallbackRole,active:true,auth_user_id:state.session?.user?.id||null};
 document.body.dataset.lmRole=access.role||'';document.body.dataset.lmPlatformAdmin=access.platform_admin?'1':'0';
 document.getElementById('lmOb4')?.remove();document.getElementById('lmObError')?.remove();document.getElementById('lmBootRescueError')?.remove();
 showApp();
 if(document.getElementById('brandClient'))document.getElementById('brandClient').textContent=state.client.name+' · '+(access.platform_admin?'Platform admin':'Kundeworkspace');
 try{await loadAll({startup:true})}catch(loadErr){console.error('CRM dataindlæsning',loadErr);if(typeof toast==='function')toast('Workspace åbnet, men nogle data kunne ikke hentes endnu.')}
 window.dispatchEvent(new CustomEvent('lm:workspace-ready',{detail:{client_id:state.client?.id||clientId,platform_admin:!!access.platform_admin}}));
 if(!access.platform_admin&&document.getElementById('leadmanager')?.classList.contains('active'))ensureSettingsHub().catch(error=>console.warn('settings lazy load',error));
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
   if(access.platform_admin)await ensureAdminBundles();
   window.dispatchEvent(new CustomEvent('lm:access-ready',{detail:access}));
   if(!access.authenticated){showAuth();return}
   if(access.next_route==='denied'){showAuth('Denne konto har ikke adgang til et workspace.');await supabase.auth.signOut();return}
   if(access.next_route==='onboarding'){
    await ensureOnboardingScript();
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
 if(bootPromise)return null;
 if(['onboarding','denied','login'].includes(window.LM_ACCESS?.next_route||''))return null;
 const app=document.getElementById('appShell');if(!app||!app.classList.contains('hidden'))return;
 rescuePromise=(async()=>{try{
  const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)return;
  state.session=session;
  const access=await centralBootstrap();window.LM_ACCESS=access;if(access.platform_admin)await ensureAdminBundles();window.dispatchEvent(new CustomEvent('lm:access-ready',{detail:access}));
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
window.LMAccess={bootstrap:centralBootstrap,start:controlledStartApp,rescue:rescueActiveWorkspace,loadOnboarding:ensureOnboardingScript,loadAdmin:ensureAdminBundles,loadSettings:ensureSettingsHub,loadRegression:ensureRegressionCenter};
document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view="leadmanager"]'))ensureSettingsHub().catch(error=>console.warn('settings lazy load',error))},true);
document.addEventListener('click',event=>{if(event.target.closest?.('.nav button[data-view="feedback"]'))ensureRegressionCenter().catch(error=>console.warn('regression lazy load',error))},true);
async function initAccessBootstrap(){
 if(settingsReturnCallback())await ensureSettingsHub();
 if(onboardingToken()){
  await ensureOnboardingScript();
  try{if(window.__LM_ONBOARDING_CLAIM_PROMISE)await window.__LM_ONBOARDING_CLAIM_PROMISE}catch(error){console.warn('Onboarding invitation init',error)}
 }
 authInit();
 setTimeout(rescueActiveWorkspace,900);
 setTimeout(rescueActiveWorkspace,2200);
}
initAccessBootstrap().catch(error=>{console.error('Access bootstrap init',error);showAuth('Lead Manager kunne ikke starte onboarding. '+(error?.message||error))});
})();