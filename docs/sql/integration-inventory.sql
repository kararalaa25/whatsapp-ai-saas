-- READ ONLY. Manual inventory, not a migration or authorization proof.
-- Review the project identity in Dashboard separately: SQL database names are
-- often just "postgres" and cannot prove which Supabase project this is.
BEGIN READ ONLY;
SELECT current_database(), current_user, current_setting('server_version') AS version,
       to_regclass('supabase_migrations.schema_migrations') AS optional_history;
SELECT rolname, rolbypassrls FROM pg_roles
 WHERE rolname IN ('postgres','anon','authenticated','service_role','authenticator');
SELECT name,to_regclass(name) AS relation FROM unnest(ARRAY[
 'auth.users','public.workspaces','public.workspace_members',
 'public.whatsapp_connections','public.whatsapp_inbound_messages',
 'public.ai_agent_settings','public.ai_conversations','public.ai_messages',
 'public.business_products','public.business_faqs','public.business_information',
 'public.whatsapp_inbox_state','public.whatsapp_reply_drafts',
 'public.whatsapp_automation_settings','public.whatsapp_automation_runs','public.whatsapp_automation_audit',
 'public.subscription_plans','public.business_subscriptions','public.wasla_subscription_plans','public.workspace_subscriptions',
 'workspace_private.subscription_audit','workspace_private.subscription_usage',
 'workspace_private.subscription_reservations','workspace_private.billing_events',
 'workspace_private.billing_invoices','workspace_private.whatsapp_intake',
 'workspace_private.whatsapp_intake_reconciliation']) name;
SELECT name,to_regprocedure(name) AS procedure FROM unnest(ARRAY[
 'auth.uid()','public.create_workspace(text)',
 'workspace_private.is_workspace_member(uuid)','workspace_private.is_workspace_owner(uuid)',
 'public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamp with time zone,text)',
 'public.ingest_wasla_whatsapp_test_message(text,text,text,text,text,timestamp with time zone,text)',
 'public.reserve_subscription_ai(uuid,uuid,integer,text)',
 'public.get_workspace_billing(uuid)','public.get_whatsapp_intake(uuid,integer)',
 'public.reconcile_whatsapp_intake(uuid)']) name;
-- Missing objects are evidence of absence; present objects are NOT evidence that
-- the exact migration file was applied. Compare definitions, ACLs and checksums.
SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity,c.relforcerowsecurity,c.relacl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','workspace_private') AND c.relkind IN ('r','S')
 ORDER BY 1,2;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
 FROM pg_policies WHERE schemaname IN ('public','workspace_private') ORDER BY 1,2,3;
SELECT n.nspname,p.oid::regprocedure AS signature,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
 EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
 md5(pg_get_functiondef(p.oid)) AS definition_fingerprint
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','workspace_private') AND p.prokind='f'
 ORDER BY 1,2;
SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('public','workspace_private') ORDER BY 1,2,3;
SELECT n.nspname,c.relname,r.role,
 has_table_privilege(r.role,c.oid,'SELECT') AS can_select,
 has_table_privilege(r.role,c.oid,'INSERT') AS can_insert,
 has_table_privilege(r.role,c.oid,'UPDATE') AS can_update,
 has_table_privilege(r.role,c.oid,'DELETE') AS can_delete,
 has_table_privilege(r.role,c.oid,'TRUNCATE') AS can_truncate
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(role)
 WHERE n.nspname IN ('public','workspace_private') AND c.relkind='r' ORDER BY 1,2,3;
SELECT n.nspname,c.relname,r.role,
 has_sequence_privilege(r.role,c.oid,'USAGE') AS can_use,
 has_sequence_privilege(r.role,c.oid,'SELECT') AS can_select,
 has_sequence_privilege(r.role,c.oid,'UPDATE') AS can_update
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(role)
 WHERE n.nspname='workspace_private' AND c.relkind='S' ORDER BY 2,3;
SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname,d.defaclobjtype,d.defaclacl
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace;
ROLLBACK;
