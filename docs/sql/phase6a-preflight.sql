-- READ ONLY. For a migration administrator to run manually BEFORE Phase 6A.
-- Inspect results; do not execute the migration if prerequisites are missing or
-- any Phase 6A object already exists. These queries do not prove live RLS access.
SELECT current_database(), current_user, current_setting('server_version');
SELECT name, to_regclass(name) AS relation
FROM (VALUES ('public.workspaces'), ('public.workspace_members'),
 ('public.whatsapp_connections'), ('public.whatsapp_inbound_messages'),
 ('public.ai_agent_settings'), ('public.ai_conversations'), ('public.ai_messages')) AS expected(name);
SELECT to_regprocedure('workspace_private.is_workspace_owner(uuid)') AS owner_helper,
       to_regprocedure('public.create_ai_playground(uuid)') AS phase5b_create,
       to_regprocedure('public.save_ai_turn(uuid,uuid,integer,text,text,text)') AS phase5b_save;
-- All five Phase 6A reg* results below must be NULL before first application.
SELECT to_regclass('public.business_products') AS products,
       to_regclass('public.business_faqs') AS faqs,
       to_regclass('public.business_information') AS information,
       to_regprocedure('public.save_business_knowledge(uuid,text,uuid,jsonb)') AS save_rpc,
       to_regprocedure('public.delete_business_knowledge(uuid,text,uuid)') AS delete_rpc;
-- Required helper is a postgres-owned definer with an empty search_path,
-- checks actual owner membership using auth.uid(), and is not executable by anon.
SELECT p.oid::regprocedure AS function_name, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'workspace_private' AND p.proname = 'is_workspace_owner';
SELECT c.oid::regclass AS relation, c.relrowsecurity, c.relacl,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('workspaces','workspace_members','ai_conversations','ai_messages');
