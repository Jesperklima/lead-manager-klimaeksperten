-- Offer-PDF mail sends use the same reliable send queue as normal Gmail sends.
alter table public.crm_mail_send_jobs
  add column if not exists attachment_filename text,
  add column if not exists attachment_source text,
  add column if not exists source_message_id text;

create index if not exists crm_mail_send_jobs_approval_idx
  on public.crm_mail_send_jobs(approval_id)
  where approval_id is not null;
