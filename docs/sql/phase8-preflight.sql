-- READ ONLY. Run manually later, with the migration administrator. No DDL/DML.
BEGIN READ ONLY;
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
SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;
ROLLBACK;
