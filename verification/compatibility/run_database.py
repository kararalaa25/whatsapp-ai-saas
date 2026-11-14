#!/usr/bin/env python3
"""Current compatibility chain in a NEW networkless, disposable PostgreSQL only.
Reuses Phase 9A isolation checks; accepts no external DB/container/project target.
"""
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('phase9a', ROOT/'verification/phase9a/run_database.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.PLAN_TABLE = 'public.wasla_subscription_plans'
base.INGRESS_RPC = 'public.ingest_wasla_whatsapp_test_message'
base.MIGRATIONS = base.MIGRATIONS[:6] + [ROOT/'supabase/manual/20261114180000_phase8_existing_development.sql']
original_create = base.create_database
original_review = base.review_script
snapshots = {}

# Different from Wasla's schema on purpose. This is a representative synthetic
# platform model, not a claim to reproduce unknown hosted column definitions.
PLATFORM = """
CREATE TABLE public.subscription_plans (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title text NOT NULL, enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE public.business_subscriptions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 platform_plan bigint NOT NULL REFERENCES public.subscription_plans(id)
);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON public.subscription_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY platform_admin ON public.subscription_plans FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.subscription_plans,public.business_subscriptions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.subscription_plans TO authenticated;
CREATE FUNCTION public.platform_plan_count() RETURNS bigint LANGUAGE sql SET search_path='' AS
 $$SELECT count(*) FROM public.subscription_plans$$;
"""

SNAPSHOT = """SELECT jsonb_build_object(
 'relations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.oid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass)),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass)),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass)),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid IN ('public.subscription_plans'::regclass,'public.business_subscriptions'::regclass)),
 'function',pg_get_functiondef('public.platform_plan_count()'::regprocedure),
 'plans',(SELECT count(*) FROM public.subscription_plans),
 'subscriptions',(SELECT count(*) FROM public.business_subscriptions));"""


def create_database(name):
    original_create(name)
    base.sql(PLATFORM, db=name)
    snapshots[name] = base.scalar(SNAPSHOT, db=name)


def review_script(name, phase, suffix):
    if phase == 'phase7a' and suffix == 'preflight':
        # Capture original definitions after Phases 4–6A, before any inbox changes.
        base.sql("""CREATE TABLE verification_private.legacy_definitions AS
 SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','workspace_private') AND p.prokind='f';""", db=name)
    if phase == 'phase7b' and suffix == 'preflight':
        rejected = base.sql(base.MIGRATIONS[-1].read_text(), db=name, check=False)
        assert rejected.returncode and 'Missing prerequisite' in rejected.stderr
        assert base.scalar("SELECT to_regclass('public.wasla_subscription_plans') IS NULL;", db=name) == 't'
        base.EVIDENCE.setdefault('guard_checks', []).append({'database': name, 'missing_phase7b': 'rejected atomically'})
    if phase == 'phase8' and suffix == 'preflight':
        original = ROOT/'supabase/migrations/20261114180000_phase8_subscriptions.sql'
        rejected = base.sql(original.read_text(), db=name, check=False)
        assert rejected.returncode and 'already exists' in rejected.stderr
        assert base.scalar(SNAPSHOT, db=name) == snapshots[name]
        base.sql("""CREATE TABLE verification_private.pre_phase8_definitions AS
 SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','workspace_private') AND p.prokind='f';""", db=name)
        base.EVIDENCE.setdefault('guard_checks', []).append({'database': name, 'original_conflicting_installer': 'rejected without platform changes'})
    path = ROOT/f'docs/sql/existing-dev-{phase}-{suffix}.sql'
    base.sql(path.read_text(), db=name)
    base.EVIDENCE.setdefault('read_only_scripts', []).append({'database': name, 'script': str(path.relative_to(ROOT)), 'result': 'pass'})
    if phase == 'phase8' and suffix == 'postflight':
        assert base.scalar(SNAPSHOT, db=name) == snapshots[name], 'Platform catalog objects changed'
        assert base.scalar("""SELECT count(*) FROM verification_private.legacy_definitions old
 LEFT JOIN pg_proc p ON p.oid=old.oid
 WHERE p.oid IS NULL OR pg_get_functiondef(p.oid) IS DISTINCT FROM old.definition;""", db=name) == '0'
        assert base.scalar("""SELECT count(*) FROM verification_private.pre_phase8_definitions old
 LEFT JOIN pg_proc p ON p.oid=old.oid
 WHERE p.oid IS NULL OR pg_get_functiondef(p.oid) IS DISTINCT FROM old.definition;""", db=name) == '0'
        base.sql((ROOT/'docs/sql/integration-postflight.sql').read_text(), db=name)
        base.sql((ROOT/'docs/sql/integration-inventory.sql').read_text(), db=name)
        base.EVIDENCE.setdefault('preservation', []).append({'database': name, 'platform_catalog': 'unchanged', 'existing_function_definitions': 'unchanged'})


class CompatibilityTests(base.DatabaseTests):
    def test_existing_platform_catalog_remains_separate_and_usable(self):
        self.assertEqual(base.scalar(SNAPSHOT), snapshots['wasla_phase9a_suite'])
        self.assertEqual(base.scalar('SELECT public.platform_plan_count();'), '0')
        # Rollback-only proof of original identity/FK behavior; no fixture data lost.
        base.sql("""BEGIN;
 INSERT INTO public.subscription_plans(title) VALUES('Synthetic platform-only plan');
 INSERT INTO public.business_subscriptions(platform_plan) SELECT id FROM public.subscription_plans;
 ROLLBACK;""")
        self.assertEqual(base.scalar('SELECT count(*) FROM public.wasla_subscription_plans;'), '4')
        self.assertEqual(base.scalar(SNAPSHOT), snapshots['wasla_phase9a_suite'])

    def test_both_legacy_ingress_functions_denied_and_new_ingress_private(self):
        for signature in [
            'public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamp with time zone,text)',
            'public.ingest_whatsapp_test_message(text,text,text,text,text,timestamp with time zone)',
        ]:
            self.assertEqual(base.scalar(f"SELECT has_function_privilege('service_role','{signature}','EXECUTE');"), 'f')
        self.assertEqual(self.ingest(), 'inserted')
        self.denied(f"SELECT public.ingest_wasla_whatsapp_test_message('{self.phone}','200','unauthorized','text','x',now(),'123456789');", role='anon')


base.create_database = create_database
base.review_script = review_script
base.DatabaseTests = CompatibilityTests

if __name__ == '__main__':
    code = base.main()
    result_path = ROOT/'work/phase9a-database-results.json'
    data = json.loads(result_path.read_text())
    data['scope'] = 'Compatibility SQL chain; real PostgreSQL with Auth stubs, NOT Supabase Auth/PostgREST/browser'
    (ROOT/'work/compatibility-results.json').write_text(json.dumps(data, indent=2)+'\n')
    sys.exit(code)
