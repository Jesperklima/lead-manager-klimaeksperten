-- Mail Decision Engine v2:
-- Thread-linked messages must remain eligible for decision parsing. The previous
-- trigger marked them as processed before the decision engine could inspect the
-- actual customer text, which hid clear accept/reject signals inside replies.

create or replace function public.crm_guard_mail_offer_sync_candidates()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_subject text := lower(coalesce(new.subject,''));
begin
  new.metadata := coalesce(new.metadata,'{}'::jsonb);

  -- Lead Manager system notifications must never feed back into offer decisions.
  if v_subject like '%lead manager:%'
     and (v_subject like '%tilbud registreret%' or v_subject like '%mailkontrol%' or v_subject like '%opfølgning%') then
    new.metadata := new.metadata || jsonb_build_object(
      'offer_sync_processed',true,
      'offer_sync_candidate',false,
      'offer_sync_result','IGNORED_SYSTEM_NOTIFICATION',
      'offer_sync_reason','Lead Managers egen systemmail/reply-tråd må ikke ændre tilbud.'
    );
    return new;
  end if;

  -- mail-thread-sync is a trusted offer link, not a completed decision.
  -- Leave an already processed decision untouched, but queue fresh thread-linked
  -- messages for Mail Decision Engine v2.
  if coalesce((new.metadata->>'mail_thread_sync')::boolean,false)
     and new.offer_id is not null
     and coalesce((new.metadata->>'offer_sync_processed')::boolean,false) is not true then
    new.metadata := new.metadata || jsonb_build_object(
      'offer_sync_candidate',true,
      'offer_sync_reason','Mailtråden er sikkert bundet til tilbuddet og afventer Mail Decision Engine v2.'
    );
  end if;

  return new;
end;
$function$;

comment on function public.crm_guard_mail_offer_sync_candidates()
is 'Keeps system notifications suppressed while allowing safely thread-linked customer mail to be interpreted by Mail Decision Engine v2.';

-- Re-open only recent thread-linked messages that were previously suppressed and
-- that contain a strong decision phrase. Ambiguous historic mail remains untouched.
update public.crm_mail_messages
set metadata = (
      coalesce(metadata,'{}'::jsonb)
      - 'offer_sync_processed'
      - 'offer_sync_result'
      - 'offer_sync_evidence'
      - 'offer_sync_reason'
    ) || jsonb_build_object(
      'offer_sync_candidate',true,
      'offer_sync_reason','Genåbnet til Mail Decision Engine v2 pga. et tydeligt beslutningssignal i den sikkert bundne mailtråd.'
    )
where offer_id is not null
  and coalesce(metadata->>'offer_sync_result','') = 'THREAD_LINKED_NO_AUTO_STATUS'
  and message_at >= now() - interval '45 days'
  and lower(coalesce(subject,'')) not like '%lead manager:%'
  and lower(coalesce(body_text,'')) ~
      '(takke(r)?[[:space:]]+ja|siger[[:space:]]+ja|accepter|godkend|ordren[[:space:]]+er[[:space:]]+jeres|sæt.{0,30}i[[:space:]]+gang|bestill|takke(r)?[[:space:]]+nej|afslår|afviser|declin|accepted|approved|go[[:space:]]+ahead|please[[:space:]]+proceed)';
