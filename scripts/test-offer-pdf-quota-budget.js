'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
const functions=source.slice(source.indexOf('async function gmailReadJson('),source.indexOf('async function resolveOfferPdf('));
let requests=[],quota=false,exact=false;
const context={
Response,URLSearchParams,Date,Set,console,
trim:(v,max=10000)=>String(v??'').trim().slice(0,max),
refNorm:v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,''),
headerValue:(p,name)=>(p?.headers||[]).find(h=>h.name===name)?.value||'',
collectPdfParts:p=>(p?.parts||[]).map(part=>({part,filename:part.filename})),
pdfB64Valid:v=>v==='validated-pdf',fromB64Url:v=>v,
fetch:async url=>{
requests.push(url);
if(quota)return new Response(JSON.stringify({error:{message:'Quota exceeded',errors:[{reason:'userRateLimitExceeded'}]}}),{status:403});
if(url.includes('?maxResults='))return new Response(JSON.stringify({messages:Array.from({length:40},(_,i)=>({id:'m'+i}))}));
return new Response(JSON.stringify({payload:{parts:exact?[{filename:'Tilbud 2615.pdf',body:{data:'validated-pdf'}}]:[]}}));
}};
const api=vm.runInNewContext(stripTypeScriptTypes(functions,{mode:'transform'})+';({gmailPdfCandidate,gmailReadJson})',context);
const chain={select:()=>chain,eq:()=>chain,order:()=>chain,limit:async()=>({data:[]})};
const admin={from:()=>chain};
(async()=>{
let r=await api.gmailPdfCandidate(admin,'tenant',{id:'offer'},'2615','private-token');assert.equal(r,null);assert.equal(requests.filter(x=>x.includes('format=full')).length,20);assert.equal(requests.filter(x=>x.includes('maxResults=20')).length,2);
quota=true;requests=[];await assert.rejects(()=>api.gmailPdfCandidate(admin,'tenant',{id:'offer'},'2615','private-token'),e=>e.code==='GMAIL_QUOTA_EXCEEDED'&&e.status===429&&e.retry_after_seconds===60);assert.equal(requests.length,1);
quota=false;exact=true;requests=[];r=await api.gmailPdfCandidate(admin,'tenant',{id:'offer'},'2615','private-token');assert.equal(r.filename,'Tilbud 2615.pdf');assert.equal(requests.filter(x=>x.includes('format=full')).length,1);
assert(!source.includes('ids.slice(0,140)'));
console.log('PASS: PDF fallback capped at 20 full messages, exact validated PDF stops search, quota rejects immediately with retry guidance, no send invoked');
})().catch(e=>{console.error(e);process.exitCode=1});

