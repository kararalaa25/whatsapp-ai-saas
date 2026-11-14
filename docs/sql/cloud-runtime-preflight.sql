-- READ ONLY. New Cloud runtime only. Do not replay applied Phase 7/8 SQL.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name, current_user AS executor,
       version() AS postgres_version;
SELECT name, to_regclass(name) IS NOT NULL AS prerequisite_present
FROM unnest(ARRAY['public.workspaces','public.workspace_members','public.ai_agent_settings',
 'public.business_products','public.business_faqs','public.business_information','public.whatsapp_connections','public.whatsapp_inbound_messages','public.whatsapp_inbox_state','public.whatsapp_reply_drafts','public.whatsapp_automation_settings',
 'public.workspace_subscriptions','public.wasla_subscription_plans',
 'workspace_private.subscription_usage','workspace_private.ai_preview_usage',
 'workspace_private.whatsapp_inbox_usage','auth.users']) AS names(name);
SELECT name, to_regprocedure(name) IS NOT NULL AS prerequisite_present
FROM unnest(ARRAY['workspace_private.is_workspace_owner(uuid)',
 'workspace_private.reserve_subscription_unit(uuid,text,text,integer)',
 'workspace_private.subscription_limit(uuid,text)',
 'workspace_private.subscription_access(public.workspace_subscriptions)']) AS names(name);
SELECT column_name FROM information_schema.columns WHERE table_schema='auth'
 AND table_name='users' AND column_name IN ('email','email_confirmed_at');
SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE conrelid=to_regclass('workspace_private.subscription_usage');
SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relname LIKE 'cloud_%' OR c.relname IN ('workspace_invitations','subscription_requests');
-- Expect no new Cloud objects before installation; investigate every collision.
-- Preserve platform plan table/FKs/policies; this migration does not alter them.
SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('subscription_plans','business_subscriptions');
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid=to_regclass('public.business_subscriptions');
ROLLBACK;
