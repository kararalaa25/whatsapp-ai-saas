-- READ ONLY, history-independent manual SQL Editor variant.
BEGIN READ ONLY;
-- READ ONLY. Run manually AFTER the reviewed Phase 7A migration, never as proof
-- that PostgreSQL authorization/concurrency has been exercised by mocked tests.
SELECT c.oid::regclass AS relation, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname = 'public' AND c.relname IN ('whatsapp_inbox_state','whatsapp_reply_drafts')) OR (n.nspname = 'workspace_private' AND c.relname = 'whatsapp_inbox_usage');
SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN ('whatsapp_inbox_state','whatsapp_reply_drafts')) OR (schemaname = 'workspace_private' AND tablename = 'whatsapp_inbox_usage');
-- Expect authenticated SELECT only on public workflow tables; no client DML,
-- no anon/service-role grants, and no client rights on the private quota table.
SELECT role_name, relation,
 has_table_privilege(role_name, relation, 'SELECT') AS can_select,
 has_table_privilege(role_name, relation, 'INSERT') AS can_insert,
 has_table_privilege(role_name, relation, 'UPDATE') AS can_update,
 has_table_privilege(role_name, relation, 'DELETE') AS can_delete,
 has_table_privilege(role_name, relation, 'TRUNCATE') AS can_truncate
FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(role_name)
CROSS JOIN (VALUES ('public.whatsapp_inbox_state'),('public.whatsapp_reply_drafts'),('workspace_private.whatsapp_inbox_usage')) objects(relation);
-- Expect postgres-owned functions with empty search_path; only public RPCs
-- executable by authenticated; private helpers/triggers executable by no client.
SELECT n.nspname, p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
 pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname = 'public' AND p.proname IN ('list_whatsapp_inbox','manage_whatsapp_inbox','mark_whatsapp_inbox_read','reserve_whatsapp_inbox_generation','create_whatsapp_inbox_draft','update_whatsapp_inbox_draft'))
   OR (n.nspname = 'workspace_private' AND p.proname IN ('initialize_whatsapp_inbox','sync_whatsapp_inbox_status','guard_whatsapp_inbox_message','receive_whatsapp_inbox_message','lock_whatsapp_inbox','latest_whatsapp_inbox_position','whatsapp_inbox_references'));
SELECT tgname, tgrelid::regclass, tgenabled, pg_get_triggerdef(oid) FROM pg_trigger
WHERE NOT tgisinternal AND tgname IN ('initialize_whatsapp_inbox','sync_whatsapp_inbox_status','guard_whatsapp_inbox_message','receive_whatsapp_inbox_message');
SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public.whatsapp_inbox_state'::regclass,'public.whatsapp_reply_drafts'::regclass);
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('whatsapp_inbox_state','whatsapp_reply_drafts','ai_conversations','ai_messages');
-- Expect zero missing metadata rows. No customer content/identifiers are returned.
SELECT count(*) AS whatsapp_conversations_missing_state FROM public.ai_conversations c
LEFT JOIN public.whatsapp_inbox_state s ON s.workspace_id = c.workspace_id AND s.conversation_id = c.id
WHERE c.channel = 'whatsapp_test' AND s.conversation_id IS NULL;
-- Expect zero unverified WhatsApp customer rows. A nonzero count requires review,
-- not blind repair/deletion. Do not turn old drafts into customer messages.
SELECT count(*) AS unmatched_customer_sources FROM public.ai_messages m
JOIN public.ai_conversations c ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id AND c.channel = 'whatsapp_test'
LEFT JOIN public.whatsapp_inbound_messages i ON i.workspace_id = m.workspace_id AND i.id = m.inbound_message_id AND i.connection_id = c.connection_id AND i.body = m.content AND i.message_type = 'text'
WHERE m.role = 'user' AND (m.provider <> 'customer' OR i.id IS NULL);

ROLLBACK;
