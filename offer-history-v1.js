
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
  const publicDomains = new Set(['gmail.com','outlook.com','outlook.dk','hotmail.com','hotmail.dk','live.dk','yahoo.com','icloud.com','mail.dk','msn.com']);
  function senderIsCustomer(rawFrom, expected) {
    const from = (String(rawFrom || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [])[0] || '';
    if (!from) return false;
    if (expected.length) {
      const domain = from.split('@')[1];
      return expected.includes(from) || (!publicDomains.has(domain) && expected.some(function (mail) { return mail.split('@')[1] === domain; }));
    }
    // Without a customer address, only a linked offer mail from outside the
    // internal domain is plausible; never use mail direction alone as proof.
    return from.split('@')[1] !== 'klimaeksperten.dk';
  }
  function replyText(value) {
    const raw = String(value || '').replace(/\r\n?/g, '\n').trim();
    // Keep what the customer wrote, without quoted history and signatures
    // swallowing the whole offer panel. The full stored mail is not changed.
    const meaningful = raw.split(/\n\s*(?:_{12,}|-{3,}\s*Original Message\s*-{3,}|Fra:\s|From:\s|Den .{5,100} skrev:|On .{5,100} wrote:)/i)[0].trim();
    return (meaningful || raw).slice(0, 2400);
  }
  function buildHistory(offer, archive, messages, activities) {
    const expected = ((String(offer && offer.contact_details || '') + ' ' + String(offer && offer.contact_person || '')).toLowerCase()
      .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);

    const replies = [];
    const seenReplies = new Set();
    (messages || []).forEach(function (m) {
      if (!['inbound','incoming','received'].includes(String(m.direction || '').toLowerCase())) return;
      if (!dateKey(m.message_at) || !senderIsCustomer(m.from_email, expected)) return;
      const id = String(m.external_message_id || m.id || '');
      if (id && seenReplies.has(id)) return;
      if (id) seenReplies.add(id);
      const text = replyText(m.body_text);
      const reaction = /^\[(?:like|heart|laugh|wow|sad|angry)\]/i.test(text) || /reacted to your message|reagerede på din besked/i.test(text);
      replies.push({ id: id, at: m.message_at, from: String(m.from_email || ''), subject: String(m.subject || ''), text: text, reaction: reaction });
    });
    replies.sort(function (a,b) { return new Date(a.at) - new Date(b.at); });
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
    return { first: first, followups: followups, replies: replies, mailEvents: unique.length };
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
    '#lmOfferHistory .lm-oh-empty{padding-top:8px;font-size:13px;color:#9db6c5}' +
    '#lmOfferHistory .lm-oh-reply{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;line-height:1.55;color:#d7e8ee}' +
    '#lmOfferHistory .lm-oh-reply-heading{margin:12px 0 0;border-top:1px solid #234252;padding-top:13px}';
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
  // Use cached provider evidence if per-offer queries lag behind, restricted to
  // the current offer and tenant. An unrelated customer must never be included.
  function cachedForOffer(key, offerId, clientId) {
    const rows = typeof state !== 'undefined' && Array.isArray(state[key]) ? state[key] : [];
    return rows.filter(function (row) {
      return row && row.offer_id === offerId && String(row.client_id || '') === String(clientId);
    });
  }
  function mergeEvidence(primary, cached) {
    const merged = (primary || []).slice();
    const seen = new Set(merged.map(function (row) { return String(row.id || row.external_message_id || ''); }));
    (cached || []).forEach(function (row) {
      const id = String(row.id || row.external_message_id || '');
      if (id && seen.has(id)) return;
      merged.push(row);
      if (id) seen.add(id);
    });
    return merged;
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
    const replyTitle = document.createElement('h3');
    replyTitle.className = 'lm-oh-reply-heading';
    replyTitle.textContent = 'Svar fra kunden (' + result.replies.length + ')';
    body.appendChild(replyTitle);
    if (!result.replies.length) line(body, 'lm-oh-empty', 'Ingen dokumenterede kundesvar er tilknyttet tilbuddet.');
    result.replies.forEach(function (reply) {
      const row = line(body, 'lm-oh-row', '');
      const header = line(row, 'lm-oh-head', '');
      line(header, '', reply.reaction ? 'Reaktion fra kunden' : 'Modtaget svar');
      line(header, '', stamp(reply.at, true));
      line(row, 'lm-oh-muted', 'Fra: ' + reply.from);
      if (reply.subject) line(row, 'lm-oh-muted', reply.subject.slice(0, 200));
      if (reply.text) line(row, 'lm-oh-reply', reply.text);
    });
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
    // The tenant guard validates client_id on returned rows. Every projected
    // tenant table MUST select client_id, even when the query already filters it.
    // Omitting it silently turns genuine outbound mails into an empty history.
    const kinds = [
      ['crm_offer_history', 'id,client_id,sent_date,follow_up_date', 'imported_at'],
      ['crm_mail_messages', 'id,client_id,direction,message_at,subject,to_emails,from_email,external_message_id,body_text', 'message_at'],
      ['crm_activities', 'id,client_id,type,created_at,metadata,summary', 'created_at']
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
    const messages = mergeEvidence(output[1].data, cachedForOffer('mail', o.id, clientId));
    const activities = mergeEvidence(output[2].data, cachedForOffer('activities', o.id, clientId));
    const result = buildHistory(o, output[0].data, messages, activities);
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
  window.addEventListener('lm:offer-mail-sent', scheduleLoad);
  window.addEventListener('lm:offer-mail-closed', function () {
    if (modal.classList.contains('open')) scheduleLoad();
  });
  window.addEventListener('lm:client-switched', function () {
    clearTimeout(timer);
    sequence += 1;
    currentId = '';
    body.textContent = '';
  });
  window.addEventListener('lm:data-refreshed', function () {
    if (modal.classList.contains('open')) scheduleLoad();
  });
  if (modal.classList.contains('open')) scheduleLoad();
})();
