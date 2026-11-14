#!/usr/bin/env python3
"""Real PostgreSQL verification. Never accepts a URL, existing DB or container.
Creates a networkless tmpfs container; only synthetic Supabase auth primitives.
Run: python3 verification/phase9a/run_database.py
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
IMAGE = 'postgres@sha256:846a7ddaa67a4b354ae1d21087b683901aa6113a4ed626d3787cfbf6c85e3e07'
RUN_ID = uuid.uuid4().hex
CONTAINER = None
DATABASES = set()
EVIDENCE = {'run_id': RUN_ID, 'engine': None, 'isolation': {}, 'tests': [], 'cleanup': False}


def docker(*args, input=None, check=True):
    return subprocess.run(['docker', '--context', 'default', *args], input=input,
                          text=True, capture_output=True, check=check, timeout=120)


def verify_container(require_running=True):
    assert CONTAINER, 'No test container created'
    value = json.loads(docker('inspect', CONTAINER).stdout)[0]
    assert value['Config']['Labels'].get('wasla.phase9a.run') == RUN_ID
    host = value['HostConfig']
    assert host['NetworkMode'] == 'none' and not host.get('PortBindings')
    assert not host.get('Binds') and host['ReadonlyRootfs']
    assert all(mount['Type'] == 'tmpfs' for mount in value['Mounts'])
    assert set(host.get('Tmpfs',{})) == {'/var/lib/postgresql/data','/var/run/postgresql','/tmp'}
    if require_running:
        assert value['State']['Running']
    return value


def sql(query, db='wasla_phase9a_suite', role=None, actor=None, check=True):
    verify_container()
    assert db in DATABASES and re.fullmatch(r'wasla_phase9a_[a-z_]+', db)
    if role:
        assert role in ('authenticated', 'anon', 'service_role')
        if actor:
            uuid.UUID(actor)
        query = f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL \"request.jwt.claim.sub\"='{actor or ''}';\n{query}\nCOMMIT;"
    guard = "DO $$BEGIN IF inet_server_addr() IS NOT NULL OR current_database() NOT LIKE 'wasla_phase9a_%' THEN RAISE EXCEPTION 'Unsafe verification target'; END IF; END$$;\n"
    result = docker('exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                  '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', db, input=guard + query, check=False)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def scalar(query, **kwargs):
    return sql(query, **kwargs).stdout.strip().splitlines()[-1]


def create_database(name):
    verify_container()
    assert re.fullmatch(r'wasla_phase9a_[a-z_]+', name) and name not in DATABASES
    docker('exec', CONTAINER, 'createdb', '-U', 'postgres', name)
    DATABASES.add(name)
    sql("""CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
-- Deliberately permissive defaults model Supabase's grant risk; migrations must revoke.
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text NOT NULL);
CREATE SCHEMA verification_private;
REVOKE ALL ON SCHEMA verification_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE verification_private.marker(run_id text NOT NULL);
""" + f"INSERT INTO verification_private.marker VALUES('{RUN_ID}');", db=name)


def review_script(name, phase, suffix):
    path=ROOT/f'docs/sql/{phase}-{suffix}.sql'
    content=path.read_text()
    if 'BEGIN READ ONLY;' not in content:
        content='BEGIN READ ONLY;\n'+content+'\nROLLBACK;'
    sql(content,db=name)
    EVIDENCE.setdefault('read_only_scripts',[]).append({'database':name,'script':str(path.relative_to(ROOT)),'result':'pass'})


def migrate(name, files):
    phases={'20261114040000':'phase7a','20261114050000':'phase7b','20261114180000':'phase8'}
    for path in files:
        version,migration_name=path.stem.split('_',1)
        assert version.isdigit() and re.fullmatch(r'[a-z0-9_]+',migration_name)
        phase=phases.get(version)
        if phase:
            review_script(name,phase,'preflight')
        sql(path.read_text(), db=name)
        # Fixture history for read-only review scripts, not a Supabase CLI claim.
        sql(f"INSERT INTO supabase_migrations.schema_migrations VALUES('{version}','{migration_name}');",db=name)
        if phase:
            review_script(name,phase,'postflight')


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.owner, self.other, self.member = (str(uuid.uuid4()) for _ in range(3))
        sql(f"INSERT INTO auth.users VALUES('{self.owner}'),('{self.other}'),('{self.member}');")
        self.a = scalar("SELECT public.create_workspace('Synthetic A');", role='authenticated', actor=self.owner)
        self.b = scalar("SELECT public.create_workspace('Synthetic B');", role='authenticated', actor=self.other)
        self.phone = str(100000 + int(uuid.uuid4().hex[:8], 16))
        self.phone_b = str(int(self.phone) + 1)
        sql(f"""UPDATE public.subscription_plans SET limits=jsonb_set(limits,'{{members}}','2') WHERE id='trial';
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{self.a}','{self.member}','member');
UPDATE public.subscription_plans SET limits=jsonb_set(limits,'{{members}}','1') WHERE id='trial';
INSERT INTO public.whatsapp_connections(workspace_id,phone_number_id,waba_id) VALUES('{self.a}','{self.phone}','200'),('{self.b}','{self.phone_b}','201');
INSERT INTO public.ai_agent_settings(workspace_id,enabled) VALUES('{self.a}',true),('{self.b}',true);""")
        self.ids = []

    def ingest(self, sender='123456789', body='Synthetic question', event=None, tenant='a', check=True):
        event = event or 'synthetic-' + uuid.uuid4().hex
        self.ids.append(event)
        phone, waba = (self.phone, '200') if tenant == 'a' else (self.phone_b, '201')
        # Only synthetic test strings; SQL quote escaping protects the harness too.
        body = body.replace("'", "''")
        result = sql(f"SELECT public.ingest_whatsapp_ai_test_message('{phone}','{waba}','{event}','text','{body}','2026-11-14T00:00:00Z','{sender}');", role='service_role', check=check)
        return result.stdout.strip() if check else result

    def count(self, table, clause='true', tenant=None):
        return int(scalar(f"SELECT count(*) FROM {table} WHERE workspace_id='{tenant or self.a}' AND ({clause});"))

    def expire(self):
        sql(f"UPDATE public.workspace_subscriptions SET trial_ends_at=now()-interval '1 second' WHERE workspace_id='{self.a}';")

    def age(self):
        sql(f"UPDATE workspace_private.whatsapp_intake SET last_attempt_at=now()-interval '6 minutes' WHERE workspace_id='{self.a}'; DELETE FROM workspace_private.whatsapp_intake_reconciliation WHERE workspace_id='{self.a}';")

    def reconcile(self, check=True):
        result = sql(f"SELECT public.reconcile_whatsapp_intake('{self.a}');", role='authenticated', actor=self.owner, check=check)
        return json.loads(result.stdout.strip()) if check else result

    def denied(self, query, role='authenticated', actor=None, code='42501'):
        result = sql(query, role=role, actor=actor or self.owner, check=False)
        self.assertNotEqual(result.returncode, 0, query)
        self.assertIn(code, result.stderr)

    def test_workspace_initialization_and_backfill(self):
        self.assertEqual(self.count('public.workspace_subscriptions'),1)
        self.assertEqual(self.count('public.whatsapp_automation_settings'),1)
        self.assertEqual(scalar(f"SELECT status||':'||plan_id FROM public.workspace_subscriptions WHERE workspace_id='{self.a}';"),'trialing:trial')
        self.assertEqual(scalar("SELECT count(*) FROM public.workspace_subscriptions WHERE workspace_id='10000000-0000-4000-8000-000000000001';"),'1')
        self.assertEqual(scalar("SELECT count(*) FROM public.business_products WHERE workspace_id='10000000-0000-4000-8000-000000000001';"),'30')
        self.assertEqual(scalar("SELECT status FROM public.whatsapp_inbox_state WHERE workspace_id='10000000-0000-4000-8000-000000000001';"),'open')

    def test_owner_member_anon_rls(self):
        self.ingest(); self.ingest(tenant='b')
        for table in ['workspaces','workspace_subscriptions','ai_conversations','whatsapp_inbox_state','whatsapp_reply_drafts','whatsapp_automation_settings']:
            col = 'id' if table=='workspaces' else 'workspace_id'
            self.assertEqual(scalar(f"SELECT count(*) FROM public.{table} WHERE {col}='{self.b}';",role='authenticated',actor=self.owner),'0')
        self.assertEqual(scalar(f"SELECT count(*) FROM public.whatsapp_inbound_messages WHERE workspace_id='{self.a}';",role='authenticated',actor=self.member),'1')
        self.assertEqual(scalar(f"SELECT count(*) FROM public.ai_conversations WHERE workspace_id='{self.a}';",role='authenticated',actor=self.member),'0')
        self.denied('SELECT * FROM public.workspace_subscriptions;',role='anon')
        for actor in [self.member,self.other]:
            self.denied(f"SELECT public.get_workspace_billing('{self.a}');",actor=actor)
            self.denied(f"SELECT public.get_whatsapp_intake('{self.a}',0);",actor=actor)
            self.denied(f"SELECT public.reconcile_whatsapp_intake('{self.a}');",actor=actor)

    def test_private_tables_functions_sequences_and_service_acl(self):
        for role in ['authenticated','anon','service_role']:
            for table in ['subscription_usage','subscription_reservations','billing_events','billing_invoices','whatsapp_intake','whatsapp_intake_reconciliation']:
                self.denied(f'SELECT * FROM workspace_private.{table};',role=role)
            self.denied("SELECT nextval('workspace_private.whatsapp_intake_intake_order_seq');",role=role)
            self.denied(f"SELECT workspace_private.process_whatsapp_intake('{self.a}',gen_random_uuid());",role=role)
            self.denied(f"UPDATE public.workspace_subscriptions SET plan_id='business' WHERE workspace_id='{self.a}';",role=role)
        self.denied(f"SELECT public.reconcile_whatsapp_intake('{self.a}');",role='service_role')
        self.denied(f"SELECT public.ingest_whatsapp_ai_test_message('{self.phone}','200','forged','text','x',now(),'123456789');")
        self.denied(f"SELECT public.ingest_whatsapp_test_message('{self.phone}','200','old-path','text','x',now());",role='service_role')
        self.denied(f"SELECT workspace_private.transition_subscription('{self.a}',0,'active','business','forged');")

    def test_active_quota_expiry_existing_and_foreign_customer(self):
        self.assertEqual(self.ingest(),'inserted')
        self.expire()
        self.assertEqual(self.ingest(sender='222222222'),'deferred')
        self.assertEqual(self.ingest(),'inserted')
        self.assertEqual(self.ingest(tenant='b'),'inserted')
        self.assertEqual(self.count('public.whatsapp_inbound_messages'),3)
        self.assertEqual(self.count('public.ai_conversations'),1)
        self.assertEqual(self.count('public.ai_messages'),2)
        self.assertEqual(self.count('workspace_private.whatsapp_intake',"status='deferred'"),1)
        self.assertEqual(self.reconcile()['processed'],0)

    def test_quota_rollback_and_duplicate_identity(self):
        sql(f"UPDATE public.subscription_plans SET limits=jsonb_set(limits,'{{whatsapp_conversations}}','1') WHERE id='trial';")
        self.assertEqual(self.ingest(),'inserted')
        event='duplicate-'+uuid.uuid4().hex
        self.assertEqual(self.ingest(sender='222222222',event=event),'deferred')
        self.assertEqual(self.ingest(sender='222222222',event=event),'duplicate')
        self.assertEqual(self.count('public.whatsapp_inbound_messages'),2)
        self.assertEqual(self.count('public.ai_conversations'),1)
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}' AND metric='whatsapp_test_conversations';"),'1')
        collision=self.ingest(sender='222222222',event=event,tenant='b',check=False)
        self.assertNotEqual(collision.returncode,0)
        self.assertIn('22023',collision.stderr)

    def snapshot(self):
        return json.loads(scalar(f"""SELECT jsonb_build_object('id',c.id,'revision',c.revision,'state_revision',s.revision,'position',m.position,'source_id',m.inbound_message_id)
FROM public.ai_conversations c JOIN public.whatsapp_inbox_state s ON s.workspace_id=c.workspace_id AND s.conversation_id=c.id
JOIN public.ai_messages m ON m.workspace_id=c.workspace_id AND m.conversation_id=c.id
WHERE c.workspace_id='{self.a}' ORDER BY c.updated_at DESC,m.position DESC LIMIT 1;"""))

    def configure_automation(self, mode='draft_only'):
        rev=scalar(f"SELECT revision FROM public.whatsapp_automation_settings WHERE workspace_id='{self.a}';")
        payload=json.dumps({'mode':mode,'language':'auto','business_rules':'Synthetic rule','working_hours_enabled':False,
            'timezone':'Asia/Baghdad','working_days':[0,1,2,3,4,5,6],'start_minute':0,'end_minute':1440})
        sql(f"SELECT public.save_whatsapp_automation_settings('{self.a}',{rev},'{payload}'::jsonb);",role='authenticated',actor=self.owner)

    def reserve_automation(self, check=True):
        row=self.snapshot()
        rev=scalar(f"SELECT revision FROM public.whatsapp_automation_settings WHERE workspace_id='{self.a}';")
        result=sql(f"SELECT public.reserve_whatsapp_automation('{self.a}','{row['id']}',{row['position']},{row['revision']},{row['state_revision']},{rev});",role='authenticated',actor=self.owner,check=check)
        return result.stdout.strip() if check else result

    def test_concurrent_last_conversation_unit(self):
        sql("UPDATE public.subscription_plans SET limits=jsonb_set(limits,'{whatsapp_conversations}','1') WHERE id='trial';")
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda n:self.ingest(sender=str(700000000+n)),range(8)))
        self.assertEqual(results.count('inserted'),1)
        self.assertEqual(results.count('deferred'),7)
        self.assertEqual(self.count('public.whatsapp_inbound_messages'),8)
        self.assertEqual(self.count('public.ai_conversations'),1)
        self.assertEqual(self.count('public.ai_messages'),1)

    def test_concurrent_duplicate_source(self):
        event='concurrent-'+uuid.uuid4().hex
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda _:self.ingest(event=event),range(16)))
        self.assertEqual(results.count('inserted'),1)
        self.assertEqual(results.count('duplicate'),15)
        self.assertEqual(self.count('public.ai_messages'),1)
        self.assertEqual(self.count('workspace_private.whatsapp_intake'),1)

    def test_reconciliation_bounds_cooldowns_and_identity_order(self):
        self.expire()
        for i in range(30): self.assertEqual(self.ingest(body=f'Synthetic order {i}'),'deferred')
        self.assertEqual(self.reconcile()['attempted'],0)
        self.denied(f"SELECT public.reconcile_whatsapp_intake('{self.a}');",code='54000')
        sql(f"UPDATE public.workspace_subscriptions SET trial_ends_at=now()+interval '1 day' WHERE workspace_id='{self.a}';")
        self.age(); self.assertEqual(self.reconcile(),{'attempted':25,'processed':25})
        self.age(); self.assertEqual(self.reconcile()['processed'],5)
        contents=sql(f"SELECT content FROM public.ai_messages WHERE workspace_id='{self.a}' ORDER BY position;").stdout.strip().splitlines()
        self.assertEqual(contents,[f'Synthetic order {i}' for i in range(30)])
        self.assertEqual(self.count('public.ai_conversations'),1)

    def test_saturation_rolls_back_only_unaccepted_event_and_allows_existing(self):
        self.ingest(); self.expire()
        sql(f"""INSERT INTO public.whatsapp_inbound_messages(workspace_id,connection_id,meta_message_id,message_type,body,meta_timestamp)
SELECT '{self.a}',c.id,'saturation-'||gen_random_uuid(),'text','Synthetic backlog',now() FROM public.whatsapp_connections c CROSS JOIN generate_series(1,1000) n WHERE c.workspace_id='{self.a}';
INSERT INTO workspace_private.whatsapp_intake(workspace_id,inbound_id,connection_id,sender_id,received_at)
SELECT workspace_id,id,connection_id,'999999999',received_at FROM public.whatsapp_inbound_messages WHERE workspace_id='{self.a}' AND body='Synthetic backlog';""")
        failed=self.ingest(sender='777777777',event='overflow-'+uuid.uuid4().hex,check=False)
        self.assertNotEqual(failed.returncode,0); self.assertIn('54000',failed.stderr)
        self.assertEqual(self.count('public.whatsapp_inbound_messages'),1001)
        self.assertEqual(self.count('workspace_private.whatsapp_intake',"status <> 'processed'"),1000)
        self.assertEqual(self.ingest(),'inserted')
        self.assertEqual(self.ingest(tenant='b'),'inserted')
        self.assertEqual(self.count('public.ai_messages'),2)

    def test_fault_retention_retry_limit_and_recovery(self):
        sql("UPDATE verification_private.fault_flag SET enabled=true;")
        self.assertEqual(self.ingest(body='SYNTHETIC_FAIL'),'deferred')
        self.assertEqual(self.count('public.ai_conversations'),0)
        self.assertEqual(self.count('workspace_private.subscription_usage'),0)
        self.assertEqual(self.count('public.whatsapp_inbound_messages'),1)
        for _ in range(5): self.age(); self.reconcile()
        self.assertEqual(scalar(f"SELECT failures||':'||reason FROM workspace_private.whatsapp_intake WHERE workspace_id='{self.a}';"),'5:retry_exhausted')
        self.assertEqual(self.count('public.whatsapp_inbound_messages'),1)
        # Independent recoverable fault; trusted test-only injector is turned off.
        self.assertEqual(self.ingest(sender='222222222',body='SYNTHETIC_FAIL'),'deferred')
        sql("UPDATE verification_private.fault_flag SET enabled=false;")
        self.age(); self.assertEqual(self.reconcile()['processed'],1)
        self.assertEqual(self.count('public.ai_messages'),1)

    def test_disabled_mapping_retention_and_foreign_reconcile(self):
        sql(f"UPDATE public.whatsapp_connections SET status='disabled' WHERE workspace_id='{self.a}';")
        self.assertEqual(self.ingest(),'deferred')
        self.assertEqual(scalar(f"SELECT reason FROM workspace_private.whatsapp_intake WHERE workspace_id='{self.a}';"),'connection_disabled')
        self.denied(f"SELECT public.reconcile_whatsapp_intake('{self.a}');",actor=self.other)
        sql(f"UPDATE public.whatsapp_connections SET status='active' WHERE workspace_id='{self.a}';")
        self.age(); self.assertEqual(self.reconcile()['processed'],1)

    def test_ai_duplicate_and_last_unit_concurrency(self):
        ids=[scalar(f"SELECT public.create_ai_playground('{self.a}');",role='authenticated',actor=self.owner) for _ in range(8)]
        def reserve(c):
            return sql(f"SELECT public.reserve_subscription_ai('{self.a}','{c}',0,'studio');",role='authenticated',actor=self.owner,check=False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            replies=list(pool.map(lambda _:reserve(ids[0]),range(8)))
        self.assertTrue(all(r.returncode==0 for r in replies))
        self.assertEqual(sum(r.stdout.strip()=='t' for r in replies),1)
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.ai_preview_usage WHERE user_id='{self.owner}';"),'1')
        sql("UPDATE public.subscription_plans SET limits=jsonb_set(limits,'{ai_generations}','2') WHERE id='trial';")
        with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
            replies=list(pool.map(reserve,ids[1:]))
        self.assertEqual(sum(r.returncode==0 for r in replies),1)
        self.assertTrue(all(r.returncode==0 or '54000' in r.stderr for r in replies))
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}' AND metric='ai_generations';"),'2')

    def test_ai_daily_cap_rollback_stale_revision_and_foreign_workspace(self):
        c=scalar(f"SELECT public.create_ai_playground('{self.a}');",role='authenticated',actor=self.owner)
        sql(f"INSERT INTO workspace_private.ai_preview_usage VALUES('{self.owner}',(now() AT TIME ZONE 'UTC')::date,50);")
        query=f"SELECT public.reserve_subscription_ai('{self.a}','{c}',0,'studio');"
        self.denied(query,code='54000')
        self.assertEqual(self.count('workspace_private.subscription_usage'),0)
        self.assertEqual(self.count('workspace_private.subscription_reservations'),0)
        self.denied(query,actor=self.other)
        self.denied(f"SELECT public.reserve_subscription_ai('{self.a}','{c}',9,'inbox');",code='40001')

    def test_capacity_concurrency_and_expired_edit_history(self):
        sql(f"INSERT INTO public.business_products(workspace_id,name,description,category,sku) SELECT '{self.a}','Synthetic existing '||n,'','','' FROM generate_series(1,24) n;")
        payload={'name':'Synthetic cap','description':'','category':'','price':None,'currency':'IQD','stock_status':'unknown','sku':'','active':True,'image_url':''}
        def save(_):
            return sql(f"SELECT public.save_business_knowledge('{self.a}','product',NULL,'{json.dumps(payload)}'::jsonb);",role='authenticated',actor=self.owner,check=False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: replies=list(pool.map(save,range(8)))
        self.assertEqual(sum(r.returncode==0 for r in replies),1)
        self.assertTrue(all(r.returncode==0 or '54000' in r.stderr for r in replies))
        self.expire()
        entry=scalar(f"SELECT id FROM public.business_products WHERE workspace_id='{self.a}' LIMIT 1;")
        sql(f"SELECT public.save_business_knowledge('{self.a}','product','{entry}','{json.dumps(payload)}'::jsonb);",role='authenticated',actor=self.owner)
        self.assertEqual(self.count('public.business_products'),25)

    def test_null_grace_paid_upgrades_and_grace_replay(self):
        sql(f"UPDATE public.workspace_subscriptions SET status='past_due',grace_ends_at=NULL WHERE workspace_id='{self.a}';")
        self.assertEqual(scalar(f"SELECT workspace_private.subscription_limit('{self.a}','products');"),'0')
        self.assertEqual(self.ingest(),'deferred')
        self.denied(f"SELECT workspace_private.transition_subscription('{self.a}',0,'active','business','unverified');",code='42501')
        failed=sql(f"SELECT workspace_private.transition_subscription('{self.a}',0,'active','business','unverified');",check=False)
        self.assertNotEqual(failed.returncode,0); self.assertIn('42501',failed.stderr)
        # Synthetic administrator fixture only: exercise a past-due transition.
        sql(f"UPDATE public.workspace_subscriptions SET status='active',plan_id='starter',period_ends_at=now()-interval '1 hour' WHERE workspace_id='{self.a}'; SELECT workspace_private.transition_subscription('{self.a}',0,'past_due','starter','Synthetic grace test');")
        deadline=scalar(f"SELECT grace_ends_at FROM public.workspace_subscriptions WHERE workspace_id='{self.a}';")
        failed=sql(f"SELECT workspace_private.transition_subscription('{self.a}',1,'past_due','starter','Replay');",check=False)
        self.assertNotEqual(failed.returncode,0)
        self.assertEqual(scalar(f"SELECT grace_ends_at FROM public.workspace_subscriptions WHERE workspace_id='{self.a}';"),deadline)

    def test_automation_completion_idempotency_and_never_delivered(self):
        self.ingest(); self.configure_automation(); token=self.reserve_automation(); row=self.snapshot()
        query=f"SELECT public.complete_whatsapp_automation('{self.a}','{row['id']}','{token}','Synthetic local draft','[]',0);"
        draft=scalar(query,role='authenticated',actor=self.owner)
        self.assertEqual(scalar(query,role='authenticated',actor=self.owner),draft)
        self.assertEqual(self.count('public.whatsapp_reply_drafts'),1)
        self.assertEqual(scalar(f"SELECT provider||':'||status FROM public.whatsapp_reply_drafts WHERE id='{draft}';"),'demo:draft')
        self.denied(query,role='service_role')
        self.assertEqual(self.count('workspace_private.subscription_usage',"metric='ai_generations'"),0)

    def test_human_takeover_and_expiry_block_automation(self):
        self.ingest(); self.configure_automation(); token=self.reserve_automation(); row=self.snapshot()
        sql(f"SELECT public.manage_whatsapp_inbox('{self.a}','{row['id']}','pending_human',true,NULL,{row['state_revision']});",role='authenticated',actor=self.owner)
        completion=f"SELECT public.complete_whatsapp_automation('{self.a}','{row['id']}','{token}','Synthetic stale draft','[]',0);"
        self.denied(completion,code='40001')
        self.assertEqual(self.count('public.whatsapp_reply_drafts'),0)
        self.assertNotEqual(self.reserve_automation(check=False).returncode,0)
        self.expire(); self.configure_automation('disabled')
        self.assertEqual(scalar(f"SELECT mode FROM public.whatsapp_automation_settings WHERE workspace_id='{self.a}';"),'disabled')

    def test_human_request_handoff_and_stale_draft_approval(self):
        self.ingest(body='اريد احچي ويا موظف'); self.configure_automation()
        self.assertEqual(self.reserve_automation(),'pending_human')
        self.assertEqual(scalar(f"SELECT status||':'||human_takeover FROM public.whatsapp_inbox_state WHERE workspace_id='{self.a}';"),'pending_human:true')
        self.assertEqual(self.count('public.whatsapp_reply_drafts'),0)
        # Separate customer manual draft, then a new authoritative source makes it stale.
        self.ingest(sender='333333333',body='Synthetic question')
        row=self.snapshot()
        draft=scalar(f"SELECT public.create_whatsapp_inbox_draft('{self.a}','{row['id']}','{row['source_id']}',{row['position']},{row['revision']},'Synthetic manual draft','manual','[]',0);",role='authenticated',actor=self.owner)
        self.ingest(sender='333333333',body='Synthetic newer question')
        self.denied(f"SELECT public.update_whatsapp_inbox_draft('{self.a}','{row['id']}','{draft}',0,'approve',NULL);",code='40001')
        self.assertEqual(scalar(f"SELECT status FROM public.whatsapp_reply_drafts WHERE id='{draft}';"),'draft')

    def test_real_http_route_with_postgres_batch(self):
        outcome=subprocess.run(['node',str(ROOT/'verification/phase9a/http_database.mjs'),CONTAINER,RUN_ID,'wasla_phase9a_suite',self.a,self.phone],cwd=ROOT,text=True,capture_output=True,timeout=120)
        self.assertEqual(outcome.returncode,0,outcome.stderr)
        EVIDENCE['http_database_bridge']=json.loads(outcome.stdout.strip())

    def test_catalog_rls_function_acls_and_no_payment_writer(self):
        self.assertEqual(scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','workspace_private') AND c.relkind='r' AND NOT c.relrowsecurity;"),'0')
        self.assertEqual(scalar("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','workspace_private') AND p.prosecdef AND (pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.proconfig @> ARRAY['search_path=\"\"']);"),'0')
        self.assertEqual(scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) roles(name) WHERE n.nspname='workspace_private' AND c.relkind='r' AND (has_table_privilege(roles.name,c.oid,'SELECT') OR has_table_privilege(roles.name,c.oid,'INSERT'));"),'0')
        self.denied("INSERT INTO workspace_private.billing_events(provider,event_id) VALUES('forged','forged');")
        self.assertEqual(scalar("SELECT count(*) FROM workspace_private.billing_events;"),'0')
        self.assertEqual(scalar("SELECT has_function_privilege('anon','public.reserve_subscription_ai(uuid,uuid,integer,text)','EXECUTE');"),'f')
        self.assertEqual(scalar("SELECT has_function_privilege('service_role','public.reserve_subscription_ai(uuid,uuid,integer,text)','EXECUTE');"),'f')

    def test_intake_reconciliation_race_keeps_single_sources_and_order(self):
        self.expire(); self.ingest(body='Synthetic first retained')
        sql(f"UPDATE public.workspace_subscriptions SET trial_ends_at=now()+interval '1 day' WHERE workspace_id='{self.a}';")
        self.age()
        def reconcile_attempt(_):
            return self.reconcile(check=False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            intake=pool.submit(self.ingest,body='Synthetic next retained')
            checks=[pool.submit(reconcile_attempt,i) for i in range(2)]
            intake.result(); outcomes=[f.result() for f in checks]
        self.assertEqual(sum(r.returncode==0 for r in outcomes),1)
        self.age(); self.reconcile()
        self.assertEqual(self.count('public.whatsapp_inbound_messages'),2)
        self.assertEqual(self.count('public.ai_messages'),2)
        self.assertEqual(self.count('workspace_private.whatsapp_intake',"status='processed'"),2)
        self.assertEqual(sql(f"SELECT content FROM public.ai_messages WHERE workspace_id='{self.a}' ORDER BY position;").stdout.strip().splitlines(),['Synthetic first retained','Synthetic next retained'])

    def test_old_period_key_replay_and_new_utc_bucket(self):
        first=scalar(f"SELECT public.create_ai_playground('{self.a}');",role='authenticated',actor=self.owner)
        second=scalar(f"SELECT public.create_ai_playground('{self.a}');",role='authenticated',actor=self.owner)
        sql(f"""INSERT INTO workspace_private.subscription_usage(workspace_id,metric,period_start,period_end,used)
VALUES('{self.a}','ai_generations',date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'-interval '1 month',date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',1);
INSERT INTO workspace_private.subscription_reservations(workspace_id,metric,operation_key,period_start)
SELECT workspace_id,metric,'{first}:0',period_start FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}';""")
        self.assertEqual(scalar(f"SELECT public.reserve_subscription_ai('{self.a}','{first}',0,'inbox');",role='authenticated',actor=self.owner),'f')
        self.assertEqual(scalar(f"SELECT public.reserve_subscription_ai('{self.a}','{second}',0,'studio');",role='authenticated',actor=self.owner),'t')
        self.assertEqual(self.count('workspace_private.subscription_usage'),2)
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}' AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';"),'1')

    def test_daily_ai_cap_shared_across_owned_workspaces(self):
        extra=scalar("SELECT public.create_workspace('Synthetic same-owner second workspace');",role='authenticated',actor=self.owner)
        sql(f"INSERT INTO public.ai_agent_settings(workspace_id,enabled) VALUES('{extra}',true); INSERT INTO workspace_private.ai_preview_usage VALUES('{self.owner}',(now() AT TIME ZONE 'UTC')::date,49);")
        a=scalar(f"SELECT public.create_ai_playground('{self.a}');",role='authenticated',actor=self.owner)
        b=scalar(f"SELECT public.create_ai_playground('{extra}');",role='authenticated',actor=self.owner)
        def attempt(pair):
            w,c=pair
            return sql(f"SELECT public.reserve_subscription_ai('{w}','{c}',0,'studio');",role='authenticated',actor=self.owner,check=False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(attempt,[(self.a,a),(extra,b)]))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.ai_preview_usage WHERE user_id='{self.owner}';"),'50')
        self.assertEqual(scalar(f"SELECT coalesce(sum(used),0) FROM workspace_private.subscription_usage WHERE workspace_id IN ('{self.a}','{extra}');"),'1')

    def test_expired_inflight_completion_and_closed_thread_history(self):
        self.ingest(); self.configure_automation(); token=self.reserve_automation(); row=self.snapshot()
        self.expire()
        self.denied(f"SELECT public.complete_whatsapp_automation('{self.a}','{row['id']}','{token}','Synthetic in-flight result','[]',0);",code='42501')
        self.assertEqual(self.count('public.whatsapp_reply_drafts'),0)
        sql(f"SELECT public.manage_whatsapp_inbox('{self.a}','{row['id']}','closed',true,NULL,{row['state_revision']});",role='authenticated',actor=self.owner)
        self.assertEqual(self.ingest(body='Synthetic after close'),'inserted')
        self.assertEqual(scalar(f"SELECT status||':'||human_takeover FROM public.whatsapp_inbox_state WHERE workspace_id='{self.a}';"),'pending_human:true')
        self.assertEqual(self.count('public.ai_conversations'),1)
        self.assertEqual(self.count('public.ai_messages'),2)

    def test_automation_lease_retry_bound_and_replaced_tokens(self):
        self.ingest(); self.configure_automation(); first=self.reserve_automation(); row=self.snapshot()
        self.assertNotEqual(self.reserve_automation(check=False).returncode,0)
        for _ in range(2):
            sql(f"UPDATE public.whatsapp_automation_runs SET updated_at=now()-interval '6 minutes' WHERE workspace_id='{self.a}';")
            replacement=self.reserve_automation(); self.assertNotEqual(first,replacement)
        sql(f"UPDATE public.whatsapp_automation_runs SET updated_at=now()-interval '6 minutes' WHERE workspace_id='{self.a}';")
        self.assertNotEqual(self.reserve_automation(check=False).returncode,0)
        self.denied(f"SELECT public.complete_whatsapp_automation('{self.a}','{row['id']}','{first}','Synthetic late result','[]',0);",code='42501')
        self.assertEqual(scalar(f"SELECT attempts FROM public.whatsapp_automation_runs WHERE workspace_id='{self.a}';"),'3')
        self.assertEqual(self.count('public.whatsapp_reply_drafts'),0)

    def test_foreign_source_assignee_and_allocation_guards(self):
        self.ingest(); self.ingest(tenant='b'); row=self.snapshot()
        foreign=scalar(f"SELECT id FROM public.whatsapp_inbound_messages WHERE workspace_id='{self.b}' LIMIT 1;")
        self.denied(f"SELECT public.create_whatsapp_inbox_draft('{self.a}','{row['id']}','{foreign}',{row['position']},{row['revision']},'Synthetic forgery','manual','[]',0);")
        self.denied(f"SELECT public.manage_whatsapp_inbox('{self.a}','{row['id']}','open',false,'{self.other}',{row['state_revision']});")
        extra_phone=str(int(self.phone)+9999999999)
        result=sql(f"INSERT INTO public.whatsapp_connections(workspace_id,phone_number_id,waba_id) VALUES('{self.a}','{extra_phone}','200');",check=False)
        self.assertNotEqual(result.returncode,0); self.assertIn('54000',result.stderr)
        sql(f"UPDATE public.whatsapp_connections SET status='disabled' WHERE workspace_id='{self.a}';")
        result=sql(f"INSERT INTO public.whatsapp_connections(workspace_id,phone_number_id,waba_id) VALUES('{self.a}','{extra_phone}','200');",check=False)
        self.assertNotEqual(result.returncode,0); self.assertIn('54000',result.stderr)
        result=sql(f"UPDATE public.whatsapp_connections SET workspace_id='{self.b}' WHERE workspace_id='{self.a}';",check=False)
        self.assertNotEqual(result.returncode,0); self.assertIn('42501',result.stderr)


    def test_owner_billing_intake_and_inbox_read_rpcs(self):
        self.ingest(); self.ingest(tenant='b')
        billing=json.loads(scalar(f"SELECT public.get_workspace_billing('{self.a}');",role='authenticated',actor=self.owner))
        self.assertEqual(billing['subscription']['workspace_id'],self.a)
        self.assertEqual(billing['subscription']['plan_id'],'trial')
        self.assertEqual(len(billing['plans']),4)
        self.assertTrue(all(p['prices']['IQD']['monthly'] is None for p in billing['plans']))
        self.assertEqual(billing['usage']['numbers'],1)
        self.assertEqual(scalar(f"SELECT count(*) FROM public.list_whatsapp_inbox('{self.a}',NULL,NULL,'all');",role='authenticated',actor=self.owner),'1')
        self.expire(); self.ingest(sender='555551234',body='Synthetic owner-visible retained text')
        page=json.loads(scalar(f"SELECT public.get_whatsapp_intake('{self.a}',0);",role='authenticated',actor=self.owner))
        self.assertEqual(page['outstanding'],1)
        self.assertEqual(page['rows'][0]['body'],'Synthetic owner-visible retained text')
        self.assertEqual(page['rows'][0]['customer_suffix'],'1234')
        self.assertNotIn('sender_id',page['rows'][0])
        self.denied(f"SELECT public.get_whatsapp_intake('{self.a}',1000);",code='22023')

    def test_private_sequence_catalog_grants_and_owner_claims(self):
        for role in ['anon','authenticated','service_role']:
            self.assertEqual(scalar(f"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='workspace_private' AND c.relkind='S' AND (has_sequence_privilege('{role}',c.oid,'USAGE') OR has_sequence_privilege('{role}',c.oid,'SELECT') OR has_sequence_privilege('{role}',c.oid,'UPDATE'));"),'0')
        self.assertEqual(scalar("SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls);"),'0')
        self.assertEqual(scalar("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role';"),'t')
        self.denied(f"SELECT public.list_whatsapp_inbox('{self.a}',NULL,NULL,'all');",actor=self.member)


    def tearDown(self):
        sql("UPDATE verification_private.fault_flag SET enabled=false;")
        sql("UPDATE public.subscription_plans SET limits=jsonb_set(jsonb_set(limits,'{whatsapp_conversations}','50'),'{ai_generations}','50') WHERE id='trial';")


class EvidenceResult(unittest.TextTestResult):
    def addSuccess(self,test):
        super().addSuccess(test); EVIDENCE['tests'].append({'test':test.id(),'result':'pass'})
    def addFailure(self,test,err):
        super().addFailure(test,err); EVIDENCE['tests'].append({'test':test.id(),'result':'fail','detail':self._exc_info_to_string(err,test)})
    def addError(self,test,err):
        super().addError(test,err); EVIDENCE['tests'].append({'test':test.id(),'result':'error','detail':self._exc_info_to_string(err,test)})


def main():
    global CONTAINER
    result = None
    try:
        endpoint = docker('context','inspect','default','--format','{{.Endpoints.docker.Host}}').stdout.strip()
        assert endpoint == 'unix:///var/run/docker.sock', 'Local Docker socket not proven'
        CONTAINER = docker('run','-d','--name','wasla-phase9a-'+RUN_ID[:12],
            '--label','wasla.phase9a.run='+RUN_ID,'--network','none','--read-only',
            '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
            '--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=16m',
            '--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--memory','1g','--pids-limit','256',
            '-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE).stdout.strip()
        for _ in range(120):
            if (docker('exec',CONTAINER,'cat','/proc/1/comm',check=False).stdout.strip()=='postgres'
                and docker('exec',CONTAINER,'pg_isready','-U','postgres',check=False).returncode==0): break
            time.sleep(.25)
        info=verify_container()
        EVIDENCE['isolation']={'endpoint':endpoint,'network':info['HostConfig']['NetworkMode'],'ports':info['HostConfig']['PortBindings'],'mount_types':[m['Type'] for m in info['Mounts']],'tmpfs':info['HostConfig']['Tmpfs'],'image_reference':IMAGE,'image_id':info['Image'],'readonly_root':True}
        docker('exec','-i',CONTAINER,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1',input='CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;')
        create_database('wasla_phase9a_suite')
        EVIDENCE['engine']=scalar('SELECT version();')
        EVIDENCE['target']=scalar("SELECT current_database()||':'||(inet_server_addr() IS NULL)::text;")
        migrate('wasla_phase9a_suite',MIGRATIONS[:4])
        sql("""INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000001');
INSERT INTO public.workspaces(id,name,created_by) VALUES('10000000-0000-4000-8000-000000000001','Synthetic pre-migration tenant','00000000-0000-4000-8000-000000000001');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.whatsapp_connections(workspace_id,phone_number_id,waba_id) VALUES('10000000-0000-4000-8000-000000000001','999','999');
SELECT public.ingest_whatsapp_ai_test_message('999','999','synthetic-backfill','text','Synthetic retained history','2026-11-14','123456789');
INSERT INTO public.business_products(workspace_id,name,description,category,sku) SELECT '10000000-0000-4000-8000-000000000001','Synthetic product '||i,'','','' FROM generate_series(1,30) i;""")
        migrate('wasla_phase9a_suite',MIGRATIONS[4:])
        sql('''CREATE TABLE verification_private.fault_flag(enabled boolean NOT NULL);
INSERT INTO verification_private.fault_flag VALUES(false);
CREATE FUNCTION verification_private.inject_processing_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.content='SYNTHETIC_FAIL' AND EXISTS(SELECT 1 FROM verification_private.fault_flag WHERE enabled) THEN RAISE EXCEPTION 'Synthetic projection failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase9a_synthetic_fault BEFORE INSERT ON public.ai_messages FOR EACH ROW EXECUTE FUNCTION verification_private.inject_processing_fault();''')
        EVIDENCE['migration_chain']=[p.name for p in MIGRATIONS]
        EVIDENCE['migration_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in MIGRATIONS}
        create_database('wasla_phase9a_repeat')
        migrate('wasla_phase9a_repeat',MIGRATIONS)
        EVIDENCE['second_fresh_setup']='pass'
        replay=sql(MIGRATIONS[-1].read_text(),check=False)
        assert replay.returncode!=0 and 'already exists' in replay.stderr
        EVIDENCE['existing_migration_replay']='rejected without data loss'
        result=unittest.TextTestRunner(verbosity=2,resultclass=EvidenceResult).run(unittest.defaultTestLoader.loadTestsFromTestCase(DatabaseTests))
    except Exception as error:
        EVIDENCE['setup_error']=str(error)
        print('VERIFICATION ERROR:',error,file=sys.stderr)
        if isinstance(error,subprocess.CalledProcessError):
            print(error.stderr,file=sys.stderr); EVIDENCE['setup_error_detail']=error.stderr
    finally:
        if CONTAINER:
            verify_container(require_running=False)
            docker('rm','-f',CONTAINER)
            EVIDENCE['cleanup']=True
        (ROOT/'work').mkdir(exist_ok=True)
        (ROOT/'work/phase9a-database-results.json').write_text(json.dumps(EVIDENCE,indent=2)+'\n')
    return 0 if result and result.wasSuccessful() else 1

if __name__=='__main__':
    sys.exit(main())
