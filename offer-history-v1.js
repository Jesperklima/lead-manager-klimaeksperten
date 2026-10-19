
/* Offer contact history: read-only view of evidenced offer sends and follow-ups.
   No send, write, status or follow-up-date changes occur here. */
(function () {
  'use strict';
  const zone = 'Europe/Copenhagen';
  const allowedOutbound = new Set(['outbound', 'outgoing', 'sent']);
  const contactActivity = /^(Udgående mail|Mail sendt|Sendt mail|Opfølgning udført|Telefonopfølgning)$/i;

  function dateKey(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    const time = new Date(value);
    if (!Number.isFinite(time.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
  }
  function stamp(value, withTime) {
    if (!value) return 'Ikke registreret';
    if (!withTime || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[3] + '.' + m[2] + '.' + m[1] : String(value);
    }
    const t = new Date(value);
    if (!Number.isFinite(t.getTime())) return String(value);
    return new Intl.DateTimeFormat('da-DK', { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);
  }

  function recipientIsCustomer(rawRecipients, sender, expected) {
    const recipients = (Array.isArray(rawRecipients) ? rawRecipients : [rawRecipients])
      .flatMap(function (v) { return String(v || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []; });
    if (!recipients.length) return false;
    const expectedDomains = new Set(expected.map(function (e) { return e.split('@')[1]; }));
    const publicDomains = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'hotmail.dk', 'live.dk', 'yahoo.com', 'icloud.com', 'mail.dk', 'msn.com']);
    if (expected.length) {
      return recipients.some(function (recipient) {
        if (expected.includes(recipient)) return true;
        const domain = recipient.split('@')[1];
        return !publicDomains.has(domain) && expectedDomains.has(domain);
      });
    }
    const senderEmail = String(sender || '').toLowerCase();
    const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1] : '';
    // Without a known customer address, do not count internal forwards to the
    // sender's own company as customer contact.
    return !!senderDomain && recipients.some(function (e) { return e.split('@')[1] !== senderDomain; });
  }
  function buildHistory(offer, archive, messages, activities) {
    const expected = ((String(offer && offer.contact_details || '') + ' ' + String(offer && offer.contact_person || '')).toLowerCase()
      .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);

    const records = [];
    (messages || []).forEach(function (m) {
      if (!allowedOutbound.has(String(m.direction || '').toLowerCase())) return;
      if (!m.message_at || !dateKey(m.message_at)) return;
      if (!recipientIsCustomer(m.to_emails, m.from_email, expected)) return;
      records.push({
        id: String(m.external_message_id || ''),
        at: m.message_at, kind: 'mail', subject: String(m.subject || ''),
        to: Array.isArray(m.to_emails) ? m.to_emails.join(', ') : '',
        source: 'Sendt mail'
      });
    });
    (activities || []).forEach(function (a) {
      if (!contactActivity.test(String(a.type || '')) || !a.created_at) return;
      const m = a.metadata || {};
      const isMail = /mail/i.test(String(a.type || ''));
      if (isMail && !recipientIsCustomer(m.to || m.to_email, a.actor_name || '', expected)) return;
      records.push({
        id: String(m.external_message_id || m.provider_message_id || ''),
        at: a.created_at,
        kind: isMail ? 'mail' : 'contact',
        subject: String(m.subject || (a.type === 'Udgående mail' ? a.summary || '' : a.type || '')),
        to: String(m.to || m.to_email || ''),
        source: String(a.type || 'Opfølgning')
      });
    });
    records.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    const unique = [];
    records.forEach(function (e) {
      // One outbound email may occur both in crm_mail_messages and crm_activities.
      const dupe = unique.some(function (p) {
        if (p.kind !== e.kind) return false;
        if (p.id && e.id && p.id === e.id) return true;
        const delta = Math.abs(new Date(p.at) - new Date(e.at));
        return delta <= 60000 && p.subject && e.subject &&
          p.subject.trim().toLowerCase() === e.subject.trim().toLowerCase();
      });
      if (!dupe) unique.push(e);
    });
    const candidateDates = [offer && offer.sent_date].concat((archive || []).map(function (h) { return h.sent_date; }))
      .filter(function (v) { return !!dateKey(v); }).sort(function (a, b) { return dateKey(a).localeCompare(dateKey(b)); });
    const recorded = candidateDates[0] || null;
    const firstEvent = unique.find(function (e) { return e.kind === 'mail'; }) || null;
    const verifiedFirst = firstEvent && (!recorded || dateKey(firstEvent.at) <= dateKey(recorded));
    const first = verifiedFirst
      ? { at: firstEvent.at, verified: true, origin: 'Dokumenteret udgående mail' }
      : recorded
        ? { at: recorded, verified: false, origin: 'Registreret på tilbuddet – ikke afsendelsesbekræftet' }
        : firstEvent
          ? { at: firstEvent.at, verified: true, origin: 'Dokumenteret udgående mail' }
          : null;
    // If CRM records the same day as the first actual outbound mail, the first
    // outbound mail is the original, not follow-up number one.
    const originalMail = firstEvent && first && dateKey(firstEvent.at) === dateKey(first.at)
      ? firstEvent : (firstEvent && !recorded ? firstEvent : null);
    const followups = unique.filter(function (e) {
      if (e === originalMail) return false;
      if (first && dateKey(e.at) < dateKey(first.at)) return false;
      return true;
    });
    return { first: first, followups: followups, mailEvents: unique.length };
  }

  if (typeof window !== 'undefined') window.LMOfferHistoryV1 = { buildHistory: buildHistory, dateKey: dateKey };

  if (typeof document === 'undefined') return;
  const modal = document.getElementById('offerModal');
  const comment = document.getElementById('oComment');
  if (!modal || !comment) return;

  const css = document.createElement('style');
  css.id = 'lm-offer-history-css';
  css.textContent =
    '#lmOfferHistory{margin:16px 0 10px;padding:13px 14px;border:1px solid #244455;border-radius:10px;background:#0a2230;color:#dceaf0}' +
    '#lmOfferHistory h3{font-size:15px;margin:0 0 9px;color:#f2f8fb}' +
    '#lmOfferHistory .lm-oh-first{padding-bottom:9px;border-bottom:1px solid #234252}' +
    '#lmOfferHistory .lm-oh-value{font-weight:650;color:#fff;margin-top:3px}' +
    '#lmOfferHistory .lm-oh-muted{color:#9db6c5;font-size:12px;line-height:1.5}' +
    '#lmOfferHistory .lm-oh-row{padding:9px 0;border-bottom:1px solid #1e3c4a;font-size:13px}' +
    '#lmOfferHistory .lm-oh-row:last-child{border-bottom:0;padding-bottom:0}' +
    '#lmOfferHistory .lm-oh-head{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;font-weight:600}' +
    '#lmOfferHistory .lm-oh-empty{padding-top:8px;font-size:13px;color:#9db6c5}';
  document.head.appendChild(css);

  const section = document.createElement('section');
  section.id = 'lmOfferHistory';
  section.setAttribute('aria-label', 'Tilbuds- og opfølgningshistorik');
  section.innerHTML = '<h3>Tilbuds- og opfølgningshistorik</h3><div id="lmOfferHistoryBody" aria-live="polite"></div>';
  const field = comment.closest('.field');
  field.insertAdjacentElement('afterend', section);
  const body = document.getElementById('lmOfferHistoryBody');
  let sequence = 0;
  let currentId = '';
  let timer = null;

  function line(parent, className, value) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = value;
    parent.appendChild(el);
    return el;
  }
  function render(result, errors, offer) {
    body.replaceChildren();
    const top = line(body, 'lm-oh-first', '');
    line(top, 'lm-oh-muted', 'Første afsendelse');
    line(top, 'lm-oh-value', result.first ? stamp(result.first.at, !!result.first.verified) : 'Dato ikke dokumenteret');
    line(top, 'lm-oh-muted', result.first ? result.first.origin : 'Ingen afsendelsesdato fundet i de tilgængelige kilder.');
    const title = document.createElement('h3');
    title.style.marginTop = '13px';
    title.textContent = 'Opfølgninger (' + result.followups.length + ')';
    body.appendChild(title);
    if (!result.followups.length) line(body, 'lm-oh-empty', 'Ingen dokumenterede gennemførte opfølgninger fundet.');
    result.followups.forEach(function (event, index) {
      const row = line(body, 'lm-oh-row', '');
      const header = line(row, 'lm-oh-head', '');
      line(header, '', 'Opfølgning ' + (index + 1));
      line(header, '', stamp(event.at, true));
      line(row, 'lm-oh-muted', event.source + (event.to ? ' · Til: ' + event.to : ''));
      if (event.subject) line(row, 'lm-oh-muted', event.subject.slice(0, 200));
    });
    line(body, 'lm-oh-muted', 'Kun gennemførte kontakter med registreret dokumentation. Planlagte datoer og usendte mails tælles ikke.');
    if (errors.length) line(body, 'lm-oh-muted', '⚠ Ikke alle kilder kunne læses: ' + errors.join(', ') + '. Historikken kan være ufuldstændig.');
    if (result.mailEvents === 0 && offer && offer.sent_date) {
      line(body, 'lm-oh-muted', 'Afsendelsesdatoen stammer fra tilbudsposten; den er ikke en bekræftelse fra mailudbyderen.');
    }
  }
  async function load() {
    if (!modal.classList.contains('open')) return;
    const o = typeof currentOffer !== 'undefined' ? currentOffer : null;
    const clientId = typeof state !== 'undefined' ? state.client && state.client.id : null;
    if (!o || !o.id || !clientId || o.client_id !== clientId) return;
    currentId = o.id;
    const mySequence = ++sequence;
    body.textContent = 'Henter afsendelser og opfølgninger…';
    const kinds = [
      ['crm_offer_history', 'id,sent_date,follow_up_date', 'imported_at'],
      ['crm_mail_messages', 'id,direction,message_at,subject,to_emails,from_email,external_message_id', 'message_at'],
      ['crm_activities', 'id,type,created_at,metadata,summary', 'created_at']
    ];
    const output = await Promise.all(kinds.map(async function (kind) {
      try {
        const res = await supabase.from(kind[0]).select(kind[1])
          .eq('client_id', clientId).eq('offer_id', o.id)
          .order(kind[2], { ascending: true }).limit(500);
        if (res.error) throw new Error(res.error.message || kind[0]);
        return { data: Array.isArray(res.data) ? res.data : [], error: '' };
      } catch (error) {
        console.warn('Offer history read failed', kind[0], error);
        return { data: [], error: kind[0] };
      }
    }));
    if (mySequence !== sequence || !modal.classList.contains('open') || currentId !== o.id) return;
    const result = buildHistory(o, output[0].data, output[1].data, output[2].data);
    render(result, output.map(function (x) { return x.error; }).filter(Boolean), o);
  }
  function scheduleLoad() {
    clearTimeout(timer);
    timer = setTimeout(function () { void load(); }, 50);
  }
  // The existing offer list opens a card from a click. Respond after its
  // own handler completes, without perpetual polling or DOM observers.
  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[data-open-offer], .offer-pipe-card')) {
      setTimeout(function () {
        if (modal.classList.contains('open')) scheduleLoad();
      }, 0);
    }
  });
  window.addEventListener('lm:offer-opened', scheduleLoad);
  window.addEventListener('lm:data-refreshed', function () {
    if (modal.classList.contains('open')) scheduleLoad();
  });
  if (modal.classList.contains('open')) scheduleLoad();
})();
