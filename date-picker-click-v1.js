(()=>{
  'use strict';

  const TARGET_IDS=new Set(['oFollow','offerMailFollow']);

  function openPicker(input){
    if(!input||input.disabled||input.readOnly)return;
    try{
      input.focus({preventScroll:true});
      if(typeof input.showPicker==='function'){
        input.showPicker();
        return;
      }
    }catch(error){
      console.warn('Native date picker could not open',error);
    }
    input.focus();
  }

  function bind(input){
    if(!input||input.dataset.clickDatePicker==='1')return;
    input.dataset.clickDatePicker='1';
    input.style.cursor='pointer';

    // Open the calendar when the user clicks anywhere in the date field,
    // not only the browser's tiny calendar icon.
    input.addEventListener('click',event=>{
      if(!event.isTrusted)return;
      openPicker(input);
    },true);

    input.addEventListener('keydown',event=>{
      if(!['Enter',' ','ArrowDown'].includes(event.key))return;
      event.preventDefault();
      openPicker(input);
    });

    const field=input.closest('.field');
    if(!field||field.querySelector(`[data-date-picker-for="${input.id}"]`))return;

    const actions=document.createElement('div');
    actions.dataset.datePickerFor=input.id;
    actions.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-top:7px';
    actions.innerHTML=`<button type="button" class="btn small" data-open-date-picker>📅 Vælg dato</button><button type="button" class="btn small" data-date-shift="7">+7 dage</button><button type="button" class="btn small" data-date-shift="14">+14 dage</button>`;
    field.appendChild(actions);

    actions.querySelector('[data-open-date-picker]').addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      openPicker(input);
    });

    actions.querySelectorAll('[data-date-shift]').forEach(button=>button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      const days=Number(button.dataset.dateShift||0);
      const base=input.value?new Date(input.value+'T12:00:00'):new Date();
      if(Number.isNaN(base.getTime()))return;
      base.setDate(base.getDate()+days);
      const value=[base.getFullYear(),String(base.getMonth()+1).padStart(2,'0'),String(base.getDate()).padStart(2,'0')].join('-');
      input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }));
  }

  function scan(){
    TARGET_IDS.forEach(id=>bind(document.getElementById(id)));
  }

  document.addEventListener('pointerdown',event=>{
    const input=event.target?.closest?.('input[type="date"]');
    if(!input||!TARGET_IDS.has(input.id)||input.disabled||input.readOnly)return;
    // Use the original pointer gesture so Chromium allows showPicker().
    try{if(typeof input.showPicker==='function')input.showPicker()}catch(_){}
  },true);

  scan();
  new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',()=>setTimeout(scan,0),true);
  setInterval(scan,800);
})();