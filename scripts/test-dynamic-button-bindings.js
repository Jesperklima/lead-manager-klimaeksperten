const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}
function escRe(s){return s.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')}

const targets=[
  ['index.html',true],
  ['saas-customer-controls-v1.js',false],
  ['saas-settings-hub-v1.js',false],
  ['saas-feedback-v1.js',false],
  ['saas-credit-check-v1.js',false]
];

for(const [path,hasStaticHtml] of targets){
  const src=fs.readFileSync(path,'utf8');
  const staticHtml=hasStaticHtml?src.replace(/<script\b[\s\S]*?<\/script>/gi,''):'';
  const ids=[...new Set([...src.matchAll(/<button\b[^>]*\bid=[\"']([^\"']+)[\"']/g)].map(m=>m[1]))];
  for(const id of ids){
    if(hasStaticHtml&&new RegExp('<button\\b[^>]*\\bid=\"'+escRe(id)+'\"').test(staticHtml))continue;
    const count=(src.match(new RegExp(escRe(id),'g'))||[]).length;
    must(count>=2,'dynamic button id appears without any second code reference in '+path+': '+id);
  }
}

const html=fs.readFileSync('index.html','utf8');
must(html.includes("document.getElementById('lmOpenDue')?.addEventListener('click'"),'Dashboard follow-up button is not wired');
must(html.includes('.nav button[data-view=\"calendar\"]'),'Dashboard follow-up button does not route to Calendar');
must(html.includes('id=\"lmOpenNext\"'),'missing dashboard action button lmOpenNext');
must(html.includes('id=\"lmOpenCalls\"'),'missing dashboard action button lmOpenCalls');
must(html.includes('id=\"lmOpenDue\"'),'missing dashboard action button lmOpenDue');
must(html.includes('openLead(next.id)'),'missing action marker for lmOpenNext');
must(html.includes('data-view=\"pipeline\"'),'missing action marker for lmOpenCalls');
must(html.includes('data-view=\"calendar\"'),'missing action marker for lmOpenDue');

console.log('PASS: dynamic button IDs are referenced after render and dashboard actions are wired');
