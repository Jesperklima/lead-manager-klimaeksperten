(()=>{
'use strict';
const STORAGE_KEY='lm_recent_responses_collapsed_v1';
function setup(){
  const responses=document.getElementById('lmResponses');
  if(!responses)return;
  const card=responses.closest('.card');
  if(!card||card.dataset.responseCollapseReady==='1')return;
  const heading=card.querySelector('h2');
  if(!heading)return;
  card.dataset.responseCollapseReady='1';
  card.id=card.id||'lmRecentResponsesCard';

  const bar=document.createElement('div');
  bar.className='lm-response-head';
  heading.parentNode.insertBefore(bar,heading);
  bar.appendChild(heading);

  const btn=document.createElement('button');
  btn.type='button';
  btn.className='btn small';
  btn.id='lmToggleRecentResponses';
  bar.appendChild(btn);

  const parent=card.parentElement;
  const apply=collapsed=>{
    responses.hidden=collapsed;
    card.classList.toggle('lm-response-collapsed',collapsed);
    parent?.classList.toggle('lm-response-grid-collapsed',collapsed);
    btn.textContent=collapsed?'Vis svar':'Minimér';
    btn.setAttribute('aria-expanded',collapsed?'false':'true');
    btn.title=collapsed?'Vis seneste svar':'Minimér seneste svar';
    try{localStorage.setItem(STORAGE_KEY,collapsed?'1':'0')}catch{}
  };

  let collapsed=false;
  try{collapsed=localStorage.getItem(STORAGE_KEY)==='1'}catch{}
  apply(collapsed);
  btn.addEventListener('click',()=>apply(!responses.hidden));
}

function style(){
  if(document.getElementById('lmResponsePanelStyle'))return;
  const s=document.createElement('style');
  s.id='lmResponsePanelStyle';
  s.textContent=`
    .lm-response-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    .lm-response-head h2{margin:0!important}
    #lmRecentResponsesCard.lm-response-collapsed{padding:12px 14px!important;align-self:start}
    #lmRecentResponsesCard.lm-response-collapsed .lm-response-head{margin-bottom:0}
    @media(min-width:901px){.lm-response-grid-collapsed{grid-template-columns:minmax(0,1fr) 190px!important}}
  `;
  document.head.appendChild(s);
}

function boot(){style();setup()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
document.addEventListener('click',e=>{if(e.target.closest?.('.nav button[data-view="leadmanager"]'))setTimeout(setup,0)},true);
})();
