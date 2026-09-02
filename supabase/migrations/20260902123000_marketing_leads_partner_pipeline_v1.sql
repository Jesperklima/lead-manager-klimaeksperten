-- Marketing Leads partner pipeline v1
-- Production migration was applied on 2026-09-02.

create table if not exists public.crm_marketing_partners (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  name text not null,
  partner_type text not null default 'agency',
  contact_email text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_marketing_partners_client_name_uq on public.crm_marketing_partners(client_id, lower(name));

create table if not exists public.crm_marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  partner_id uuid references public.crm_marketing_partners(id) on delete set null,
  name text not null,
  platform text not null default 'other',
  external_campaign_id text,
  objective text,
  status text not null default 'active' check (status in ('draft','active','paused','finished','archived')),
  spend numeric(12,2) not null default 0,
  currency text not null default 'DKK',
  landing_url text,
  auto_promote_enabled boolean not null default true,
  auto_promote_threshold integer not null default 70 check (auto_promote_threshold between 0 and 100),
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_marketing_campaign_external_uq on public.crm_marketing_campaigns(client_id, platform, external_campaign_id) where external_campaign_id is not null and external_campaign_id <> '';

create table if not exists public.crm_marketing_prospects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  partner_id uuid references public.crm_marketing_partners(id) on delete set null,
  campaign_id uuid references public.crm_marketing_campaigns(id) on delete set null,
  prospect_type text not null default 'unknown' check (prospect_type in ('private','business','unknown')),
  display_name text,
  company_name text,
  email text,
  phone text,
  social_profile_url text,
  external_person_ref text,
  stage text not null default 'engagement' check (stage in ('engagement','mql','lead','rejected')),
  engagement_score integer not null default 0 check (engagement_score between 0 and 100),
  intent_score integer not null default 0 check (intent_score between 0 and 100),
  consent_to_contact boolean not null default false,
  contact_basis text,
  strongest_signal text,
  last_signal_at timestamptz,
  lead_id uuid references public.crm_leads(id) on delete set null,
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_marketing_prospects_client_stage_idx on public.crm_marketing_prospects(client_id, stage, intent_score desc, last_signal_at desc);
create index if not exists crm_marketing_prospects_campaign_idx on public.crm_marketing_prospects(campaign_id, last_signal_at desc);
create unique index if not exists crm_marketing_prospect_external_uq on public.crm_marketing_prospects(client_id, campaign_id, external_person_ref) where external_person_ref is not null and external_person_ref <> '';

create table if not exists public.crm_marketing_signals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  campaign_id uuid references public.crm_marketing_campaigns(id) on delete set null,
  prospect_id uuid not null references public.crm_marketing_prospects(id) on delete cascade,
  platform text not null default 'other',
  event_type text not null,
  content text,
  source_url text,
  external_event_id text,
  score_delta integer not null default 0,
  intent_delta integer not null default 0,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_marketing_signals_prospect_idx on public.crm_marketing_signals(prospect_id, occurred_at desc);
create unique index if not exists crm_marketing_signal_external_uq on public.crm_marketing_signals(client_id, platform, external_event_id) where external_event_id is not null and external_event_id <> '';

alter table public.crm_marketing_partners enable row level security;
alter table public.crm_marketing_campaigns enable row level security;
alter table public.crm_marketing_prospects enable row level security;
alter table public.crm_marketing_signals enable row level security;

drop policy if exists crm_marketing_partners_tenant_all on public.crm_marketing_partners;
create policy crm_marketing_partners_tenant_all on public.crm_marketing_partners for all using (public.crm_has_client_access(client_id)) with check (public.crm_has_client_access(client_id));
drop policy if exists crm_marketing_campaigns_tenant_all on public.crm_marketing_campaigns;
create policy crm_marketing_campaigns_tenant_all on public.crm_marketing_campaigns for all using (public.crm_has_client_access(client_id)) with check (public.crm_has_client_access(client_id));
drop policy if exists crm_marketing_prospects_tenant_all on public.crm_marketing_prospects;
create policy crm_marketing_prospects_tenant_all on public.crm_marketing_prospects for all using (public.crm_has_client_access(client_id)) with check (public.crm_has_client_access(client_id));
drop policy if exists crm_marketing_signals_tenant_all on public.crm_marketing_signals;
create policy crm_marketing_signals_tenant_all on public.crm_marketing_signals for all using (public.crm_has_client_access(client_id)) with check (public.crm_has_client_access(client_id));

grant select, insert, update, delete on public.crm_marketing_partners, public.crm_marketing_campaigns, public.crm_marketing_prospects, public.crm_marketing_signals to authenticated;

create or replace function public.crm_marketing_signal_defaults() returns trigger language plpgsql set search_path=public as $$
declare v text:=lower(coalesce(new.content,'')); e integer:=0; i integer:=0;
begin
 case lower(coalesce(new.event_type,''))
  when 'like' then e:=2;i:=0; when 'reaction' then e:=2;i:=0; when 'share' then e:=5;i:=2;
  when 'click' then e:=5;i:=5; when 'page_view' then e:=3;i:=3; when 'comment' then e:=8;i:=10;
  when 'direct_message' then e:=15;i:=30; when 'lead_form' then e:=20;i:=45; when 'contact_form' then e:=20;i:=50;
  when 'email' then e:=20;i:=45; when 'phone' then e:=20;i:=50; when 'quote_request' then e:=25;i:=60; else e:=1;i:=0;
 end case;
 if lower(coalesce(new.event_type,'')) in ('comment','direct_message') and (v like '%pris%' or v like '%koster%' or v like '%tilbud%' or v like '%kontakt%' or v like '%ring%' or v like '%monter%' or v like '%install%' or v like '%interesseret%' or v like '%bestil%' or v like '%book%' or v like '%kan i%' or v like '%kan du%' or v like '%hjælp%' or v like '%hvornår%') then i:=i+15; end if;
 if new.score_delta=0 then new.score_delta:=e; end if; if new.intent_delta=0 then new.intent_delta:=i; end if; return new;
end $$;

create or replace function public.crm_marketing_recalculate_prospect(p_prospect_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare ve integer; vi integer; vl timestamptz; vs text; vst text;
begin
 select least(100,greatest(0,coalesce(sum(score_delta),0))),least(100,greatest(0,coalesce(sum(intent_delta),0))),max(occurred_at) into ve,vi,vl from public.crm_marketing_signals where prospect_id=p_prospect_id;
 select event_type into vs from public.crm_marketing_signals where prospect_id=p_prospect_id order by intent_delta desc,score_delta desc,occurred_at desc limit 1;
 select stage into vst from public.crm_marketing_prospects where id=p_prospect_id;
 if vst not in ('lead','rejected') then vst:=case when vi>=35 or ve>=20 then 'mql' else 'engagement' end; end if;
 update public.crm_marketing_prospects set engagement_score=ve,intent_score=vi,last_signal_at=vl,strongest_signal=vs,stage=vst,updated_at=now() where id=p_prospect_id;
end $$;

create or replace function public.crm_marketing_signal_recalc_trigger() returns trigger language plpgsql security definer set search_path=public as $$ begin perform public.crm_marketing_recalculate_prospect(coalesce(new.prospect_id,old.prospect_id)); return coalesce(new,old); end $$;
drop trigger if exists trg_crm_marketing_signal_defaults on public.crm_marketing_signals;
create trigger trg_crm_marketing_signal_defaults before insert on public.crm_marketing_signals for each row execute function public.crm_marketing_signal_defaults();
drop trigger if exists trg_crm_marketing_signal_recalc on public.crm_marketing_signals;
create trigger trg_crm_marketing_signal_recalc after insert or update or delete on public.crm_marketing_signals for each row execute function public.crm_marketing_signal_recalc_trigger();

drop trigger if exists trg_crm_marketing_partners_touch on public.crm_marketing_partners;
create trigger trg_crm_marketing_partners_touch before update on public.crm_marketing_partners for each row execute function public.crm_touch_updated_at();
drop trigger if exists trg_crm_marketing_campaigns_touch on public.crm_marketing_campaigns;
create trigger trg_crm_marketing_campaigns_touch before update on public.crm_marketing_campaigns for each row execute function public.crm_touch_updated_at();
drop trigger if exists trg_crm_marketing_prospects_touch on public.crm_marketing_prospects;
create trigger trg_crm_marketing_prospects_touch before update on public.crm_marketing_prospects for each row execute function public.crm_touch_updated_at();

create or replace function public.crm_marketing_promote_prospect(p_prospect_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare p public.crm_marketing_prospects%rowtype; c public.crm_marketing_campaigns%rowtype; pr public.crm_marketing_partners%rowtype; v_company_id uuid; v_contact_id uuid; v_lead_id uuid; v_company_name text; v_source text; v_actor text;
begin
 select * into p from public.crm_marketing_prospects where id=p_prospect_id; if not found then raise exception 'Marketing prospect not found'; end if;
 if not public.crm_has_client_access(p.client_id) then raise exception 'Access denied'; end if; if p.lead_id is not null then return p.lead_id; end if; if p.stage='rejected' then raise exception 'Rejected prospect cannot be promoted'; end if;
 if p.campaign_id is not null then select * into c from public.crm_marketing_campaigns where id=p.campaign_id; end if; if p.partner_id is not null then select * into pr from public.crm_marketing_partners where id=p.partner_id; end if;
 if p.prospect_type='business' and nullif(btrim(p.company_name),'') is not null then select id into v_company_id from public.crm_companies where client_id=p.client_id and lower(name)=lower(btrim(p.company_name)) order by created_at asc limit 1; v_company_name:=btrim(p.company_name); else v_company_name:=case when nullif(btrim(p.display_name),'') is not null then 'Privatkunde · '||btrim(p.display_name) else 'Privatkunde · Marketing lead' end; end if;
 if v_company_id is null then insert into public.crm_companies(client_id,name,phone,address,industry,company_summary,relationship_status) values(p.client_id,v_company_name,nullif(btrim(p.phone),''),nullif(btrim(p.metadata->>'address'),''),case when p.prospect_type='business' then nullif(btrim(p.metadata->>'industry'),'') else 'Privatkunde' end,'Marketing lead'||case when nullif(c.name,'') is not null then ' fra kampagnen '||c.name else '' end,'prospect') returning id into v_company_id; end if;
 if nullif(btrim(p.display_name),'') is not null or nullif(btrim(p.email),'') is not null or nullif(btrim(p.phone),'') is not null then insert into public.crm_contacts(client_id,company_id,full_name,phone,email,source_url,verified,source_type,verified_at,confidence,role_relevance,is_decision_maker) values(p.client_id,v_company_id,nullif(btrim(p.display_name),''),nullif(btrim(p.phone),''),nullif(btrim(p.email),''),nullif(btrim(p.social_profile_url),''),p.consent_to_contact,'marketing_inbound',case when p.consent_to_contact then now() else null end,case when p.consent_to_contact then 'high' else 'medium' end,case when p.prospect_type='business' then 'Marketingkontakt' else 'Privatkunde' end,p.prospect_type='private') returning id into v_contact_id; end if;
 v_source:='Marketing'; if nullif(pr.name,'') is not null then v_source:=v_source||' · '||pr.name; end if; if nullif(c.platform,'') is not null then v_source:=v_source||' · '||c.platform; end if;
 insert into public.crm_leads(client_id,company_id,status,score,priority,source,next_action,next_at,planning_type,source_url,source_reference,source_matched_capability,source_scope_verified,source_qualification_required,source_qualification_verified,source_verification_evidence,score_version,score_breakdown) values(p.client_id,v_company_id,'NY',p.intent_score,case when p.intent_score>=80 then 'A' when p.intent_score>=55 then 'B' else 'C' end,v_source,'Kontakt marketing-lead og afklar behov',now()+interval '1 day','flexible',coalesce(nullif(p.social_profile_url,''),nullif(c.landing_url,'')),p.id::text,coalesce(nullif(p.metadata->>'interest',''),'Marketing lead'),true,false,true,jsonb_build_object('marketing_prospect_id',p.id,'campaign_id',p.campaign_id,'partner_id',p.partner_id,'contact_basis',p.contact_basis,'consent_to_contact',p.consent_to_contact,'strongest_signal',p.strongest_signal),'marketing-v1',jsonb_build_object('marketing_intent',p.intent_score,'engagement',p.engagement_score,'strongest_signal',p.strongest_signal)) returning id into v_lead_id;
 begin v_actor:=coalesce(auth.jwt()->>'email','marketing'); exception when others then v_actor:='marketing'; end;
 insert into public.crm_activities(client_id,company_id,lead_id,contact_id,type,actor_type,actor_name,summary,metadata) values(p.client_id,v_company_id,v_lead_id,v_contact_id,'Marketing lead','system',v_actor,'Oprettet fra marketing'||case when nullif(c.name,'') is not null then ': '||c.name else '' end,jsonb_build_object('marketing_prospect_id',p.id,'campaign_id',p.campaign_id,'partner_id',p.partner_id,'intent_score',p.intent_score,'engagement_score',p.engagement_score));
 update public.crm_marketing_prospects set stage='lead',lead_id=v_lead_id,updated_at=now() where id=p.id;
 insert into public.crm_usage_events(client_id,event_type,quantity,metadata) values(p.client_id,'marketing_lead_promoted',1,jsonb_build_object('lead_id',v_lead_id,'marketing_prospect_id',p.id,'campaign_id',p.campaign_id));
 return v_lead_id;
end $$;
grant execute on function public.crm_marketing_recalculate_prospect(uuid) to authenticated;
grant execute on function public.crm_marketing_promote_prospect(uuid) to authenticated;
