-- READ ONLY. For manual review AFTER applying the Phase 6A migration.
-- Catalog results supplement, but do not replace, two-owner/member browser tests.
-- Expect three postgres-owned tables with RLS enabled and owner-only SELECT.
SELECT c.oid::regclass AS relation, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity, c.relforcerowsecurity, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('business_products','business_faqs','business_information');
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('business_products','business_faqs','business_information')
ORDER BY tablename, policyname;
-- Expect authenticated SELECT=true; all client writes, anon access, and
-- service_role table grants=false. This inspects effective privileges.
SELECT role_name, table_name,
       has_table_privilege(role_name, 'public.' || table_name, 'SELECT') AS can_select,
       has_table_privilege(role_name, 'public.' || table_name, 'INSERT') AS can_insert,
       has_table_privilege(role_name, 'public.' || table_name, 'UPDATE') AS can_update,
       has_table_privilege(role_name, 'public.' || table_name, 'DELETE') AS can_delete,
       has_table_privilege(role_name, 'public.' || table_name, 'TRUNCATE') AS can_truncate
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
CROSS JOIN (VALUES ('business_products'), ('business_faqs'), ('business_information')) AS tables(table_name);
-- Both functions: postgres owner, SECURITY DEFINER=true, empty search_path;
-- authenticated EXECUTE=true, anon/service_role EXECUTE=false.
SELECT p.oid::regprocedure AS function_name, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig, p.proacl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('save_business_knowledge','delete_business_knowledge');
-- No PUBLIC ACL entries should grant anything on these tables/functions.
SELECT 'table' AS object_type, c.oid::regclass::text AS object_name, acl.privilege_type
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
WHERE n.nspname = 'public' AND c.relname IN ('business_products','business_faqs','business_information') AND acl.grantee = 0
UNION ALL
SELECT 'function', p.oid::regprocedure::text, acl.privilege_type
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
WHERE n.nspname = 'public' AND p.proname IN ('save_business_knowledge','delete_business_knowledge') AND acl.grantee = 0;
-- Inspect workspace FKs, composite identities, price/URL checks and unique topic.
SELECT conrelid::regclass AS relation, conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.business_products'::regclass, 'public.business_faqs'::regclass, 'public.business_information'::regclass)
ORDER BY conrelid::regclass::text, conname;
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('business_products','business_faqs','business_information');
