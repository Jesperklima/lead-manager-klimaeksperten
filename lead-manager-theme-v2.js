(()=>{
  'use strict';

  const ICONS={
    dashboard:'<path d="M3 3h7v7H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 14h7v7H3z"/>',
    leads:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    pipeline:'<path d="M4 5h16M7 12h10M10 19h4"/><circle cx="4" cy="5" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="10" cy="19" r="1"/>',
    offers:'<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
    offerpipeline:'<path d="M4 4h5v16H4zM10 8h5v12h-5zM16 12h4v8h-4z"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    activity:'<path d="M4 12h4l2-5 4 10 2-5h4"/><path d="M3 20h18"/>',
    activityReport:'<path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/>',
    approvals:'<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    leadmanager:'<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="8"/>',
    agents:'<path d="M8 3h8l1 4 4 2v6l-4 2-1 4H8l-1-4-4-2V9l4-2z"/><circle cx="12" cy="12" r="3"/>'
  };

  function svg(path){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
  }

  function enhanceBrand(){
    const brand=document.querySelector('.brand');
    if(!brand||brand.dataset.lmV2==='1')return;
    brand.dataset.lmV2='1';
    brand.setAttribute('aria-label','Lead Manager');

    const previous=brand.innerHTML;
    brand.innerHTML='';

    const logo=document.createElement('img');
    logo.className='lm-brand-logo';
    logo.alt='Lead Manager';
    logo.decoding='async';

    const fallback=document.createElement('span');
    fallback.className='lm-brand-fallback';
    fallback.textContent='Lead Manager';

    brand.appendChild(logo);
    brand.appendChild(fallback);

    const logoParts=[
      '/assets/lead-manager-logo.b64.0',
      '/assets/lead-manager-logo.b64.1',
      '/assets/lead-manager-logo.b64.2a',
      '/assets/lead-manager-logo.b64.2b',
      '/assets/lead-manager-logo.b64.2c',
      '/assets/lead-manager-logo.b64.3'
    ];
    const parts=logoParts.map(url=>
      fetch(url+'?v=20260918-2',{cache:'force-cache'})
        .then(response=>{
          if(!response.ok)throw new Error('Logo asset kunne ikke hentes: '+url);
          return response.text();
        })
    );

    Promise.all(parts).then(chunks=>{
      logo.onload=()=>brand.classList.add('lm-brand-ready');
      logo.onerror=()=>{brand.innerHTML=previous;};
      logo.src='data:image/png;base64,'+chunks.join('');
    }).catch(error=>{
      console.warn('Lead Manager-logo kunne ikke indlæses',error);
      brand.innerHTML=previous;
    });
  }

  function enhanceNav(){
    document.querySelectorAll('.nav button[data-view]').forEach(button=>{
      if(button.querySelector('.lm-nav-icon'))return;
      const key=button.dataset.view;
      const icon=document.createElement('span');
      icon.className='lm-nav-icon';
      icon.innerHTML=svg(ICONS[key]||ICONS.dashboard);
      button.prepend(icon);
    });
  }

  const searchByView={
    leads:'leadSearch',
    offers:'offerSearch',
    offerpipeline:'offerPipelineSearch',
    mail:'mailSearch'
  };

  function activeView(){
    return document.querySelector('.view.active')?.id||'dashboard';
  }

  function applySearch(value){
    const view=activeView();
    const targetId=searchByView[view];
    if(targetId){
      const target=document.getElementById(targetId);
      if(target){
        target.value=value;
        target.dispatchEvent(new Event('input',{bubbles:true}));
        target.dispatchEvent(new Event('change',{bubbles:true}));
        return true;
      }
    }
    return false;
  }

  function enhanceTop(){
    const top=document.querySelector('.top');
    if(!top||top.querySelector('.lm-global-search'))return;
    const search=document.createElement('label');
    search.className='lm-global-search';
    search.setAttribute('aria-label','Søg i Lead Manager');
    search.innerHTML=svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')+'<input id="lmGlobalSearch" autocomplete="off" placeholder="Søg efter leads, tilbud eller mails…"><span class="lm-search-hint">⌘ K</span>';
    const actions=top.querySelector('.topactions');
    if(actions)top.insertBefore(search,actions);else top.appendChild(search);
    const input=search.querySelector('input');
    input.addEventListener('input',()=>applySearch(input.value));
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!applySearch(input.value)&&input.value.trim()){
        document.querySelector('.nav button[data-view="leads"]')?.click();
        requestAnimationFrame(()=>applySearch(input.value));
      }
      if(event.key==='Escape'){input.value='';applySearch('');input.blur();}
    });
    document.addEventListener('keydown',event=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();input.focus();input.select();
      }
    });
  }

  function syncSearchPlaceholder(){
    const input=document.getElementById('lmGlobalSearch');
    if(!input)return;
    const view=activeView();
    const labels={
      dashboard:'Søg efter leads, tilbud eller mails…',
      leads:'Søg i leads…',
      offers:'Søg i tilbud…',
      offerpipeline:'Søg i tilbudspipeline…',
      mail:'Søg i mailjournal…'
    };
    input.placeholder=labels[view]||'Søg i Lead Manager…';
  }

  function observeViews(){
    const shell=document.getElementById('appShell');
    if(!shell)return;
    const observer=new MutationObserver(mutations=>{
      if(mutations.some(m=>m.type==='attributes'&&m.attributeName==='class'))syncSearchPlaceholder();
    });
    document.querySelectorAll('.view').forEach(view=>observer.observe(view,{attributes:true}));
    document.querySelectorAll('.nav button').forEach(button=>button.addEventListener('click',()=>requestAnimationFrame(syncSearchPlaceholder)));
  }

  function init(){
    document.documentElement.classList.add('lm-theme-v2');
    document.body.classList.add('lm-theme-v2');
    enhanceBrand();
    enhanceNav();
    enhanceTop();
    observeViews();
    syncSearchPlaceholder();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();