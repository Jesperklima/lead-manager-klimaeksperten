const fs=require('fs');
const vm=require('vm');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');

must(html.includes('onclick="return closeLeadDrawer(event)"'),'direct close-button fallback missing');
must(html.includes("function closeLeadDrawer(event)"),'central lead drawer close function missing');
must(html.includes("e.target.closest?.('#closeDrawer')"),'delegated close button handler missing');
must(html.includes("e.key!=='Escape'"),'Escape close handler missing');
must(html.includes("drawer.style.setProperty('right','-100vw','important')"),'hard offscreen close missing');
must(html.includes("drawer.style.setProperty('visibility','hidden','important')"),'hard visibility close missing');
must(html.includes("drawer.style.setProperty('pointer-events','none','important')"),'hard pointer close missing');
must(html.includes("drawer.setAttribute('aria-hidden','true')"),'aria hidden close missing');
must(html.includes("drawer.style.removeProperty('right')"),'openLead does not clear hard-close right');
must(html.includes("drawer.style.removeProperty('transform')"),'openLead does not clear hard-close transform');
must(html.includes("drawer.style.removeProperty('visibility')"),'openLead does not clear hard-close visibility');
must(html.includes("drawer.style.removeProperty('pointer-events')"),'openLead does not clear hard-close pointer state');
must(html.includes("drawer.setAttribute('aria-hidden','false')"),'openLead does not restore aria state');
must(!html.includes("$('closeDrawer').onclick=()=>"),'fragile old direct close handler returned');

const start=html.indexOf('function closeLeadDrawer(event){');
const end=html.indexOf("\ndocument.addEventListener('click'",start);
must(start>=0&&end>start,'closeLeadDrawer function could not be extracted');
const fnSource=html.slice(start,end);

const styleMap=new Map();
const drawer={
  scrollTop:123,
  attrs:{},
  classList:{
    set:new Set(['open']),
    remove(v){this.set.delete(v)},
    contains(v){return this.set.has(v)}
  },
  style:{
    setProperty(k,v,p){styleMap.set(k,{v,p})},
    removeProperty(k){styleMap.delete(k)}
  },
  setAttribute(k,v){this.attrs[k]=v}
};
let currentLead={id:'lead-123'};
const events=[];
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}}
const ctx={
  Date,
  CustomEvent,
  document:{getElementById:id=>id==='drawer'?drawer:null},
  window:{dispatchEvent(e){events.push(e)}},
  currentLead
};
vm.createContext(ctx);
vm.runInContext(fnSource,ctx);
vm.runInContext('closeLeadDrawer()',ctx);

must(!drawer.classList.contains('open'),'drawer stayed open after close');
must(drawer.scrollTop===0,'drawer scroll position was not reset');
must(drawer.attrs['aria-hidden']==='true','drawer aria-hidden was not set');
must(styleMap.get('right')?.v==='-100vw','drawer was not forced offscreen');
must(styleMap.get('transform')?.v==='translateX(110%)','drawer transform fallback missing');
must(styleMap.get('visibility')?.v==='hidden','drawer was not hidden');
must(styleMap.get('pointer-events')?.v==='none','drawer pointer events were not disabled');
must(vm.runInContext('currentLead===null',ctx),'currentLead was not cleared');
must(events.length===1&&events[0].type==='lm:lead-closed','lead-closed event missing');
must(events[0].detail.lead_id==='lead-123','closed lead id missing from event');

console.log('PASS: lead drawer hard-close fallback hides panel, clears state and can be reset on next open');
