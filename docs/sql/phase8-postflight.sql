-- READ ONLY. Does not verify write behavior, RLS impersonation or concurrency.
BEGIN READ ONLY;
SELECT id,version,provisional,prices,limits,features FROM public.subscription_plans ORDER BY id;
SELECT status,plan_id,count(*) FROM public.workspace_subscriptions GROUP BY status,plan_id;
SELECT w.id AS missing_subscription FROM public.workspaces w LEFT JOIN public.workspace_subscriptions s ON s.workspace_id=w.id WHERE s.workspace_id IS NULL;
SELECT n.nspname,c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname IN ('subscription_plans','workspace_subscriptions','subscription_audit','subscription_usage','subscription_reservations','billing_invoices','billing_events');
SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN ('reserve_subscription_ai','get_workspace_billing','transition_subscription','guard_subscription_capacity','ingest_whatsapp_ai_test_message');
SELECT event_object_table,trigger_name,action_timing,event_manipulation FROM information_schema.triggers WHERE trigger_name LIKE '%subscription%' ORDER BY 1,2;
SELECT schemaname,tablename,policyname,roles,cmd,qual FROM pg_policies WHERE tablename IN ('subscription_plans','workspace_subscriptions');
SELECT table_schema,table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('subscription_plans','workspace_subscriptions','subscription_usage','subscription_reservations','billing_events','billing_invoices');
SELECT count(*) AS unexpected_billing_events FROM workspace_private.billing_events;
SELECT count(*) AS unexpected_invoices FROM workspace_private.billing_invoices;
ROLLBACK;
