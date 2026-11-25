'use strict';
// No network or real recipients: run the actual composer, template and send code against stubs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const dates=require('../followup-date-v1.js');
const read=p=>fs.readFileSync(p,'utf8');
const templates=[
  {id:'resend',name:'Gensend tilbud',subject:'Tilbud {{offer.number}}',body_text:'Hej {{contact.first_name}}\n\nGensender hermed tilbuddet {{offer.number}}, så det ligger øverst i bunken.\n\nSer frem til at høre fra dig.\n\nSkulle der være evt. spørgsmål, så tag endelig kontakt til mig'},
  {id:'second',name:'Opfølgning 2 – genoptag dialog',subject:'Opfølgning på tilbud nr. {{offer.number}}',body_text:'Hej {{contact.first_name}}\n\nVi har tidligere forsøgt at følge op på vores tilbud nr. {{offer.number}}, men har desværre endnu ikke hørt fra dig.\n\nJeg tillader mig derfor at følge op endnu en gang i håb om, at vi kan genoptage dialogen.\n\nHar du spørgsmål til tilbuddet eller ønsker at drøfte det nærmere, er du naturligvis altid velkommen til at kontakte mig, Thomas eller Per.\n\nJeg ser frem til at høre fra dig.'}
];
const sentence=dates.sentence('2026-12-07');
assert.equal(sentence,'Såfremt vi ikke hører fra dig inden da, følger vi op igen omkring den 7. december 2026.');
for(const bad of ['', '2026-02-30','2026-13-01','2026-2-01','not-a-date'])assert.equal(dates.validDate(bad),false);
assert.equal(dates.format('2028-02-29'),'29. februar 2028');
assert.equal(dates.today(new Date('2026-11-25T23:30:00Z')),'2026-11-26');
assert.equal(dates.today(new Date('2026-07-01T22:30:00Z')),'2026-07-02');
for(const [base,n,expected] of [['2026-03-28',7,'2026-04-04'],['2026-10-24',7,'2026-10-31'],['2026-12-25',14,'2027-01-08'],['2028-02-28',1,'2028-02-29']])assert.equal(dates.addDays(base,n),expected);
for(const ending of ['Med venlig hilsen','Venlig hilsen','Mvh.','De bedste hilsner','Ser frem til at høre fra dig.']){
  const body='Hej Test\n\nMin egen tekst.\n\n'+ending+'\nJesper';
  const next=dates.upsert(body,'2026-12-07');
  assert(next.indexOf(sentence)<next.indexOf(ending));
  assert.equal(next.replace(sentence+'\n\n',''),body);
  assert.equal(dates.upsert(next,'2026-12-07'),next);
}
assert.equal((dates.upsert(sentence+'\n\n'+sentence,'2027-01-11').match(/Såfremt/g)||[]).length,1);
assert(!dates.upsert(sentence,'').includes('december'));
assert.equal(dates.upsert('','2026-12-07'),'');
const crlf='Hej\r\n\r\nMin tekst\r\n\r\nMed venlig hilsen\r\nJesper';
assert.equal(dates.upsert(crlf,'2026-12-07').replace(sentence+'\r\n\r\n',''),crlf);

class Events{
  constructor(){this.listeners={};}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
  dispatchEvent(e){if(!e.target)e.target=this;for(const fn of this.listeners[e.type]||[])fn(e);if(e.bubbles&&this.ownerDocument)this.ownerDocument.dispatchEvent(e);return true}
}
class Event{constructor(type,options={}){this.type=type;Object.assign(this,options)}preventDefault(){}stopPropagation(){}}
function environment(){
  const document=new Events(),window=new Events(),nodes={};
  document.getElementById=id=>nodes[id]||null;
  for(const id of ['offerMailBody','offerMailFollow','offerMailSubject','offerMailTo','offerMailContactName','offerMailModal','sendOfferMail','mBody','mSubject']){
    nodes[id]=Object.assign(new Events(),{id,value:'',dataset:{},style:{},classList:{contains:()=>true},focus(){},ownerDocument:document});
  }
  nodes.offerMailTo.value='test@example.invalid';nodes.offerMailSubject.value='Test';nodes.offerMailFollow.value='2026-12-07';
  const fields={};
  nodes.offerMailFollow.closest=()=>fields.follow;
  fields.follow={actions:null,querySelector(){return this.actions},appendChild(el){this.actions=el}};
  document.createElement=()=>({dataset:{},style:{},buttons:[7,14].map(n=>Object.assign(new Events(),{dataset:{dateShift:String(n)}})),querySelectorAll(){return this.buttons}});
  window.document=document;
  const context={window,document,console,Intl,Date,Event,CustomEvent:Event,setTimeout:()=>0,clearTimeout(){},byId:id=>nodes[id]||null};
  vm.createContext(context);vm.runInContext(read('followup-date-v1.js'),context);
  return {context,nodes,window,document,fields};
}
function extract(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return source.slice(a,b)}
const env=environment();
env.context.templates=templates;
env.context.resolve=text=>text.replaceAll('{{contact.first_name}}','Test').replaceAll('{{offer.number}}','9999');
vm.runInContext(extract(read('mail-templates-v1.js'),'  function applyTemplate(','  function ensureComposerControls(')+';this.apply=applyTemplate;',env.context);
vm.runInContext(read('date-picker-click-v1.js'),env.context);
for(const t of templates){
  env.context.apply('offer',t.id);
  assert.equal((env.nodes.offerMailBody.value.match(/Såfremt/g)||[]).length,1,t.name);
  assert(env.nodes.offerMailBody.value.includes(sentence));
  const edited=env.nodes.offerMailBody.value.replace('Hej Test','Hej Test\n\nMin egen aftale: ring efter frokost.');
  env.nodes.offerMailBody.value=edited;env.nodes.offerMailFollow.value='2027-01-11';
  env.nodes.offerMailFollow.dispatchEvent(new Event('input',{bubbles:true}));
  assert.equal(env.nodes.offerMailBody.value,edited.replace(sentence,dates.sentence('2027-01-11')));
  env.nodes.offerMailFollow.dispatchEvent(new Event('change',{bubbles:true}));
  assert.equal((env.nodes.offerMailBody.value.match(/Såfremt/g)||[]).length,1);
  env.fields.follow.actions.buttons[0].dispatchEvent(new Event('click'));
  assert.equal(env.nodes.offerMailFollow.value,'2027-01-18');assert(env.nodes.offerMailBody.value.includes('18. januar 2027'));
  env.fields.follow.actions.buttons[1].dispatchEvent(new Event('click'));
  assert.equal(env.nodes.offerMailFollow.value,'2027-02-01');assert(env.nodes.offerMailBody.value.includes('1. februar 2027'));
  assert(env.nodes.offerMailBody.value.includes('Min egen aftale: ring efter frokost.'));
  env.nodes.offerMailFollow.value='2026-12-07';
}
for(let i=0;i<10;i++){
  env.context.apply('offer',templates[i%2].id);
  assert.equal((env.nodes.offerMailBody.value.match(/Såfremt/g)||[]).length,1);
}
// Future templates work without modifying database rows or a hardcoded template list.
templates.push({id:'future',subject:'Test',body_text:'Hej Test\n\nEn helt ny skabelon.\n\nVenlig hilsen\nJesper'});
env.context.apply('offer','future');assert(env.nodes.offerMailBody.value.includes(sentence));
env.context.apply('lead','future');assert(!env.nodes.mBody.value.includes('Såfremt'));
env.nodes.offerMailBody.value='Hej Test\n\nManuel mail.';env.window.dispatchEvent(new Event('lm:offer-mail-opened'));
assert(env.nodes.offerMailBody.value.includes(sentence));

async function sendTest(kind,invalid=false){
  const e=environment(),c=e.context;
  e.nodes.offerMailBody.value='Hej Test\n\nManuel tekst.\n\nVenlig hilsen\nJesper';
  if(invalid)e.nodes.offerMailFollow.value='';
  const o={id:'offer-test',offer_ref:'9999',contact_details:'test@example.invalid'};
  let payload=null,finished=null;
  Object.assign(c,{offer:()=>o,state:{client:{id:'test-tenant'},offers:[]},
    pdfSendState:'idle',sendState:'idle',currentPdfSendId:'test-id',currentSendId:'test-id',
    syncContactName(){},bounced:()=>false,bouncedContact:()=>false,rawAddressCandidates:()=>[],unsafeDeliveryEmails:()=>[],lower:x=>x,
    pdfName:()=> 'Tilbud 9999.pdf',sender:()=> 'sender@example.invalid',toast(){},alert:m=>{throw new Error(m)},confirm:()=>true,
    checkSuppressionStatus:async()=>({blocked:false}),verifyMinubaStillActiveForFollowUp:async()=>({ok:true}),
    checkPdfStatus:async()=>{e.nodes.offerMailFollow.value='2027-01-11';e.nodes.offerMailBody.value+='\nPS: Min ændring under PDF-kontrol.';return {ready:true}},
    recipientKey:(offer,to)=>offer?.id+'|'+to,makeSendId:()=> 'test-id',savePendingSend(){},renderSendStatus(){},
    recipientConfirmation:()=>null,invoiceMailboxConfirmation:()=>null,invoiceMailboxApproval:null,invoiceMailboxAction:null,suppressionLoading:false,suppressionBlocked:false,
    ensureAttachmentRow(){},friendlyMailError:e=>{throw e},clearPendingSend(){},
    callProtectedEdge:async(name,args)=>{payload=args;return {data:{status:'sent',follow_up_date:args.follow_up_date}}},
    isSentResult:d=>d?.status==='sent',sleep:()=>new Promise(()=>{}),
    finishPdfSend:async(offer,to,data,name,follow)=>{finished=follow},finishSuccessfulSend:async(offer,name,to,follow)=>{finished=follow}
  });
  const source=read(kind==='pdf'?'offer-mail-pdf-v1.js':'offer-mail-v1.js');
  const start=kind==='pdf'?'  async function sendWithPdf(':'  async function sendMail(';
  const end=kind==='pdf'?'  function handleOfferMailPrimary(':'  function scheduleButton(';
  vm.runInContext(extract(source,start,end)+`;this.send=${kind==='pdf'?'sendWithPdf':'sendMail'};`,c);
  await c.send();
  if(invalid){assert.equal(payload,null);return}
  assert(payload,kind+' did not call mocked sender');
  assert.equal(payload.follow_up_date,kind==='pdf'?'2027-01-11':'2026-12-07');
  assert(payload.body.includes(dates.sentence(payload.follow_up_date)));
  assert.equal((payload.body.match(/Såfremt/g)||[]).length,1);
  assert.equal(finished,payload.follow_up_date);
  if(kind==='pdf')assert(payload.body.includes('PS: Min ændring under PDF-kontrol.'));
}
(async()=>{
  for(const kind of ['pdf','direct']){await sendTest(kind);await sendTest(kind,true)}
  console.log('PASS: both production templates, fallback/future templates, template switches, manual edits, actual +7/+14 buttons, opening, invalid dates, Danish timezone/DST/year/leap boundaries and both mocked send paths. Zero network calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
