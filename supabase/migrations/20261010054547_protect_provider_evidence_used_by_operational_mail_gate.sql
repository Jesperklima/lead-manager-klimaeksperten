create or replace function public.crm_protect_mail_relationship_evidence() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'')='authenticated' then
  if tg_table_name='crm_offers' then
   if tg_op='INSERT' then
    if new.minuba_offer_id is not null then raise exception 'INTEGRATION_EVIDENCE_SERVER_ONLY' using errcode='42501'; end if;
   elsif new.minuba_offer_id is distinct from old.minuba_offer_id or (old.minuba_offer_id is not null and (new.company_id is distinct from old.company_id or new.client_id is distinct from old.client_id)) then
    raise exception 'INTEGRATION_EVIDENCE_SERVER_ONLY' using errcode='42501';
   end if;
  elsif tg_table_name='crm_mail_messages' then
   if tg_op='INSERT' then
    if new.direction='inbound' then raise exception 'INBOUND_EVIDENCE_SERVER_ONLY' using errcode='42501'; end if;
   elsif new.direction is distinct from old.direction or (old.direction='inbound' and (new.from_email is distinct from old.from_email or new.client_id is distinct from old.client_id)) then
    raise exception 'INBOUND_EVIDENCE_SERVER_ONLY' using errcode='42501';
   end if;
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.crm_protect_mail_relationship_evidence() from public,anon,authenticated;
create trigger crm_protect_mail_relationship_evidence before insert or update on public.crm_offers for each row execute function public.crm_protect_mail_relationship_evidence();
create trigger crm_protect_mail_relationship_evidence before insert or update on public.crm_mail_messages for each row execute function public.crm_protect_mail_relationship_evidence();
