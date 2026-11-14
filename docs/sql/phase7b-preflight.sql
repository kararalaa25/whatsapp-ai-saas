-- READ ONLY. Run before manual application; this file applies nothing.
-- First review Phase 7A preflight, apply 7A only when separately authorized,
-- and review its postflight. Phase 7A is unapplied at Phase 7B delivery.
SELECT version() AS postgres_version;
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
SELECT name, to_regclass(name) AS required_relation
FROM (VALUES ('public.workspaces'),('public.workspace_members'),('public.whatsapp_connections'),
 ('public.whatsapp_inbound_messages'),('public.ai_conversations'),('public.ai_messages'),
 ('public.ai_agent_settings'),('public.business_products'),('public.business_faqs'),
 ('public.business_information'),('public.whatsapp_inbox_state'),('public.whatsapp_reply_drafts')) t(name);
SELECT name, to_regprocedure(name) AS required_function FROM (VALUES
 ('workspace_private.is_workspace_owner(uuid)'),
 ('workspace_private.lock_whatsapp_inbox(uuid,uuid)'),
 ('workspace_private.latest_whatsapp_inbox_position(uuid,uuid)'),
 ('public.reserve_whatsapp_inbox_generation(uuid,uuid,integer,integer)'),
 ('public.create_whatsapp_inbox_draft(uuid,uuid,uuid,integer,integer,text,text,jsonb,integer)'),
 ('public.manage_whatsapp_inbox(uuid,uuid,text,boolean,uuid,integer)')) t(name);
-- All new relation/function identities should be absent before application.
SELECT name,to_regclass(name) AS must_be_absent FROM (VALUES
 ('public.whatsapp_automation_settings'),('public.whatsapp_automation_runs'),('public.whatsapp_automation_audit')) t(name);
SELECT n.nspname,p.proname,p.prosecdef,p.proacl,p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.proname IN ('save_whatsapp_automation_settings','reserve_whatsapp_automation','complete_whatsapp_automation','initialize_whatsapp_automation','check_whatsapp_automation');
SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgname='initialize_whatsapp_automation';
-- Review dependencies and tenant composite keys. No data/phone/body values.
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid IN (to_regclass('public.ai_conversations'),to_regclass('public.whatsapp_connections'),to_regclass('public.whatsapp_inbound_messages'),to_regclass('public.whatsapp_reply_drafts'))
ORDER BY conrelid,conname;
SELECT name FROM pg_timezone_names WHERE name IN ('Asia/Baghdad','UTC');
