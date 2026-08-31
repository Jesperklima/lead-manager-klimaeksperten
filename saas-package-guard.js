(()=>{
  'use strict';
  const hidden=(el,yes=true)=>{if(el)el.classList.toggle('hidden',!!yes)};
  const plan=()=>window.__LM_SAAS_PLAN||null;
  const isInternal=()=>plan()?.plan_code==='internal';
  const allowed=flag=>isInternal()||!!plan()?.[flag];
  function apply(){
    const p=plan();if(!p)return;

    // Mail actions must not be reachable from lead cards in Start.
    const mailAllowed=allowed('allow_mail_monitor');
    hidden(document.getElementById('openMailComposer'),!mailAllowed);
    hidden(document.getElementById('requestInfoMail'),!mailAllowed);
    hidden(document.getElementById('requestNoContactMail'),!mailAllowed);
    document.querySelectorAll('[data-internal-mail]').forEach(x=>hidden(x,!mailAllowed));
    hidden(document.getElementById('gmailHistoryBlock'),!mailAllowed);

    // Package 1 must not see offer UI even if legacy code recreates elements.
    document.querySelectorAll('.nav button[data-view="offers"],.nav button[data-view="offerpipeline"]').forEach(x=>hidden(x,!allowed('allow_offers')));
    hidden(document.getElementById('offers'),!allowed('allow_offers'));
    hidden(document.getElementById('offerpipeline'),!allowed('allow_offer_pipeline'));
    document.querySelectorAll('[data-open-offer]').forEach(x=>hidden(x,!allowed('allow_offers')));

    // Advanced views.
    hidden(document.querySelector('.nav button[data-view="activityReport"]'),!allowed('allow_activity_report'));
    hidden(document.getElementById('activityReport'),!allowed('allow_activity_report'));
    hidden(document.querySelector('.nav button[data-view="approvals"]'),!allowed('allow_approvals'));
    hidden(document.getElementById('approvals'),!allowed('allow_approvals'));

    // Minuba is Business-only. Legacy customer cards may recreate its block.
    document.querySelectorAll('.minuba-rel').forEach(block=>{
      const section=block.closest('.customer-section');hidden(section||block,!allowed('allow_minuba'));
    });
    document.querySelectorAll('[data-minuba-refresh]').forEach(x=>hidden(x,!allowed('allow_minuba')));

    // Tender hunter is Business-only; mail agents are Pro+.
    document.querySelectorAll('#agentCards .card').forEach(card=>{
      const name=(card.querySelector('strong')?.textContent||'').trim();
      if(name==='Opportunity & Tender Hunter')hidden(card,!allowed('allow_tender_search'));
      if(['Info-Mail Agent','No-Contact Mail Agent','Mail & Conversation Agent','AI Mail Assistant'].includes(name))hidden(card,!mailAllowed);
    });

    // A Start customer should never see mail/offer-derived dashboard cards.
    document.querySelectorAll('#metrics .card').forEach(card=>{
      const t=card.textContent||'';
      if(/Tilbud ude|Tilbud forfaldne|Aktive tilbud/i.test(t))hidden(card,!allowed('allow_offers'));
      if(/Loggede mails/i.test(t))hidden(card,!mailAllowed);
      if(/Godkendelser/i.test(t))hidden(card,!allowed('allow_approvals'));
    });
    const dm=document.getElementById('dashMail')?.closest('.card');hidden(dm,!mailAllowed);
    const da=document.getElementById('dashApprovals')?.closest('.card');hidden(da,!allowed('allow_approvals'));
  }
  new MutationObserver(()=>setTimeout(apply,0)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('click',()=>setTimeout(apply,0),true);
  setInterval(apply,400);
  setTimeout(apply,100);
})();
