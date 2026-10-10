begin;
do $test$
declare uid uuid; sid uuid; cid uuid; result jsonb;
begin
select s.user_id,s.id into uid,sid from auth.sessions s join public.crm_platform_admins a on a.auth_user_id=s.user_id and a.active where s.not_after is null or s.not_after>now() order by s.created_at desc limit 1;
if uid is null then raise exception 'No admin session available for read-only guard test'; end if;
select id into cid from public.crm_clients limit 1;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'aal','aal1')::text,true);
result:=public.crm_api_session_guard(cid,false,true);
if result->>'code'<>'MFA_REQUIRED' then raise exception 'AAL1 unexpectedly allowed: %',result;end if;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'aal','aal2')::text,true);
result:=public.crm_api_session_guard(cid,true,true);
if result->>'allowed'<>'true' then raise exception 'AAL2 admin rejected: %',result;end if;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',gen_random_uuid(),'aal','aal2')::text,true);
result:=public.crm_api_session_guard(cid,true,true);
if result->>'code'<>'SESSION_REVOKED' then raise exception 'Unknown session unexpectedly allowed';end if;
perform set_config('request.jwt.claims','{}',true);
result:=public.crm_api_session_guard(cid,true,true);
if result->>'code'<>'INVALID_LOGIN' then raise exception 'Anonymous unexpectedly allowed';end if;
end;$test$;
rollback;

begin;
do $test$
declare uid uuid; sid uuid; cid uuid; company uuid; prospect uuid; result jsonb; j1 uuid; j2 uuid;
begin
select s.user_id,s.id into uid,sid from auth.sessions s join public.crm_platform_admins a on a.auth_user_id=s.user_id and a.active where s.not_after is null or s.not_after>now() order by s.created_at desc limit 1;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'aal','aal2','role','service_role')::text,true);
result:=public.crm_platform_ops_snapshot_v2();
if not result ? 'delivery_health' then raise exception 'Delivery health missing';end if;
select id,client_id into company,cid from public.crm_companies limit 1;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'aal','aal2','role','authenticated')::text,true);
begin update public.crm_companies set minuba_relationship_status='existing_customer' where id=company;raise exception 'Integration relationship editable';exception when insufficient_privilege then null;end;
begin update public.crm_offers set minuba_offer_id='browser-forged-evidence' where id=(select id from public.crm_offers limit 1);raise exception 'Provider offer evidence editable';exception when insufficient_privilege then null;end;
begin update public.crm_mail_messages set from_email='forged@example.test' where id=(select id from public.crm_mail_messages where direction='inbound' limit 1);raise exception 'Inbound sender evidence editable';exception when insufficient_privilege then null;end;
perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'aal','aal2','role','service_role')::text,true);
select id into prospect from public.crm_marketing_prospects where metadata->>'is_test' is distinct from 'true' limit 1;
if prospect is not null then
 update public.crm_marketing_prospects set consent_to_contact=false,contact_basis=null,metadata=metadata||jsonb_build_object('interest','Kontakt mig','contact_consent',jsonb_build_object('value',false)) where id=prospect;
 if exists(select 1 from public.crm_marketing_prospects where id=prospect and consent_to_contact) then raise exception 'Withdrawal was overwritten';end if;
end if;
update public.crm_usage_limits set allow_mail_send=true,daily_mail_send_limit=10000 where client_id=cid;
j1:=gen_random_uuid();j2:=gen_random_uuid();
insert into public.crm_mail_send_jobs(client_id,send_id,to_email,subject,body_text,follow_up_date,follow_up_at,message_rfc822_id,status) values(cid,j1,'nobody@example.test','Capacity test','No external send',current_date,now()+interval '1 day','<test@lead-manager.invalid>','prepared');
update public.crm_usage_limits set daily_mail_send_limit=1 where client_id=cid;
begin
 insert into public.crm_mail_send_jobs(client_id,send_id,to_email,subject,body_text,follow_up_date,follow_up_at,message_rfc822_id,status) values(cid,j2,'nobody@example.test','Capacity test','No external send',current_date,now()+interval '1 day','<test@lead-manager.invalid>','prepared');
 raise exception 'Mail capacity not enforced';
exception when others then
 if sqlerrm not like '%MAIL_DAILY_LIMIT%' then raise;end if;
end;
end;$test$;
rollback;
