const fs=require('fs');
const vm=require('vm');

class FakeDate extends Date{
  constructor(value){super(arguments.length?value:'2026-01-01T12:00:00Z')}
  static now(){return new Date('2026-01-01T12:00:00Z').getTime()}
}

function element(){
  const classes=new Set();
  return {
    innerHTML:'',textContent:'',dataset:{},
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),toggle:()=>{}},
    hasClass:value=>classes.has(value)
  };
}

const ids={};
for(const id of ['executiveMetrics','executiveAttention','executivePerformance','executivePipeline','executiveActivity','executivePeriodTitle','executivePeriodText','loading'])ids[id]=element();

const leadCounts={NY:17,AFVENTER:3,DIALOG:2,'I GANG':8,'KLAR TIL KONTAKT':1,'IKKE RELEVANT':3,TABT:3};
const leads=Object.entries(leadCounts).flatMap(([status,count])=>Array.from({length:count},(_,index)=>({
  id:`${status}-${index}`,
  company_id:`company-${status}-${index}`,
  status,
  created_at:'2026-08-24T08:00:00Z',
  updated_at:'2026-08-28T09:00:00Z',
  next_at:null,
  next_action:'Følg op'
})));
const offers=Array.from({length:14},(_,index)=>({id:`offer-${index}`,company_id:`offer-company-${index}`,status:'I GANG',sent_date:'2026-08-24',updated_at:'2026-08-28T09:00:00Z',follow_up_date:'2026-09-02'}));

const context={
  Date:FakeDate,
  setInterval:()=>0,
  performance:{now:()=>1000},
  location:{origin:'https://lead-manager-klimaeksperten.vercel.app'},
  fetch:async()=>({headers:{get:name=>name==='date'?'Tue, 01 Sep 2026 12:00:00 GMT':null}}),
  document:{
    readyState:'complete',
    getElementById:id=>ids[id]||null,
    querySelectorAll:()=>[],
    querySelector:()=>null,
    addEventListener:()=>{}
  },
  state:{
    client:{id:'client-1'},
    leads,
    offers,
    approvals:[],
    activities:[{id:'activity-1',company_id:'company-1',type:'Opkald',summary:'Talte med kunden',created_at:'2026-09-01T09:30:00Z'}]
  },
  company:()=>({name:'Testkunde'}),
  leadName:()=> 'Testkunde',
  fmt:value=>value,
  console
};
context.window=context;

vm.runInNewContext(fs.readFileSync('executive-dashboard-v1.js','utf8'),context,{filename:'executive-dashboard-v1.js'});

setTimeout(()=>{
  const values=[...ids.executiveMetrics.innerHTML.matchAll(/executive-metric-value">(\d+)/g)].map(match=>Number(match[1]));
  if(values.join(',')!=='17,14,2,14,0')throw new Error(`Dashboardet afspejler ikke den aktuelle CRM-status: ${values.join(',')}`);
  if(!ids.loading.hasClass('hidden'))throw new Error('Indlæsningsbeskeden blev ikke skjult efter rendering');
  if(!ids.executiveActivity.innerHTML.includes('Talte med kunden'))throw new Error('Aktiviteter fra serverens aktuelle dag mangler');
  console.log('PASS: current CRM status survives old record dates, incorrect device date and loading closes');
},0);
