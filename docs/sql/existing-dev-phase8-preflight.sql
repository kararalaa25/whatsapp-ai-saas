-- READ ONLY. Run after Phase 7B. Fail closed on missing prerequisites/collisions.
BEGIN READ ONLY;
DO $compatibility_guard$
DECLARE name text;
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Migration administrator postgres required'; END IF;
 FOR name IN SELECT unnest(ARRAY['public.workspaces','public.workspace_members','public.whatsapp_connections','public.whatsapp_inbound_messages','public.ai_agent_settings','public.ai_conversations','public.ai_messages','public.business_products','public.business_faqs','public.business_information','public.whatsapp_inbox_state','public.whatsapp_reply_drafts','public.whatsapp_automation_settings','public.whatsapp_automation_runs','public.whatsapp_automation_audit','public.subscription_plans','public.business_subscriptions']) LOOP
  IF to_regclass(name) IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: %',name; END IF;
 END LOOP;
 FOR name IN SELECT unnest(ARRAY['public.wasla_subscription_plans','public.workspace_subscriptions','workspace_private.subscription_audit','workspace_private.subscription_usage','workspace_private.subscription_reservations','workspace_private.billing_invoices','workspace_private.billing_events','workspace_private.whatsapp_intake','workspace_private.whatsapp_intake_reconciliation']) LOOP
  IF to_regclass(name) IS NOT NULL THEN RAISE EXCEPTION 'Phase 8 object already exists; stop, do not replay: %',name; END IF;
 END LOOP;
 FOR name IN SELECT unnest(ARRAY['workspace_private.audit_subscription','workspace_private.initialize_subscription','workspace_private.subscription_access','workspace_private.subscription_limit','workspace_private.reserve_subscription_unit','public.reserve_subscription_ai','workspace_private.guard_subscription_capacity','workspace_private.meter_subscription_conversation','public.get_workspace_billing','workspace_private.transition_subscription','workspace_private.process_whatsapp_intake','public.ingest_wasla_whatsapp_test_message','public.get_whatsapp_intake','public.reconcile_whatsapp_intake','workspace_private.guard_subscription_draft','workspace_private.guard_subscription_automation']) LOOP
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname=split_part(name,'.',1) AND p.proname=split_part(name,'.',2))
  THEN RAISE EXCEPTION 'Function collision; preserve existing definition: %',name; END IF;
 END LOOP;
 IF to_regprocedure('public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text)') IS NULL
    OR to_regprocedure('workspace_private.is_workspace_owner(uuid)') IS NULL
    OR to_regprocedure('public.reserve_ai_preview(uuid)') IS NULL
 THEN RAISE EXCEPTION 'Missing owner/ingress/quota function prerequisite'; END IF;
END
$compatibility_guard$;
SELECT count(*) AS preserved_platform_plan_rows FROM public.subscription_plans;
SELECT count(*) AS preserved_platform_subscription_rows FROM public.business_subscriptions;
SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('subscription_plans','business_subscriptions') ORDER BY table_name,ordinal_position;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('subscription_plans','business_subscriptions');
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass) OR confrelid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass);
SELECT n.nspname,p.oid::regprocedure,pg_get_userbyid(p.proowner) AS owner,md5(pg_get_functiondef(p.oid)) AS definition_fingerprint,p.proconfig,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','workspace_private') AND p.prokind='f' ORDER BY 1,2;
-- READ ONLY. Run manually later, with the migration administrator. No DDL/DML.

SELECT version(), current_database(), current_user;
SELECT name, to_regclass(name) AS relation FROM unnest(ARRAY[
 'public.workspaces','public.workspace_members','public.whatsapp_connections',
 'public.ai_conversations','public.business_products','public.business_faqs',
 'public.whatsapp_inbox_state','public.whatsapp_reply_drafts',
 'public.whatsapp_automation_settings','public.whatsapp_automation_runs',
 'public.workspace_subscriptions','workspace_private.whatsapp_intake',
 'workspace_private.whatsapp_intake_reconciliation']) name;
SELECT name, to_regprocedure(name) AS procedure FROM unnest(ARRAY[
 'workspace_private.is_workspace_owner(uuid)', 'public.reserve_ai_preview(uuid)',
 'public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamp with time zone,text)']) name;
SELECT n.nspname,c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','workspace_private') AND c.relkind='r';
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public';
SELECT workspace_id,count(*) AS products FROM public.business_products GROUP BY workspace_id HAVING count(*)>25;
SELECT workspace_id,count(*) AS members FROM public.workspace_members GROUP BY workspace_id HAVING count(*)>1;
-- Existing tenants are backfilled to trial, not exempted from insert caps.
-- Inventory all allocated capacity; disabled numbers/inactive catalog rows count.
SELECT w.id, p.products, f.faqs, n.numbers, m.members,
       p.products > 25 OR f.faqs > 25 OR n.numbers > 1 OR m.members > 1 AS above_trial_capacity
FROM public.workspaces w
CROSS JOIN LATERAL (SELECT count(*) AS products FROM public.business_products WHERE workspace_id=w.id) p
CROSS JOIN LATERAL (SELECT count(*) AS faqs FROM public.business_faqs WHERE workspace_id=w.id) f
CROSS JOIN LATERAL (SELECT count(*) AS numbers FROM public.whatsapp_connections WHERE workspace_id=w.id) n
CROSS JOIN LATERAL (SELECT count(*) AS members FROM public.workspace_members WHERE workspace_id=w.id) m;
-- Review migration history manually; Phase 7B is NOT assumed present.

ROLLBACK;
