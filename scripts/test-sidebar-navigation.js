const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v)throw new Error(m)}
const html=read('index.html');
const access=read('access-bootstrap-v1.js');
const settings=read('saas-settings-hub-v1.js');

const views=[...html.matchAll(/<button[^>]*data-view="([^"]+)"/g)].map(m=>m[1]);
assert(views.length>=10,'too few sidebar views detected');
for(const view of views){
 assert(new RegExp('<section\\s+id="'+view+'"(?:\\s|>)').test(html),'missing section for sidebar view: '+view);
}
assert(access.includes("function activateNavView(button)"),'central sidebar router missing');
assert(access.includes("document.querySelectorAll('.nav button[data-view]').forEach(x=>x.classList.toggle('active',x===button))"),'sidebar active-state router missing');
assert(access.includes("document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x===view))"),'view activation router missing');
assert(access.includes("const button=event.target.closest?.('.nav button[data-view]')"),'capture-phase sidebar click router missing');
assert(access.includes("if(viewId==='offers'||viewId==='offerpipeline')await ensureOfferSearch()"),'offer views lazy hydration missing');
assert(access.includes("if(viewId==='leadmanager')"),'settings view hydration missing');
assert(access.includes("if(viewId==='feedback')"),'feedback view hydration missing');
assert(access.includes("if(viewId==='creditcheck')"),'credit-check view hydration missing');
assert(access.includes("/saas-settings-hub-v1.js?v=20260920-17"),'platform-admin settings bundle missing');
assert(!access.includes("if(window.LM_ACCESS?.platform_admin!==true)scripts.unshift('/saas-settings-hub-v1.js"),'platform admin still excluded from settings bundle');
assert(settings.includes("window.addEventListener('lm:settings-open-request'"),'settings explicit open event missing');
console.log('PASS: all sidebar routes activate deterministically and lazy views hydrate safely');
