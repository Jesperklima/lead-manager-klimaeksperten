(()=>{
  'use strict';
  const hidden=(el,yes=true)=>{if(el)el.classList.toggle('hidden',!!yes)};
  const plan=()=>window.__LM_SAAS_PLAN||null;
  const isInternal=()=>plan()?.plan_code==='internal';
  const allowed=flag=>isInternal()||!!plan()?.[flag];
  function apply(){
    const p=plan();if(!p)return;

    // Sending from the customer's own mailbox is included in Start.
    // Reading/monitoring replies and AI mail assistance start in Pro.
    const sendAllowed=allowed('allow_mail_send');
    const monitorAllowed=allowed('allow_mail_monitor');
    const aiAllowed=allowed('allow_ai_mail');
    hidden(document.getElementById('openMailComposer'),!sendAllowed);
    hidden(document.getElementById('requestInfoMail'),!aiAllowed);
    hidden(document.getElementById('requestNoContactMail'),!aiAllowed);
    document.querySelectorAll('[data-internal-mail]').forEach(x=>hidden(x,!sendAllowed));
    hidden(document.getElementById('gmailHistoryBlock'),!monitorAllowed);

    // Keep the manual composer in Start, but remove the AI writing pane there.
    const aiPane=document.querySelector('#mailModal .mail-ai-pane');
    const aiRewrite=document.querySelector('#mailModal .ai-rewrite-bar');
    const aiState=document.getElementById('mAiState');
    hidden(aiPane,!aiAllowed);hidden(aiRewrite,!aiAllowed);hidden(aiState,!aiAllowed);
    const mailLayout=document.querySelector('#mailModal .mail-ai-layout');
    if(mailLayout)mailLayout.style.gridTemplateColumns=aiAllowed?'':'1fr';

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

    // Tender hunter is Business-only. Mail monitoring and AI agents are Pro+.
    document.querySelectorAll('#agentCards .card').forEach(card=>{
      const name=(card.querySelector('strong')?.textContent||'').trim();
      if(name==='Opportunity & Tender Hunter')hidden(card,!allowed('allow_tender_search'));
      if(name==='Mail & Conversation Agent')hidden(card,!monitorAllowed);
      if(['Info-Mail Agent','No-Contact Mail Agent','AI Mail Assistant'].includes(name))hidden(card,!aiAllowed);
    });

    // Start does not see mail-monitoring or offer-derived dashboard cards.
    document.querySelectorAll('#metrics .card').forEach(card=>{
      const t=card.textContent||'';
      if(/Tilbud ude|Tilbud forfaldne|Aktive tilbud/i.test(t))hidden(card,!allowed('allow_offers'));
      if(/Loggede mails/i.test(t))hidden(card,!monitorAllowed);
      if(/Godkendelser/i.test(t))hidden(card,!allowed('allow_approvals'));
    });
    const dm=document.getElementById('dashMail')?.closest('.card');hidden(dm,!monitorAllowed);
    const da=document.getElementById('dashApprovals')?.closest('.card');hidden(da,!allowed('allow_approvals'));
  }
  new MutationObserver(()=>setTimeout(apply,0)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('click',()=>setTimeout(apply,0),true);
  setInterval(apply,400);
  setTimeout(apply,100);
})();
