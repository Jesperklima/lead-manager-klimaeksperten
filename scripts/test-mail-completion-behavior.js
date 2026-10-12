'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const pdf=fs.readFileSync('offer-mail-pdf-v1.js','utf8');
const direct=fs.readFileSync('offer-mail-v1.js','utf8');
const backend=fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
function extract(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'missing real source function '+start);
  return source.slice(a,b);
}
// Execute the actual browser-side state classifiers, not merely search for code markers.
const statusCode=extract(pdf,"  const finalizedStatuses=","  function mailErrorFrom(");
const status=vm.runInNewContext(statusCode+";({isSentResult,isPostprocessPending})");
assert.equal(status.isSentResult({status:'sent'}),true);
for(const s of ['sent_pending_postprocess','postprocessing','sending','prepared','unknown','failed']){
  assert.equal(status.isSentResult({status:s}),false,s+' must not mean fully sent');
}
for(const s of ['sent_pending_postprocess','postprocessing'])assert.equal(status.isPostprocessPending({status:s}),true);

// DB readback must happen even if the local UI offer has the desired date.
async function checkDateReadback(src,next){
  let reads=0;
  const state={client:{id:'tenant1'},offers:[{id:'offer1',follow_up_date:'2026-10-26'}]};
  const supabase={from(name){
    assert.equal(name,'crm_offers');reads++;
    return {select(){return this},eq(){return this},limit(){return Promise.resolve({
      data:[{id:'offer1',client_id:'tenant1',follow_up_date:next}],error:null
    })}};
  }};
  const context={supabase,state,offer:()=>({id:'offer1'}),byId:()=>null,
    normalizeFollowDate:v=>v,console};
  const fn=extract(src,"  async function verifyOfferFollowUp(","  async function "+(src===pdf?"waitForOfferFollowUp(":"finishSuccessfulSend("));
  vm.runInNewContext(fn+";this.check=verifyOfferFollowUp;",context);
  const offer={id:'offer1',follow_up_date:'2026-10-26'};
  if(next==='2026-10-12')await assert.rejects(()=>context.check(offer,'2026-10-26'),/ikke gemt/);
  else assert.equal(await context.check(offer,'2026-10-26'),true);
  assert.equal(reads,1,'Must check server regardless of cached value');
}

// Exercise the actual completion function: a postprocess-pending job must never close
// the composer; a sent job must wait for a verified follow-up commit before closing.
async function checkCompletion(){
  let closes=0,clears=0,finishes=0,release;
  const done=new Promise(resolve=>release=resolve);
  const context={
    currentPdfSendId:'job123',pdfSendState:'uncertain',finishingSendIds:new Set(),
    isSentResult:status.isSentResult,effectiveFollowDate:(data,backup)=>data.follow_up_date||backup,
    waitForOfferFollowUp:async()=>{await done;finishes++;return true},
    renderSendStatus:()=>{},clearPendingSend:()=>{clears++},
    byId:id=>id==='offerMailModal'?{classList:{remove:()=>{closes++}}}:null,
    window:{dispatchEvent:()=>{}},CustomEvent:class {constructor(name,opts){this.name=name;this.opts=opts}},
    toast:()=>{},console,setTimeout:()=>{},loadPendingSend:()=>null,
    resumePendingOfferSend:()=>{}
  };
  const f=extract(pdf,"  async function finishPdfSend(","  async function resumePendingOfferSend(");
  vm.runInNewContext(f+";this.finish=finishPdfSend;",context);
  const offer={id:'offer1'};
  assert.equal(await context.finish(offer,'customer@example.com',{status:'sent_pending_postprocess'},'Tilbud.pdf','2026-10-26'),false);
  assert.equal(closes,0);assert.equal(clears,0);
  const result=context.finish(offer,'customer@example.com',{status:'sent',follow_up_date:'2026-10-26'},'Tilbud.pdf','2026-10-26');
  await Promise.resolve();await Promise.resolve();
  assert.equal(closes,0,'Never close while database verification pending');
  assert.equal(clears,0,'Never drop recovery identifier while database verification pending');
  release();
  assert.equal(await result,true);
  assert.equal(finishes,1);assert.equal(closes,1);assert.equal(clears,1);
}

(async()=>{
  await checkDateReadback(pdf,'2026-10-12');
  await checkDateReadback(pdf,'2026-10-26');
  await checkDateReadback(direct,'2026-10-12');
  await checkDateReadback(direct,'2026-10-26');
  await checkCompletion();
  const quota=backend.indexOf("const quotaExceeded = "),use=backend.indexOf("error_code:quotaExceeded?");
  assert(quota>0&&use>quota,'A Gmail quota rejection must never throw while persisting its error');
  assert(pdf.includes("if(checked.state==='unknown')"),'Unknown Gmail outcome must not be labeled failed');
  console.log('PASS: live source behavior — send state, DB readback, confirmed completion, quota error order');
})().catch(e=>{console.error(e);process.exitCode=1;});
