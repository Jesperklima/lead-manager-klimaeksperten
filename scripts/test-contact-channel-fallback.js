const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}

const html=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('supabase/functions/lead-enrichment-worker/index.ts','utf8');
const commandWorker=fs.readFileSync('supabase/functions/lead-manager-command-worker/index.ts','utf8');
const migrationV1=fs.readFileSync('supabase/migrations/20260921053000_contact_channel_fallback_v1.sql','utf8');
const migrationV2=fs.readFileSync('supabase/migrations/20260921054000_company_standard_contact_v2.sql','utf8');

must(worker.includes("r.payload?.action!=='contact_enrichment'"),'dedicated worker does not own contact_enrichment');
must(worker.includes('async function researchContact'), 'real contact research handler missing');
must(worker.includes('Gem aldrig gættede kontaktdata'),'contact enrichment anti-hallucination guard missing');
must(worker.includes("payload.email_verification_method='exact_source_text'"),'exact email source verification missing');
must(worker.includes("status:'UNDER VURDERING'"),'lead safety fallback when no contact channel missing');
must(worker.includes("event_type:'lead_enrichment'"),'AI usage logging missing');
must(worker.includes("companyPatch.email=research.generalEmail"),'verified general email is not persisted on company');
must(!commandWorker.includes("'contact_enrichment'"),'contact_enrichment has multiple worker owners');

must(migrationV1.includes('crm_enqueue_missing_contact_channels'),'automatic missing-contact queue function missing');
must(migrationV1.includes('trg_crm_lead_contact_channel_guard'),'lead contact-channel trigger missing');
must(migrationV1.includes("'lead-contact-channel-sweep'"),'contact-channel sweep cron missing');
must(migrationV1.includes("r.payload->>'action'='contact_enrichment'"),'contact enrichment dedupe missing');
must(migrationV2.includes('add column if not exists email text'),'company standard email column missing');
must(migrationV2.includes("coalesce(trim(c.phone),'')=''"),'company phone must count as usable fallback');
must(migrationV2.includes("coalesce(trim(c.email),'')=''"),'company standard email must count as usable fallback');
must(migrationV2.includes("coalesce(trim(ct.phone),'')<>'' or coalesce(trim(ct.email),'')<>''"),'named contact channel test missing');

must(html.includes('Standardkontakt'),'standard contact UI fallback missing');
must(html.includes("row('Standardmail',c.email,mail(c.email))"),'company standard email is not visible');
must(html.includes("bestEmailContact(cts)?.email||c.email||''"),'mail composer does not fall back to company standard email');
must(html.includes("email=sorted.find(x=>x.email)?.email||c.email"),'send-mail action does not fall back to company standard email');
must(html.includes('Ingen verificeret kontaktperson, standardmail eller hovedtelefon endnu.'),'missing-contact warning is incomplete');
must(html.includes("const call=sorted.find(x=>x.phone)?.phone||c.phone"),'call action does not fall back to company phone');

console.log('PASS: single-owner contact enrichment, automatic queue, company standard contact and UI fallback');
