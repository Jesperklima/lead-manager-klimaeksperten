(()=>{
  'use strict';

  const TARGET_IDS=new Set(['oFollow','offerMailFollow']);

  function formatDate(value){
    if(!value)return '';
    const d=new Date(value+'T12:00:00');
    if(Number.isNaN(d.getTime()))return value;
    return new Intl.DateTimeFormat('da-DK',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  }

  function setValue(input,value){
    input.value=value;
    input.dataset.userDate=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function bind(input){
    if(!input||input.dataset.nativeOfferDate==='1')return;
    input.dataset.nativeOfferDate='1';

    // IMPORTANT: do not intercept click, pointerdown or normal date-field keys.
    // Chromium's native date control must receive those events itself so the
    // user can both type in the field and select a date from the calendar.
    input.style.cursor='text';

    input.addEventListener('input',()=>{
      input.dataset.userDate=input.value||'';
    });
    input.addEventListener('change',()=>{
      input.dataset.userDate=input.value||'';
      const note=input.closest('.field')?.querySelector('[data-offer-date-choice]');
      if(note)note.textContent=input.value?`Valgt dato: ${formatDate(input.value)}`:'';
    });

    const field=input.closest('.field');
    if(!field||field.querySelector(`[data-date-picker-for="${input.id}"]`))return;

    const actions=document.createElement('div');
    actions.dataset.datePickerFor=input.id;
    actions.style.cssText='display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:7px';
    actions.innerHTML=`<button type="button" class="btn small" data-date-shift="7">+7 dage</button><button type="button" class="btn small" data-date-shift="14">+14 dage</button><span class="sub" data-offer-date-choice></span>`;
    field.appendChild(actions);

    actions.querySelectorAll('[data-date-shift]').forEach(button=>button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      const days=Number(button.dataset.dateShift||0);
      const base=input.value?new Date(input.value+'T12:00:00'):new Date();
      if(Number.isNaN(base.getTime()))return;
      base.setDate(base.getDate()+days);
      const value=[base.getFullYear(),String(base.getMonth()+1).padStart(2,'0'),String(base.getDate()).padStart(2,'0')].join('-');
      setValue(input,value);
    }));
  }

  function scan(){
    TARGET_IDS.forEach(id=>bind(document.getElementById(id)));
  }

  scan();
  new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',()=>setTimeout(scan,0),true);
  setInterval(scan,800);
})();
