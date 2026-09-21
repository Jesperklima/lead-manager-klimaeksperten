const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('supabase/functions/lead-manager-command-worker/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260921053000_contact_channel_fallback_v1.sql','utf8');

must(worker.includes("'contact_enrichment'"),'contact_enrichment action is not supported');
must(worker.includes('async function handleContactEnrichment'), 'contact enrichment handler missing');
must(worker.includes("else if(action==='contact_enrichment')result=await handleContactEnrichment"),'contact enrichment route missing');
must(worker.includes('Gem aldrig gættede kontaktdata'),'contact enrichment anti-hallucination guard missing');
must(worker.includes("email_verification_method='exact_source_text'")||worker.includes("payload.email_verification_method='exact_source_text'"),'exact email source verification missing');
must(worker.includes("status:'UNDER VURDERING'"),'lead safety fallback when no contact channel missing');

must(migration.includes('crm_enqueue_missing_contact_channels'),'automatic missing-contact queue function missing');
must(migration.includes('trg_crm_lead_contact_channel_guard'),'lead contact-channel trigger missing');
must(migration.includes("'lead-contact-channel-sweep'"),'contact-channel sweep cron missing');
must(migration.includes("r.payload->>'action'='contact_enrichment'"),'contact enrichment dedupe missing');
must(migration.includes("coalesce(trim(c.phone),'')=''"),'company phone must count as usable fallback');
must(migration.includes("coalesce(trim(ct.phone),'')<>'' or coalesce(trim(ct.email),'')<>''"),'usable contact-channel test missing');

must(html.includes('Standardkontakt'),'standard contact UI fallback missing');
must(html.includes('Virksomhedens hovednummer'),'company phone fallback is not visible');
must(html.includes('Ingen verificeret kontaktperson, standardmail eller hovedtelefon endnu.'),'missing-contact warning is incomplete');
must(html.includes("const call=sorted.find(x=>x.phone)?.phone||c.phone"),'call action does not fall back to company phone');

console.log('PASS: contact-channel fallback, automatic enrichment queue, worker support and UI fallback');
