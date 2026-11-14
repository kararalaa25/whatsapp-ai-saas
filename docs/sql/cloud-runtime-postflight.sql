-- READ ONLY. Run only AFTER independently approved Cloud installation.
-- No tokens, payloads, customer identifiers or invite hashes are selected.
BEGIN TRANSACTION READ ONLY;
SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','workspace_private')
 AND (c.relname LIKE 'cloud_%' OR c.relname IN ('workspace_invitations','subscription_requests'))
 ORDER BY 1,2;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE tablename LIKE 'cloud_%' OR tablename IN ('workspace_invitations','subscription_requests');
SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','workspace_private')
 AND (p.proname LIKE '%cloud%' OR p.proname LIKE '%workspace_invitation%'
 OR p.proname IN ('get_workspace_team','remove_workspace_member','request_subscription_review',
 'get_subscription_requests','withdraw_subscription_request','review_subscription_request'))
 ORDER BY 1,2;
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid IN (to_regclass('public.cloud_threads'),to_regclass('public.cloud_messages'),
 to_regclass('public.cloud_drafts'),to_regclass('workspace_private.cloud_jobs'));
SELECT id,features->'cloud_messaging' AS cloud_disabled,features->'voice' AS voice_disabled,
 limits->'cloud_conversations' AS initial_cloud_limit,limits->'audio_transcriptions' AS initial_audio_limit
 FROM public.wasla_subscription_plans;
SELECT count(*) AS approved_pilots FROM workspace_private.cloud_pilot_workspaces WHERE approved;
-- Expected at initial install: false/false, zero limits, zero approved pilots.
-- Table/sequence ACLs must deny client writes and direct private access;
-- service role gets only explicit RPC execution, not private table access.
ROLLBACK;
