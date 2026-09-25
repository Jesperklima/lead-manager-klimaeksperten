alter table public.crm_offers
  add column if not exists minuba_offer_id text,
  add column if not exists pdf_source_message_id text,
  add column if not exists pdf_source_attachment_id text,
  add column if not exists pdf_source_filename text,
  add column if not exists pdf_source_kind text,
  add column if not exists pdf_verified_at timestamptz,
  add column if not exists pdf_last_error text;

create index if not exists crm_offers_pdf_source_message_idx
  on public.crm_offers (client_id, pdf_source_message_id)
  where pdf_source_message_id is not null;

-- Existing rows are intentionally not backfilled here. crm_offers has write guards
-- that must not be triggered by a schema migration. The resolver derives the stable
-- Minuba id from minuba_raw.id at runtime and persists it only during a verified PDF lookup.

comment on column public.crm_offers.minuba_offer_id is 'Stable Minuba Order/offer UUID persisted during verified PDF resolution; legacy rows fall back to minuba_raw.id at runtime.';
comment on column public.crm_offers.pdf_source_message_id is 'Verified Gmail source message for the original offer PDF.';
comment on column public.crm_offers.pdf_source_attachment_id is 'Verified Gmail attachment id for the original offer PDF.';
comment on column public.crm_offers.pdf_source_filename is 'Actual verified PDF filename; display name only, not identity.';
comment on column public.crm_offers.pdf_source_kind is 'Resolver source such as gmail_cache, gmail_linked, gmail_search or minuba_file.';
comment on column public.crm_offers.pdf_verified_at is 'Last time the stored PDF source was revalidated.';
comment on column public.crm_offers.pdf_last_error is 'Last PDF resolver error for diagnostics; cleared after successful validation.';
