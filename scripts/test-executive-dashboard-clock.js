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
    leads:[{id:'lead-1',company_id:'company-1',status:'DIALOG',created_at:'2026-09-01T08:00:00Z',updated_at:'2026-09-01T09:00:00Z',next_at:'2026-09-01T10:00:00Z',next_action:'Ring tilbage'}],
    offers:[{id:'offer-1',company_id:'company-1',status:'I GANG',sent_date:'2026-09-01',follow_up_date:'2026-09-02'}],
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
  if(values.join(',')!=='1,1,1,1,0')throw new Error(`Forkerte nøgletal ved skæv computerklokke: ${values.join(',')}`);
  if(!ids.loading.hasClass('hidden'))throw new Error('Indlæsningsbeskeden blev ikke skjult efter rendering');
  if(!ids.executiveActivity.innerHTML.includes('Talte med kunden'))throw new Error('Aktiviteter fra serverens aktuelle dag mangler');
  console.log('PASS: server clock overrides incorrect device date and loading closes');
},0);
