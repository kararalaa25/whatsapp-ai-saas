-- READ ONLY, history-independent manual SQL Editor variant.
BEGIN READ ONLY;
DO $$
DECLARE name text;
BEGIN
 FOR name IN SELECT unnest(ARRAY['public.workspaces','public.workspace_members','public.whatsapp_connections','public.whatsapp_inbound_messages','public.ai_agent_settings','public.ai_conversations','public.ai_messages','public.business_products','public.business_faqs','public.business_information','public.subscription_plans','public.business_subscriptions']) LOOP
  IF to_regclass(name) IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: %',name; END IF;
 END LOOP;
 FOR name IN SELECT unnest(ARRAY['public.whatsapp_inbox_state','public.whatsapp_reply_drafts','workspace_private.whatsapp_inbox_usage','public.whatsapp_automation_settings','public.wasla_subscription_plans','public.workspace_subscriptions']) LOOP
  IF to_regclass(name) IS NOT NULL THEN RAISE EXCEPTION 'Unexpected existing new-phase object: %',name; END IF;
 END LOOP;
 IF to_regprocedure('workspace_private.is_workspace_owner(uuid)') IS NULL OR to_regprocedure('public.reserve_ai_preview(uuid)') IS NULL OR to_regprocedure('public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text)') IS NULL
 THEN RAISE EXCEPTION 'Missing owner, quota or ingress prerequisite'; END IF;
END $$;
-- READ ONLY. Manual administrator review BEFORE applying Phase 7A. Not run by Codex.
SELECT current_database(), current_user, current_setting('server_version');
SELECT name, to_regclass(name) AS existing_relation FROM (VALUES
 ('public.workspaces'),('public.workspace_members'),('public.whatsapp_connections'),
 ('public.whatsapp_inbound_messages'),('public.ai_conversations'),('public.ai_messages'),
 ('public.ai_agent_settings'),('public.business_products'),('public.business_faqs'),('public.business_information')
) expected(name);
SELECT to_regprocedure('workspace_private.is_workspace_owner(uuid)') AS owner_helper,
       to_regprocedure('public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text)') AS signed_ingress,
       to_regprocedure('public.reserve_ai_preview(uuid)') AS openai_quota;
-- All new relations/functions/triggers below must be absent before first application.
SELECT to_regclass('public.whatsapp_inbox_state') AS state_table,
       to_regclass('public.whatsapp_reply_drafts') AS draft_table,
       to_regclass('workspace_private.whatsapp_inbox_usage') AS private_quota;
SELECT n.nspname, p.proname, p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname = 'public' AND p.proname IN ('list_whatsapp_inbox','manage_whatsapp_inbox','mark_whatsapp_inbox_read','reserve_whatsapp_inbox_generation','create_whatsapp_inbox_draft','update_whatsapp_inbox_draft'))
   OR (n.nspname = 'workspace_private' AND p.proname IN ('initialize_whatsapp_inbox','sync_whatsapp_inbox_status','guard_whatsapp_inbox_message','receive_whatsapp_inbox_message','lock_whatsapp_inbox','latest_whatsapp_inbox_position','whatsapp_inbox_references'));
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname IN ('initialize_whatsapp_inbox','sync_whatsapp_inbox_status','guard_whatsapp_inbox_message','receive_whatsapp_inbox_message');
-- Inspect prerequisites: owner helper uses actual auth.uid()+owner membership;
-- inbound source and conversation composite tenant identities exist.
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid)
FROM pg_proc p WHERE p.oid IN (to_regprocedure('workspace_private.is_workspace_owner(uuid)'), to_regprocedure('public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text)'));
SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public.ai_conversations'::regclass,'public.ai_messages'::regclass,'public.whatsapp_inbound_messages'::regclass,'public.workspace_members'::regclass);

ROLLBACK;
