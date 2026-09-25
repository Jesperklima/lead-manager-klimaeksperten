const fs=require('fs');
const vm=require('vm');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');
const access=fs.readFileSync('access-bootstrap-v1.js','utf8');
must(!html.includes('<script src="/saas-onboarding-v4.js'),'legacy onboarding v4 static startup returned');

const views=[...html.matchAll(/<button[^>]*data-view="([^"]+)"/g)].map(m=>m[1]);
must(views.length>=14,'expected full sidebar navigation');
must(new Set(views).size===views.length,'duplicate sidebar view button');
for(const view of views)must(new RegExp('<section\\s+id="'+view+'"(?:\\s|>)').test(html),'missing target section: '+view);

const start=access.indexOf('function activateNavView(button){');
const end=access.indexOf('\n\nasync function hydrateNavView',start);
must(start>=0&&end>start,'activateNavView implementation missing');
const fnSource=access.slice(start,end);

function classList(){
  const set=new Set();
  return {
    toggle(name,on){if(on)set.add(name);else set.delete(name)},
    contains(name){return set.has(name)},
    add(name){set.add(name)},
    remove(name){set.delete(name)}
  };
}
const buttons=views.map(view=>({dataset:{view},textContent:view,classList:classList()}));
const sections=views.map(id=>({id,classList:classList()}));
const title={textContent:''};
const events=[];
const document={
  getElementById(id){return id==='title'?title:sections.find(x=>x.id===id)||null},
  querySelectorAll(sel){
    if(sel==='.nav button[data-view]')return buttons;
    if(sel==='.view')return sections;
    return [];
  }
};
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}}
const window={dispatchEvent(e){events.push(e)}};
const ctx={document,window,CustomEvent,String,setText:(id,value)=>{if(id==='title')title.textContent=value}};
const activate=vm.runInNewContext(fnSource+'\nactivateNavView',ctx);

for(const button of buttons){
  must(activate(button)===true,'navigation refused '+button.dataset.view);
  const activeButtons=buttons.filter(x=>x.classList.contains('active'));
  const activeViews=sections.filter(x=>x.classList.contains('active'));
  must(activeButtons.length===1,'multiple/no active nav buttons after '+button.dataset.view);
  must(activeViews.length===1,'multiple/no active views after '+button.dataset.view);
  must(activeButtons[0]===button,'wrong active nav button after '+button.dataset.view);
  must(activeViews[0].id===button.dataset.view,'wrong active view after '+button.dataset.view);
  must(title.textContent===button.textContent.trim(),'title not updated for '+button.dataset.view);
}
must(events.filter(e=>e.type==='lm:navigation-changed').length===buttons.length,'navigation change event count mismatch');
must(activate({dataset:{view:'does-not-exist'},textContent:'bad',classList:classList()})===false,'unknown view should be rejected');

for(const marker of [
  "if(viewId==='leadmanager')",
  "if(viewId==='feedback')",
  "if(viewId==='creditcheck')",
  "if(viewId==='offers'||viewId==='offerpipeline')await ensureOfferSearch()"
]) must(access.includes(marker),'lazy navigation marker missing: '+marker);

const interactionMarkers=[
  ["loginBtn","$('loginBtn').onclick="],
  ["logoutBtn","$('logoutBtn').onclick="],
  ["refreshBtn","$('refreshBtn').onclick="],
  ["newLead","$('newLead').onclick="],
  ["pipeline navigation","function wirePipelineNavigation()"],
  ["pipeline left","left.onclick=()=>board.scrollBy"],
  ["pipeline right","right.onclick=()=>board.scrollBy"],
  ["pipeline compact","compact.onclick=()=>"],
  ["offer pipeline left","qid('offerPipelineLeft')?.addEventListener('click'"],
  ["offer pipeline right","qid('offerPipelineRight')?.addEventListener('click'"],
  ["calendar prev","$('prevWeek').onclick="],
  ["calendar current","$('thisWeek').onclick="],
  ["calendar next","$('nextWeek').onclick="],
  ["report load","qid('reportLoad')?.addEventListener('click'"],
  ["report ranges","document.querySelectorAll('[data-report-range]').forEach"],
  ["drawer close","function closeLeadDrawer()"],
  ["lead save","$('saveLead').onclick="],
  ["new lead cancel","$('cancelNew').onclick="],
  ["new lead create","$('createNew').onclick="],
  ["offer cancel","$('cancelOffer').onclick="],
  ["offer save","$('saveOffer').onclick="],
  ["mail cancel","id=\"mailDialogCloseForm\""],
  ["mail queue","$('queueMail').onclick="]
];
for(const [name,marker] of interactionMarkers)must(html.includes(marker),name+' handler missing');

const staticHtml=html.replace(/<script\b[\s\S]*?<\/script>/gi,'');
const staticButtons=[...staticHtml.matchAll(/<button\b([^>]*)>/gi)];
must(staticButtons.length>=70,'unexpectedly few static controls');
for(const m of staticButtons){
  const attrs=m[1];
  const id=(attrs.match(/\bid="([^"]+)"/)||[])[1];
  const view=(attrs.match(/\bdata-view="([^"]+)"/)||[])[1];
  const data=[...attrs.matchAll(/\b(data-[\w-]+)/g)].map(x=>x[1]);
  must(id||view||data.length>0,'unaddressable static button: '+attrs.slice(0,120));
  if(id){
    const safe=id.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
    must((html.match(new RegExp(safe,'g'))||[]).length>=2,'button id has no code reference: '+id);
  }
}

const offerDateSave=fs.readFileSync('offer-date-save-v1.js','utf8');
must(!offerDateSave.includes('.maybeSingle('),'unsupported maybeSingle returned to offer date save flow');
must(offerDateSave.includes(".eq('id',offerId).eq('client_id',clientId).limit(1)"),'offer date verification is not bounded to one tenant-scoped row');
must(offerDateSave.includes(".select('id,client_id,status,follow_up_date,current_comment').single()"),'offer date update does not return one persisted tenant-scoped row');
must(offerDateSave.includes('Array.isArray(r.data)?r.data[0]:r.data'),'offer date verification does not normalize array response');

console.log('PASS: full interaction surface, sequential sidebar switching, and primary button bindings');
