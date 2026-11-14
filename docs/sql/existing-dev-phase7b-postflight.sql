-- READ ONLY, history-independent manual SQL Editor variant.
BEGIN READ ONLY;
-- READ ONLY. Run only AFTER separately authorized Phase 7A then Phase 7B.
SELECT c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner) AS owner,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('whatsapp_automation_settings','whatsapp_automation_runs','whatsapp_automation_audit');
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE tablename LIKE 'whatsapp_automation_%' ORDER BY tablename,policyname;
SELECT grantee,table_name,privilege_type FROM information_schema.table_privileges WHERE table_schema='public' AND table_name LIKE 'whatsapp_automation_%' ORDER BY table_name,grantee,privilege_type;
SELECT n.nspname,p.proname,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,p.proconfig,p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.proname IN ('save_whatsapp_automation_settings','reserve_whatsapp_automation','complete_whatsapp_automation','initialize_whatsapp_automation','check_whatsapp_automation') ORDER BY p.proname;
SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgname='initialize_whatsapp_automation';
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public.whatsapp_automation_settings'::regclass,'public.whatsapp_automation_runs'::regclass,'public.whatsapp_automation_audit'::regclass) ORDER BY conrelid,conname;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'whatsapp_automation_%';
SELECT count(*) AS missing_settings FROM public.workspaces w LEFT JOIN public.whatsapp_automation_settings s ON s.workspace_id=w.id WHERE s.workspace_id IS NULL;
-- Immediately after application all settings must be disabled. Later owner
-- changes may legitimately produce draft_only. auto_reply is never valid.
SELECT mode,count(*) FROM public.whatsapp_automation_settings GROUP BY mode;
SELECT count(*) AS inconsistent_sources FROM public.whatsapp_automation_runs r
JOIN public.ai_conversations c ON c.workspace_id=r.workspace_id AND c.id=r.conversation_id
JOIN public.whatsapp_inbound_messages i ON i.workspace_id=r.workspace_id AND i.id=r.source_message_id
WHERE c.channel <> 'whatsapp_test' OR c.connection_id<>r.connection_id OR i.connection_id<>r.connection_id OR i.message_type<>'text'
 OR NOT EXISTS (SELECT 1 FROM public.ai_messages m WHERE m.workspace_id=r.workspace_id AND m.conversation_id=r.conversation_id AND m.position=r.source_position AND m.inbound_message_id=i.id AND m.provider='customer' AND m.role='user' AND m.content=i.body);
SELECT status,count(*) FROM public.whatsapp_automation_runs GROUP BY status;
SELECT count(*) AS expired_reservations FROM public.whatsapp_automation_runs WHERE status='generating' AND updated_at<now()-interval '5 minutes';
-- There must be no delivery queue, network extension, cron or worker introduced
-- by this migration. Review its source; provider statuses are type contracts only.

ROLLBACK;
