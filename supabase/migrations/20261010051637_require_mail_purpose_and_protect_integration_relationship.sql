CREATE OR REPLACE FUNCTION public.crm_guard_direct_marketing_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
  v_contact uuid;
  v_to text;
  v_allowed boolean := false;
  v_operational_relationship boolean := false;
  v_explicit_marketing boolean := false;
  v_offer_id uuid;
begin
  if new.action_type <> 'send_email' then return new; end if;

  v_company := nullif(new.payload->>'company_id','')::uuid;
  v_to := lower(coalesce(new.payload->>'to',''));
  v_explicit_marketing := coalesce(new.payload->>'purpose','') not in ('operational_relationship','reply','offer_followup');
  v_offer_id := nullif(new.payload->>'offer_id','')::uuid;

  if v_company is null or v_to='' then
    new.status:='blocked';
    new.payload:=coalesce(new.payload,'{}'::jsonb)||jsonb_build_object('block_reason','Mailens kunde og modtager skal være dokumenteret.','compliance_rule','missing_recipient_context');
    return new;
  end if;

  -- A mail is operational only when the platform can document an existing commercial/dialogue context.
  -- Browser-supplied labels alone cannot turn a cold prospect into an operational mail.
  select exists(
    select 1
    from public.crm_companies c
    where c.id=v_company and c.client_id=new.client_id
      and (
        lower(coalesce(c.minuba_relationship_status,''))='existing_customer'
      )
  ) into v_operational_relationship;

  if not v_operational_relationship and v_offer_id is not null then
    select exists(
      select 1 from public.crm_offers o
      where o.id=v_offer_id and o.client_id=new.client_id and o.company_id=v_company
        and o.minuba_offer_id is not null
    ) into v_operational_relationship;
  end if;

  if not v_operational_relationship and new.lead_id is not null then
    select exists(
      select 1 from public.crm_offers o
      where o.client_id=new.client_id and o.company_id=v_company
        and o.minuba_offer_id is not null
        and (o.lead_id=new.lead_id or o.status not in ('TABT','LUKKET','CLOSED','LOST'))
    ) into v_operational_relationship;
  end if;

  if not v_operational_relationship then
    select exists(
      select 1 from public.crm_mail_messages m
      where m.client_id=new.client_id and m.company_id=v_company and m.direction='inbound'
        and lower(coalesce(m.from_email,''))=v_to
    ) into v_operational_relationship;
  end if;

  -- Anything explicitly marked direct marketing stays direct marketing.
  -- Otherwise, a mail without a documented existing relationship/dialogue is treated as direct marketing by default.
  if not v_explicit_marketing and v_operational_relationship then
    new.payload := coalesce(new.payload,'{}'::jsonb) || jsonb_build_object(
      'compliance_purpose','operational_relationship',
      'compliance_gate','central_email_gate_v3'
    );
    return new;
  end if;

  select id into v_contact
  from public.crm_contacts
  where client_id=new.client_id and company_id=v_company and lower(coalesce(email,''))=v_to
  order by verified desc, created_at asc limit 1;

  select exists(
    select 1 from public.crm_contact_channel_permissions p
    where p.client_id=new.client_id and p.company_id=v_company
      and (p.contact_id is null or p.contact_id=v_contact)
      and p.channel='email' and p.purpose='direct_marketing' and p.status='allowed'
      and p.legal_basis in ('prior_consent','customer_exception_reviewed')
      and p.valid_from<=now() and (p.valid_until is null or p.valid_until>now())
  ) into v_allowed;

  if not v_allowed then
    new.status := 'blocked';
    new.decided_at := now();
    new.payload := coalesce(new.payload,'{}'::jsonb) || jsonb_build_object(
      'block_reason','Salgs-mail er blokeret: der er ikke dokumenteret eksisterende dialog/kunderelation eller dokumenteret lovligt grundlag for elektronisk direkte markedsføring.',
      'compliance_rule','electronic_marketing_requires_documented_basis',
      'compliance_purpose','direct_marketing',
      'compliance_gate','central_email_gate_v3'
    );
  else
    new.payload := coalesce(new.payload,'{}'::jsonb) || jsonb_build_object(
      'compliance_purpose','direct_marketing',
      'compliance_gate','central_email_gate_v3',
      'marketing_basis_verified',true
    );
  end if;

  return new;
end;
$function$
;
create or replace function public.crm_protect_integration_relationship() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'')='authenticated' then
   if tg_op='INSERT' and (new.minuba_relationship_status is not null or new.minuba_raw is not null) then
      raise exception 'INTEGRATION_RELATIONSHIP_SERVER_ONLY' using errcode='42501';
   elsif tg_op='UPDATE' and (new.minuba_relationship_status is distinct from old.minuba_relationship_status or new.minuba_raw is distinct from old.minuba_raw) then
      raise exception 'INTEGRATION_RELATIONSHIP_SERVER_ONLY' using errcode='42501';
   end if;
 end if;
 return new;
end;$$;
revoke all on function public.crm_protect_integration_relationship() from public,anon,authenticated;
create trigger crm_protect_integration_relationship before insert or update on public.crm_companies for each row execute function public.crm_protect_integration_relationship();
