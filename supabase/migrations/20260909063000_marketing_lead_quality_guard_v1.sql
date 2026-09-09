-- Marketing lead quality guard v1
-- Keeps test/E2E traffic out of the real CRM pipeline, captures explicit inbound contact requests,
-- and preserves the concrete why/source/message when a marketing prospect becomes a CRM lead.

create or replace function public.crm_marketing_prospect_quality_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_name text:=lower(btrim(coalesce(new.display_name,'')));
  v_ref text:=lower(btrim(coalesce(new.external_person_ref,'')));
  v_msg text:=lower(btrim(coalesce(new.metadata->>'latest_message',new.metadata->>'interest','')));
  v_platform text:=lower(btrim(coalesce(new.metadata->>'platform','')));
  v_contact_requested boolean:=false;
  v_is_test boolean:=false;
  v_handle text;
begin
  v_is_test :=
    coalesce((new.metadata->>'is_test')::boolean,false)
    or v_name ~ '^(e2e|test)[_-]'
    or v_ref ~ '(^|:)(@)?(e2e|test)[_-]';

  if v_is_test then
    new.stage:='rejected';
    new.rejection_reason:='Automatisk test/E2E-signal';
    new.engagement_score:=0;
    new.intent_score:=0;
    new.consent_to_contact:=false;
    new.contact_basis:=null;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'is_test',true,
      'quality_status','test_filtered',
      'contact_note','Testsignal – må ikke oprettes som rigtigt CRM-lead.'
    );
    return new;
  end if;

  v_contact_requested :=
    v_msg ~ '(kontakt(e|er)?[[:space:]]+(mig|os)|kan[[:space:]]+i[[:space:]]+kontakte|ring(e|er)?[[:space:]]+(til[[:space:]]+)?(mig|os)|må[[:space:]]+i[[:space:]]+gerne[[:space:]]+ringe|skriv[[:space:]]+til[[:space:]]+(mig|os)|send[[:space:]]+(mig|os)|dm[[:space:]]+(mig|os))';

  if v_contact_requested then
    new.consent_to_contact:=true;
    new.contact_basis:='explicit_inbound_request';
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'contact_requested',true,
      'contact_note','Personen har selv bedt om kontakt i den indgående henvendelse.'
    );
  else
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('contact_requested',false);
  end if;

  if v_platform='instagram' and nullif(v_name,'') is not null and (new.social_profile_url is null or new.social_profile_url ~ '/(p|reel)/') then
    v_handle:=regexp_replace(v_name,'^@','','g');
    if v_handle ~ '^[a-z0-9._]+$' then
      new.social_profile_url:='https://www.instagram.com/'||v_handle||'/';
    end if;
  end if;

  if new.prospect_type='unknown' and nullif(btrim(coalesce(new.company_name,'')),'') is null and nullif(btrim(coalesce(new.metadata->>'cvr','')),'') is null then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('identity_status','missing_company');
  else
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('identity_status','identified');
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_crm_marketing_prospect_quality_guard on public.crm_marketing_prospects;
create trigger trg_crm_marketing_prospect_quality_guard
before insert or update on public.crm_marketing_prospects
for each row execute function public.crm_marketing_prospect_quality_guard();

create or replace function public.crm_marketing_signal_defaults()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v text:=lower(coalesce(new.content,''));
  e integer:=0;
  i integer:=0;
  has_buying_intent boolean:=false;
  v_author text:=lower(coalesce(new.metadata->>'author_name',''));
  v_external text:=lower(coalesce(new.external_event_id,''));
begin
  if coalesce((new.metadata->>'is_test')::boolean,false)
     or v_external ~ '^(final-)?e2e[-_]'
     or v_external ~ '^test[-_]'
     or v_author ~ '^(e2e|test)[_-]' then
    new.score_delta:=0;
    new.intent_delta:=0;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('is_test',true,'quality_status','test_filtered');
    return new;
  end if;

  case lower(coalesce(new.event_type,''))
    when 'like' then e:=2;i:=0;
    when 'reaction' then e:=2;i:=0;
    when 'share' then e:=5;i:=2;
    when 'click' then e:=5;i:=5;
    when 'page_view' then e:=3;i:=3;
    when 'comment' then e:=8;i:=10;
    when 'direct_message' then e:=18;i:=40;
    when 'lead_form' then e:=22;i:=55;
    when 'contact_form' then e:=22;i:=60;
    when 'booking' then e:=25;i:=70;
    when 'email' then e:=20;i:=55;
    when 'phone' then e:=22;i:=60;
    when 'quote_request' then e:=25;i:=70;
    else e:=1;i:=0;
  end case;

  has_buying_intent := lower(coalesce(new.event_type,'')) in ('comment','direct_message') and (
    v like '%pris%' or v like '%koster%' or v like '%tilbud%' or v like '%kontakt%' or
    v like '%ring%' or v like '%monter%' or v like '%install%' or v like '%interesseret%' or
    v like '%bestil%' or v like '%book%' or v like '%kan i%' or v like '%kan du%' or
    v like '%hjælp%' or v like '%hvornår%'
  );

  if has_buying_intent then i:=greatest(i,40); end if;
  if new.score_delta=0 then new.score_delta:=e; end if;
  if new.intent_delta=0 then new.intent_delta:=i; end if;
  return new;
end;
$function$;

create or replace function public.crm_marketing_recalculate_prospect(p_prospect_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_engagement integer;
  v_intent integer;
  v_last timestamptz;
  v_strongest text;
  v_stage text;
  v_test boolean:=false;
begin
  select exists(
    select 1 from public.crm_marketing_signals
    where prospect_id=p_prospect_id and coalesce((metadata->>'is_test')::boolean,false)=true
  ) into v_test;

  if v_test then
    update public.crm_marketing_prospects
    set engagement_score=0,intent_score=0,stage='rejected',rejection_reason='Automatisk test/E2E-signal',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('is_test',true,'quality_status','test_filtered'),updated_at=now()
    where id=p_prospect_id;
    return;
  end if;

  select least(100,greatest(0,coalesce(sum(score_delta),0))),
         least(100,greatest(0,coalesce(sum(intent_delta),0))),
         max(occurred_at)
    into v_engagement,v_intent,v_last
  from public.crm_marketing_signals where prospect_id=p_prospect_id;

  select event_type into v_strongest
  from public.crm_marketing_signals
  where prospect_id=p_prospect_id
  order by intent_delta desc,score_delta desc,occurred_at desc
  limit 1;

  select stage into v_stage from public.crm_marketing_prospects where id=p_prospect_id;
  if v_stage not in ('lead','rejected') then
    v_stage:=case when v_intent>=35 or v_engagement>=20 then 'mql' else 'engagement' end;
  end if;

  update public.crm_marketing_prospects
  set engagement_score=v_engagement,intent_score=v_intent,last_signal_at=v_last,strongest_signal=v_strongest,stage=v_stage,updated_at=now()
  where id=p_prospect_id;
end;
$function$;

create or replace function public.crm_marketing_auto_promote_social_mql()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_has_social_signal boolean:=false;
  v_identity_ready boolean:=false;
  v_contact_requested boolean:=false;
  v_lead_id uuid;
begin
  if new.lead_id is not null or new.stage<>'mql' then return new; end if;
  if coalesce((new.metadata->>'is_test')::boolean,false) then return new; end if;

  select exists(
    select 1 from public.crm_marketing_signals s
    where s.prospect_id=new.id
      and lower(coalesce(s.event_type,'')) in ('like','reaction','share','click','page_view','comment','direct_message')
      and lower(coalesce(s.platform,'')) in ('facebook','instagram','meta','linkedin','skarp studio')
      and not coalesce((s.metadata->>'is_test')::boolean,false)
  ) into v_has_social_signal;
  if not v_has_social_signal then return new; end if;

  v_contact_requested:=new.consent_to_contact or coalesce((new.metadata->>'contact_requested')::boolean,false);
  v_identity_ready:=
    new.prospect_type<>'unknown'
    or nullif(btrim(coalesce(new.company_name,'')),'') is not null
    or nullif(btrim(coalesce(new.email,'')),'') is not null
    or nullif(btrim(coalesce(new.phone,'')),'') is not null
    or nullif(btrim(coalesce(new.metadata->>'cvr','')),'') is not null;

  if new.intent_score<35 and not v_contact_requested then return new; end if;
  if not v_identity_ready and not v_contact_requested then return new; end if;

  begin
    v_lead_id:=public.crm_marketing_promote_prospect(new.id);
  exception when others then
    return new;
  end;
  return new;
end;
$function$;

create or replace function public.crm_marketing_promote_prospect(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p public.crm_marketing_prospects%rowtype;
  c public.crm_marketing_campaigns%rowtype;
  pr public.crm_marketing_partners%rowtype;
  v_company_id uuid;
  v_contact_id uuid;
  v_lead_id uuid;
  v_company_name text;
  v_source text;
  v_actor text;
  v_next_action text;
  v_kind text;
  v_platform text;
  v_message text;
  v_reason text;
  v_recommended text;
  v_source_url text;
  v_contact_requested boolean:=false;
  v_identity_status text;
  v_contact_label text;
begin
  select * into p from public.crm_marketing_prospects where id=p_prospect_id;
  if not found then raise exception 'Marketing prospect not found'; end if;
  if pg_trigger_depth()=0 and coalesce(auth.role(),'')<>'service_role' and not public.crm_has_client_access(p.client_id) then raise exception 'Access denied'; end if;
  if p.lead_id is not null then return p.lead_id; end if;
  if p.stage='rejected' then raise exception 'Rejected prospect cannot be promoted'; end if;
  if coalesce((p.metadata->>'is_test')::boolean,false) then raise exception 'Test/E2E prospect cannot be promoted'; end if;

  if p.campaign_id is not null then select * into c from public.crm_marketing_campaigns where id=p.campaign_id; end if;
  if p.partner_id is not null then select * into pr from public.crm_marketing_partners where id=p.partner_id; end if;

  v_kind:=case when p.prospect_type='business' then 'Erhverv' when p.prospect_type='private' then 'Privat' else 'Ukendt' end;
  v_platform:=coalesce(nullif(btrim(p.metadata->>'platform'),''),nullif(btrim(c.platform),''),'Marketing');
  v_message:=nullif(btrim(coalesce(p.metadata->>'latest_message',p.metadata->>'interest','')),'');
  v_reason:=nullif(btrim(p.metadata->>'intent_reason'),'');
  v_recommended:=nullif(btrim(p.metadata->>'recommended_action'),'');
  v_source_url:=coalesce(nullif(btrim(p.metadata->>'source_url'),''),nullif(btrim(p.social_profile_url),''),nullif(btrim(c.landing_url),''));
  v_contact_requested:=p.consent_to_contact or coalesce((p.metadata->>'contact_requested')::boolean,false);
  v_identity_status:=case when p.prospect_type='unknown' and nullif(btrim(coalesce(p.company_name,'')),'') is null and nullif(btrim(coalesce(p.metadata->>'cvr','')),'') is null then 'Mangler virksomhedsidentifikation' else 'Identificeret' end;
  v_contact_label:=case when nullif(btrim(p.display_name),'') is null then 'Ukendt kontakt' when lower(v_platform)='instagram' and left(btrim(p.display_name),1)<>'@' then '@'||btrim(p.display_name) else btrim(p.display_name) end;

  if p.prospect_type='business' then
    v_company_name:=coalesce(nullif(btrim(p.company_name),''),nullif(btrim(p.display_name),''),'Erhvervslead · Marketing');
    select id into v_company_id from public.crm_companies
    where client_id=p.client_id and ((nullif(btrim(p.metadata->>'cvr'),'') is not null and cvr=btrim(p.metadata->>'cvr')) or lower(name)=lower(v_company_name))
    order by created_at asc limit 1;
  elsif p.prospect_type='private' then
    v_company_name:=case when nullif(btrim(p.display_name),'') is not null then 'Privatkunde · '||btrim(p.display_name) else 'Privatkunde · Marketing lead' end;
  else
    v_company_name:=case when nullif(btrim(p.company_name),'') is not null then btrim(p.company_name)
                         when nullif(btrim(p.display_name),'') is not null then 'Mangler virksomhed · '||v_contact_label
                         else 'Mangler identifikation · marketinghenvendelse' end;
  end if;

  if v_company_id is null then
    insert into public.crm_companies(client_id,name,cvr,phone,address,industry,company_summary,relationship_status)
    values(
      p.client_id,v_company_name,
      case when p.prospect_type='business' then nullif(btrim(p.metadata->>'cvr'),'') else null end,
      nullif(btrim(p.phone),''),nullif(btrim(p.metadata->>'address'),''),
      case when p.prospect_type='business' then coalesce(nullif(btrim(p.metadata->>'industry'),''),'Erhverv')
           when p.prospect_type='private' then 'Privatkunde'
           else 'Marketing · mangler identifikation' end,
      concat_ws(' ',coalesce(v_reason,'Indgående marketinghenvendelse.'),case when v_message is not null then 'Henvendelse: “'||left(v_message,350)||'”' end,'Kilde: '||v_platform||coalesce(' via '||nullif(pr.name,''),'' )||'.'),
      'prospect'
    ) returning id into v_company_id;
  else
    update public.crm_companies set
      cvr=coalesce(cvr,case when p.prospect_type='business' then nullif(btrim(p.metadata->>'cvr'),'') end),
      phone=coalesce(phone,nullif(btrim(p.phone),'')),address=coalesce(address,nullif(btrim(p.metadata->>'address'),''))
    where id=v_company_id;
  end if;

  if nullif(btrim(p.display_name),'') is not null or nullif(btrim(p.email),'') is not null or nullif(btrim(p.phone),'') is not null then
    insert into public.crm_contacts(client_id,company_id,full_name,phone,email,source_url,verified,source_type,verified_at,confidence,role_relevance,is_decision_maker)
    values(
      p.client_id,v_company_id,nullif(btrim(v_contact_label),''),nullif(btrim(p.phone),''),nullif(btrim(p.email),''),
      nullif(btrim(p.social_profile_url),''),false,'marketing_inbound',null,
      case when v_contact_requested then 'high' else 'medium' end,
      coalesce(nullif(btrim(p.metadata->>'title'),''),v_platform||' kontakt'),false
    ) returning id into v_contact_id;
  end if;

  v_source:='Marketing';
  if nullif(pr.name,'') is not null then v_source:=v_source||' · '||pr.name; end if;
  if nullif(v_platform,'') is not null then v_source:=v_source||' · '||v_platform; end if;
  v_source:=v_source||' · '||v_kind;

  v_next_action:=case
    when v_contact_requested and p.prospect_type='unknown' then 'Svar '||v_contact_label||' via '||v_platform||' – personen har selv bedt om kontakt. Afklar virksomhed, kontaktoplysninger og det konkrete behov.'
    when v_contact_requested then 'Kontakt '||v_contact_label||' – personen har selv bedt om kontakt. Afklar behov, omfang og næste skridt.'
    when p.prospect_type='business' then 'Kontakt erhvervslead og afklar virksomhedens behov og beslutningstager'
    when p.prospect_type='private' then 'Kontakt privatlead og afklar behov, adresse og tidshorisont'
    else 'Identificér person/virksomhed og afklar kontaktgrundlag, før der tages direkte kontakt' end;

  insert into public.crm_leads(
    client_id,company_id,status,score,priority,source,next_action,next_at,planning_type,
    source_url,source_reference,source_matched_capability,source_scope_verified,
    source_qualification_required,source_qualification_verified,source_verification_evidence,
    score_version,score_breakdown
  ) values (
    p.client_id,v_company_id,'NY',p.intent_score,
    case when p.intent_score>=80 then 'A' when p.intent_score>=55 then 'B' else 'C' end,
    v_source,v_next_action,now()+interval '1 day','flexible',v_source_url,p.id::text,
    coalesce(v_message,nullif(p.metadata->>'interest',''),'Marketing lead'),true,
    p.prospect_type='unknown',p.prospect_type<>'unknown',
    jsonb_build_object(
      'marketing_prospect_id',p.id,'campaign_id',p.campaign_id,'partner_id',p.partner_id,
      'prospect_type',p.prospect_type,'lead_segment',v_kind,'platform',v_platform,
      'contact_display_name',v_contact_label,'contact_basis',p.contact_basis,'contact_requested',v_contact_requested,
      'consent_to_contact',p.consent_to_contact,'strongest_signal',p.strongest_signal,
      'latest_message',v_message,'intent_reason',v_reason,'recommended_action',coalesce(v_recommended,v_next_action),
      'source_url',v_source_url,'social_profile_url',p.social_profile_url,'identity_status',v_identity_status,
      'cvr',p.metadata->>'cvr','address',p.metadata->>'address'
    ),
    'marketing-v3',jsonb_build_object('marketing_intent',p.intent_score,'engagement',p.engagement_score,'strongest_signal',p.strongest_signal,'segment',v_kind,'contact_requested',v_contact_requested,'identity_status',v_identity_status)
  ) returning id into v_lead_id;

  insert into public.crm_sales_intelligence(
    client_id,company_id,lead_id,contact_id,signal_type,title,summary,conversation_angle,recommended_action,relevance_score,confidence,source_type,source_url,source_label,observed_at,verified,metadata
  ) values (
    p.client_id,v_company_id,v_lead_id,v_contact_id,'marketing_inbound','Hvorfor er dette et lead?',
    concat_ws(' ',coalesce(v_reason,'Indgående marketinghenvendelse med købssignal.'),case when v_message is not null then 'Original henvendelse: “'||left(v_message,500)||'”' end),
    case when v_contact_requested then 'Personen har selv bedt om kontakt. Tag udgangspunkt i den konkrete henvendelse – ikke et koldt salgsbudskab.' else 'Brug den konkrete henvendelse som åbning og afklar behovet.' end,
    coalesce(v_recommended,v_next_action),greatest(1,least(100,p.intent_score)),
    case when v_contact_requested then 'high' else 'medium' end,'marketing_inbound',v_source_url,
    v_platform||coalesce(' via '||nullif(pr.name,''),''),coalesce(p.last_signal_at,now()),true,
    jsonb_build_object('marketing_prospect_id',p.id,'contact_requested',v_contact_requested,'identity_status',v_identity_status)
  );

  begin v_actor:=coalesce(auth.jwt()->>'email','marketing'); exception when others then v_actor:='marketing'; end;
  insert into public.crm_activities(client_id,company_id,lead_id,contact_id,type,actor_type,actor_name,summary,metadata)
  values(
    p.client_id,v_company_id,v_lead_id,v_contact_id,'Marketing lead','system',v_actor,
    coalesce(v_reason,v_kind||' lead oprettet fra marketing')||case when v_message is not null then ' · “'||left(v_message,240)||'”' else '' end,
    jsonb_build_object('marketing_prospect_id',p.id,'campaign_id',p.campaign_id,'partner_id',p.partner_id,'prospect_type',p.prospect_type,'intent_score',p.intent_score,'engagement_score',p.engagement_score,'contact_requested',v_contact_requested,'source_url',v_source_url)
  );

  update public.crm_marketing_prospects set stage='lead',lead_id=v_lead_id,updated_at=now() where id=p.id;
  insert into public.crm_usage_events(client_id,event_type,quantity,metadata)
  values(p.client_id,'marketing_lead_promoted',1,jsonb_build_object('lead_id',v_lead_id,'marketing_prospect_id',p.id,'campaign_id',p.campaign_id,'prospect_type',p.prospect_type));
  return v_lead_id;
end;
$function$;
