-- Prevent cross-person LinkedIn profile URLs from being attached as a contact source.
-- If a LinkedIn /in/ source does not match the contact's name (and is not the
-- contact's explicit linkedin_url), the link is suppressed and verification is
-- downgraded until a matching person source is found.

create or replace function public.crm_guard_contact_source_identity()
returns trigger
language plpgsql
as $$
declare
  slug text;
  normalized_name text;
  first_name text;
  last_name text;
  words text[];
  same_as_linkedin boolean;
begin
  if new.source_url is null or btrim(new.source_url) = '' or new.full_name is null or btrim(new.full_name) = '' then
    return new;
  end if;

  if new.source_url !~* 'https?://([^/]+\.)?linkedin\.com/in/' then
    return new;
  end if;

  same_as_linkedin := new.linkedin_url is not null
    and lower(regexp_replace(btrim(new.linkedin_url), '/+$', '')) = lower(regexp_replace(btrim(new.source_url), '/+$', ''));

  if same_as_linkedin then
    return new;
  end if;

  slug := lower(regexp_replace(new.source_url, '^.*linkedin\.com/in/([^/?#]+).*$','\1', 'i'));
  normalized_name := lower(translate(new.full_name, 'ÆØÅÄÖÜÉÈÁÀÍÌÓÒÚÙÇæøåäöüéèáàíìóòúùç', 'AOAAOUEEAAIIOOUUCAOAAOUEEAAIIOOUUC'));
  normalized_name := regexp_replace(normalized_name, '[^a-z0-9 ]', ' ', 'g');
  normalized_name := regexp_replace(normalized_name, '\s+', ' ', 'g');
  normalized_name := btrim(normalized_name);
  words := regexp_split_to_array(normalized_name, ' +');

  if coalesce(array_length(words, 1), 0) = 0 then
    return new;
  end if;

  first_name := words[1];
  last_name := words[array_length(words, 1)];

  if (length(first_name) >= 3 and position(first_name in slug) = 0)
     or (array_length(words, 1) > 1 and length(last_name) >= 3 and position(last_name in slug) = 0) then
    new.source_url := null;
    new.verified := false;
    new.verified_at := null;
    if new.confidence = 'high' then new.confidence := 'medium'; end if;
    if new.source_type is null or btrim(new.source_type) = '' then
      new.source_type := 'Kilde afventer personmatch';
    elsif new.source_type !~* 'personmatch' then
      new.source_type := left(new.source_type, 220) || ' · kildelink skjult: personmatch ikke verificeret';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_crm_contacts_source_identity_guard on public.crm_contacts;
create trigger trg_crm_contacts_source_identity_guard
before insert or update of full_name, source_url, linkedin_url, verified, verified_at, confidence, source_type
on public.crm_contacts
for each row
execute function public.crm_guard_contact_source_identity();

-- Clean existing LinkedIn profile-source mismatches without relying on generated IDs.
with candidates as (
  select
    ct.id,
    lower(regexp_replace(ct.source_url, '^.*linkedin\.com/in/([^/?#]+).*$','\1', 'i')) as slug,
    regexp_split_to_array(
      btrim(regexp_replace(
        lower(translate(ct.full_name, 'ÆØÅÄÖÜÉÈÁÀÍÌÓÒÚÙÇæøåäöüéèáàíìóòúùç', 'AOAAOUEEAAIIOOUUCAOAAOUEEAAIIOOUUC')),
        '[^a-z0-9 ]', ' ', 'g'
      )),
      ' +'
    ) as words
  from public.crm_contacts ct
  where ct.source_url ~* 'https?://([^/]+\.)?linkedin\.com/in/'
    and nullif(btrim(ct.full_name), '') is not null
    and not (
      ct.linkedin_url is not null
      and lower(regexp_replace(btrim(ct.linkedin_url), '/+$', '')) = lower(regexp_replace(btrim(ct.source_url), '/+$', ''))
    )
), mismatches as (
  select id
  from candidates
  where
    (length(words[1]) >= 3 and position(words[1] in slug) = 0)
    or (
      array_length(words, 1) > 1
      and length(words[array_length(words, 1)]) >= 3
      and position(words[array_length(words, 1)] in slug) = 0
    )
)
update public.crm_contacts ct
set source_url = null,
    verified = false,
    verified_at = null,
    confidence = case when ct.confidence = 'high' then 'medium' else ct.confidence end,
    source_type = case
      when ct.source_type is null or btrim(ct.source_type) = '' then 'Kilde afventer personmatch'
      when ct.source_type ~* 'personmatch' then ct.source_type
      else left(ct.source_type, 220) || ' · kildelink skjult: personmatch ikke verificeret'
    end
from mismatches m
where ct.id = m.id;

-- The SK Varme contact had a current-role claim mixed with an old-position
-- phone/source chain. Keep only the role we can support and require fresh
-- verification before showing a direct number or person source.
update public.crm_contacts ct
set title = 'Varmechef, Envafors',
    phone = null,
    verified = false,
    verified_at = null,
    confidence = 'medium',
    source_type = 'Aktuel rolle fundet offentligt; direkte personkilde og telefon afventer verificering',
    source_url = null
from public.crm_companies c
where c.id = ct.company_id
  and lower(c.name) = lower('SK Varme A/S')
  and lower(ct.full_name) = lower('Kris Mikkelsen');
