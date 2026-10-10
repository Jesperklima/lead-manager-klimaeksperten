const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
const cid='11111111-1111-4111-8111-111111111111';
const rid='22222222-2222-4222-8222-222222222222';
function loadEdge(name,options={}){
 let handler,mutations=0,providerCalls=0,guardCalls=[];
 const member={client_id:cid,email:'owner@example.test',role:'owner',active:true,auth_user_id:'user'};
 const query=()=>{
  let changed=false;
  const q={select(){return q},eq(){return q},in(){return q},ilike(){return q},limit(){return q},order(){return q},
   insert(){changed=true;mutations++;return q},update(){changed=true;mutations++;return q},
   maybeSingle:async()=>({data:member,error:null}),single:async()=>({data:member,error:null}),
   then(a,b){return Promise.resolve({data:changed?member:[member],error:null}).then(a,b)}};
  return q;
 };
 const admin={from:query,rpc:async(name)=>{if(name!=='crm_get_mail_offer_sync_secret')mutations++;return{data:null,error:null}},
 auth:{getUser:async()=>({data:{user:{id:'user',email:member.email,email_confirmed_at:'2026-01-01'}},error:null})}};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/'+name+'/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{mode:'transform'});
 const context={createClient:()=>admin,apiSessionGuard:async(...args)=>{guardCalls.push(args);return options.guard||{allowed:false,status:403,code:'MFA_REQUIRED',error:'MFA required'}},
 Deno:{env:{get:()=> 'test-value'},serve:h=>handler=h},Response,Request,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,crypto:webcrypto,fetch:async()=>{providerCalls++;throw Error('Provider must not be called')},console:{error(){},warn(){},log(){}},setTimeout,clearTimeout,Buffer,btoa,atob};
 vm.runInNewContext(code,context);
 return {handler,counts:()=>({mutations,providerCalls,guardCalls})};
}
const cases={
 'saas-admin-users':{action:'update_plan',client_id:cid,plan_code:'business'},
 'saas-impersonation':{action:'start',client_id:cid},
 'external-crm-sync':{action:'status',client_id:cid},
 'microsoft-oauth-auth':{action:'start',client_id:cid},
 'gmail-direct-send':{client_id:cid,request_id:rid},
 'gmail-offer-send':{action:'send',client_id:cid,request_id:rid},
 'saas-workspace-users':{action:'invite',client_id:cid},
 'gmail-direct-auth':{action:'start',client_id:cid},
 'saas-admin-invite':{action:'list',client_id:cid},
 'saas-onboarding':{action:'status',client_id:cid},
 'microsoft-direct-send':{action:'send',client_id:cid,request_id:rid},
 'platform-legal-identity-admin':{action:'save'},
 'customer-feedback':{action:'list',client_id:cid},
 'credit-check':{action:'list',client_id:cid},
 'legal-agreement':{action:'status',client_id:cid},
 'minuba-offer-lookup':{client_id:cid,offer_ref:'TEST'},
 'mail-offer-sync':{client_id:cid},
 'minuba-offer-status-sync':{client_id:cid}
};
for(const [name,body] of Object.entries(cases))test(name+' denies AAL1 before mutation or external request',async()=>{
 const edge=loadEdge(name);const res=await edge.handler(new Request('https://test/'+name,{method:'POST',headers:{Authorization:'Bearer jwt','Content-Type':'application/json'},body:JSON.stringify(body)}));
 assert.equal(res.status,403);const data=await res.json();assert.match(data.error,/MFA/);
 const c=edge.counts();assert.equal(c.mutations,0);assert.equal(c.providerCalls,0);assert.equal(c.guardCalls.length,1);
 if(name==='microsoft-oauth-auth')assert.equal(c.guardCalls[0][2],true);
});
test('revoked session is rejected before any write',async()=>{
 const edge=loadEdge('saas-admin-users',{guard:{allowed:false,status:401,code:'SESSION_REVOKED',error:'Session revoked'}});
 const res=await edge.handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer jwt'},body:JSON.stringify(cases['saas-admin-users'])}));
 assert.equal(res.status,401);assert.equal(edge.counts().mutations,0);
});
test('contact consent preserves unknown, parses false, and records withdrawal',()=>{
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/contact-consent.ts','utf8'),{mode:'transform'}).replaceAll('export ','');
 const c={};vm.runInNewContext(code,c);
 for(const value of [undefined,null,'',0,1,'yes',{},[]])assert.equal(c.contactConsent(value),null);
 assert.equal(c.contactConsent('false'),false);assert.equal(c.contactConsent('true'),true);
 const prior={consent_to_contact:true,contact_basis:'documented_consent',metadata:{}};
 assert.equal(c.contactState(prior,null,'e','c','now').contact_basis,'documented_consent');
 const withdrawn=c.contactState(prior,false,'withdraw','c','now');assert.equal(withdrawn.consent_to_contact,false);assert.equal(withdrawn.contact_basis,null);
 const next=c.contactState(withdrawn,null,'like','c','later');assert.equal(next.consent_to_contact,false);assert.equal(next.metadata.contact_consent.event_id,'withdraw');
 assert.equal(c.contactState(null,null,'e','c','now').consent_to_contact,false);
});
module.exports={loadEdge};
