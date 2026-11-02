const fs=require('node:fs'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const s=fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
const source=s.slice(s.indexOf('async function resolveOfferPdf('),s.indexOf('function createMimeUploadBody('));
let calls=[],answers={};const chain={update:()=>chain,eq:()=>chain,then:resolve=>resolve({error:null})};
const admin={from:()=>chain};
const ctx={minubaOfferId:o=>o.minuba_offer_id,trim:v=>String(v||''),console,Date};
for(const [fn,key] of [['minubaPdfCandidate','minuba'],['gmailCachedPdfCandidate','cache'],['gmailPdfCandidate','gmail'],['minubaLiveRenderCandidate','render']])ctx[fn]=async()=>{calls.push(key);if(answers[key] instanceof Error)throw answers[key];return answers[key]||null;};
const resolve=new Function(...Object.keys(ctx),stripTypeScriptTypes(source,{mode:'transform'})+';return resolveOfferPdf;')(...Object.values(ctx));
const offer={id:'o',minuba_offer_id:'m',pdf_source_kind:'gmail_cache',pdf_source_message_id:'msg'};
(async()=>{
  const found={filename:'Tilbud 2854.pdf',source:'minuba_file'};
  answers={minuba:found};assert.equal(await resolve(admin,'tenant',offer,'2854','token'),found);assert.deepEqual(calls,['minuba']);
  calls=[];answers={minuba:new Error('Minuba unavailable'),cache:found};assert.equal(await resolve(admin,'tenant',offer,'2854','token'),found);assert.deepEqual(calls,['minuba','cache']);
  calls=[];answers={gmail:found};await resolve(admin,'tenant',offer,'2854','token');assert.deepEqual(calls,['minuba','cache','gmail']);
  calls=[];answers={render:found};await resolve(admin,'tenant',offer,'2854','token');assert.deepEqual(calls,['minuba','cache','gmail','render']);
  calls=[];answers={};assert.equal(await resolve(admin,'tenant',offer,'2854','token'),null);
  console.log('PASS: original-first resolution, source failure isolation, mail originals before reconstruction, no PDF means no candidate');
})().catch(e=>{console.error(e);process.exitCode=1;});
