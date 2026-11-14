-- READ ONLY. Does not verify write behavior, RLS impersonation or concurrency.
BEGIN READ ONLY;
SELECT id,version,provisional,prices,limits,features FROM public.wasla_subscription_plans ORDER BY id;
SELECT status,plan_id,count(*) FROM public.workspace_subscriptions GROUP BY status,plan_id;
SELECT w.id AS missing_subscription FROM public.workspaces w LEFT JOIN public.workspace_subscriptions s ON s.workspace_id=w.id WHERE s.workspace_id IS NULL;
SELECT n.nspname,c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname IN ('wasla_subscription_plans','workspace_subscriptions','subscription_audit','subscription_usage','subscription_reservations','billing_invoices','billing_events','whatsapp_intake','whatsapp_intake_reconciliation');
SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN ('reserve_subscription_ai','get_workspace_billing','transition_subscription','guard_subscription_capacity','ingest_wasla_whatsapp_test_message','ingest_whatsapp_ai_test_message','ingest_whatsapp_test_message','process_whatsapp_intake','get_whatsapp_intake','reconcile_whatsapp_intake');
SELECT event_object_table,trigger_name,action_timing,event_manipulation FROM information_schema.triggers WHERE trigger_name LIKE '%subscription%' ORDER BY 1,2;
SELECT schemaname,tablename,policyname,roles,cmd,qual FROM pg_policies WHERE tablename IN ('wasla_subscription_plans','workspace_subscriptions');
SELECT table_schema,table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('wasla_subscription_plans','workspace_subscriptions','subscription_usage','subscription_reservations','billing_events','billing_invoices','whatsapp_intake','whatsapp_intake_reconciliation');
SELECT count(*) AS unexpected_billing_events FROM workspace_private.billing_events;
SELECT count(*) AS unexpected_invoices FROM workspace_private.billing_invoices;
-- Intake contains no payload copies; only authorized owner RPCs read bodies.
SELECT status,reason,count(*) FROM workspace_private.whatsapp_intake GROUP BY status,reason;
SELECT workspace_id,count(*) AS unexpected_overflow FROM workspace_private.whatsapp_intake
 WHERE status <> 'processed' GROUP BY workspace_id HAVING count(*) > 1000;
SELECT n.nspname,p.proname,pg_get_userbyid(p.proowner) AS owner,p.proacl FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN
 ('ingest_wasla_whatsapp_test_message','ingest_whatsapp_ai_test_message','ingest_whatsapp_test_message','process_whatsapp_intake','get_whatsapp_intake','reconcile_whatsapp_intake');
-- Platform objects must match the saved preflight. No assumptions about columns.
SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('subscription_plans','business_subscriptions') ORDER BY table_name,ordinal_position;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('subscription_plans','business_subscriptions');
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass) OR confrelid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass);
SELECT count(*) AS platform_plans FROM public.subscription_plans;
SELECT count(*) AS platform_subscriptions FROM public.business_subscriptions;
SELECT role_name,p.oid::regprocedure,has_function_privilege(role_name,p.oid,'EXECUTE') AS can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(role_name)
WHERE n.nspname IN ('public','workspace_private') AND p.proname IN
('ingest_whatsapp_ai_test_message','ingest_whatsapp_test_message','ingest_wasla_whatsapp_test_message','get_workspace_billing','transition_subscription','process_whatsapp_intake');
SELECT n.nspname,p.oid::regprocedure,pg_get_userbyid(p.proowner) AS owner,md5(pg_get_functiondef(p.oid)) AS definition_fingerprint,p.proconfig,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','workspace_private') AND p.prokind='f' ORDER BY 1,2;
ROLLBACK;
