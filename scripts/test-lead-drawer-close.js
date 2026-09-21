const fs=require('fs');
const vm=require('vm');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');

must(html.includes("function closeLeadDrawer()"),'central lead drawer close function missing');
must(html.includes("e.target.closest?.('#closeDrawer')"),'delegated close button handler missing');
must(html.includes("e.key!=='Escape'"),'Escape close handler missing');
must(!html.includes("$('closeDrawer').onclick=()=>"),'fragile direct close handler returned');

const start=html.indexOf('function closeLeadDrawer(){');
const end=html.indexOf("\ndocument.addEventListener('click'",start);
must(start>=0&&end>start,'closeLeadDrawer function could not be extracted');
const fnSource=html.slice(start,end);

const drawer={
  scrollTop:123,
  classList:{
    set:new Set(['open']),
    remove(v){this.set.delete(v)},
    contains(v){return this.set.has(v)}
  }
};
let currentLead={id:'lead-123'};
const events=[];
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}}
const ctx={
  CustomEvent,
  window:{dispatchEvent(e){events.push(e)}},
  $:id=>id==='drawer'?drawer:null,
  currentLead
};
vm.createContext(ctx);
vm.runInContext(fnSource,ctx);
vm.runInContext('closeLeadDrawer()',ctx);

must(!drawer.classList.contains('open'),'drawer stayed open after close');
must(drawer.scrollTop===0,'drawer scroll position was not reset');
must(vm.runInContext('currentLead===null',ctx),'currentLead was not cleared');
must(events.length===1&&events[0].type==='lm:lead-closed','lead-closed event missing');
must(events[0].detail.lead_id==='lead-123','closed lead id missing from event');

console.log('PASS: lead drawer closes resiliently and clears active lead state');
