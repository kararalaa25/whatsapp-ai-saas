#!/usr/bin/env python3
"""Real networkless disposable PostgreSQL. No external URL/container arguments."""
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
import unittest
import uuid
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('compatibility',ROOT/'verification/compatibility/run_database.py')
compat=importlib.util.module_from_spec(spec);spec.loader.exec_module(compat)
b=compat.base
CLOUD=ROOT/'supabase/migrations/20261114221600_cloud_business_runtime.sql'

def literal(value):
    return "'"+str(value).replace("'","''")+"'"
def sql(query,**kwargs):return b.sql(query,**kwargs)
def scalar(query,**kwargs):return b.scalar(query,**kwargs)
def jsonrpc(name,args,role='service_role',actor=None,check=True):
    result=sql('SELECT public.'+name+'('+','.join(args)+');',role=role,actor=actor,check=check)
    if not check:return result
    raw=result.stdout.strip()
    if not raw:return None
    try:return json.loads(raw)
    except json.JSONDecodeError:return raw

class CloudTests(unittest.TestCase):
    def setUp(self):
        self.owner,self.other,self.member=[str(uuid.uuid4()) for _ in range(3)]
        for i in [self.owner,self.other,self.member]:sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{i}','{i}@example.invalid',now());")
        self.a=scalar("SELECT public.create_workspace('Cloud synthetic A');",role='authenticated',actor=self.owner)
        self.b=scalar("SELECT public.create_workspace('Cloud synthetic B');",role='authenticated',actor=self.other)
        sql("UPDATE public.wasla_subscription_plans SET limits=limits||'{\"numbers\":3,\"members\":4,\"cloud_conversations\":20,\"audio_transcriptions\":20,\"ai_generations\":50}',features=features||'{\"cloud_messaging\":true,\"voice\":true,\"automation\":true}' WHERE id='trial';")
        self.phones={};self.channels={}
        for w in [self.a,self.b]:
            phone=str(int(uuid.uuid4().hex[:12],16));self.phones[w]=phone
            sql(f"INSERT INTO workspace_private.cloud_pilot_workspaces(workspace_id,approved,reason) VALUES('{w}',true,'synthetic local fixture');")
            c=scalar(f"INSERT INTO public.cloud_channels(workspace_id,phone_id,waba_id,status) VALUES('{w}','{phone}','200','active') RETURNING id;");self.channels[w]=c
            sql(f"INSERT INTO public.ai_agent_settings(workspace_id,enabled) VALUES('{w}',true); INSERT INTO workspace_private.cloud_credentials VALUES('{w}','{c}','{{\"fixture\":true}}',now()+interval '1 day');")
        sql(f"INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{self.a}','{self.member}','member');")
    def tearDown(self):
        sql(f"UPDATE workspace_private.cloud_jobs SET state='done' WHERE workspace_id IN ('{self.a}','{self.b}');")
    def event(self,w=None,source=None,sender='964700000001',kind='text'):
        w=w or self.a;source=source or 'fixture-'+uuid.uuid4().hex
        value={'key':'message:'+source,'kind':kind,'phoneId':self.phones[w],'wabaId':'200','sourceId':source,'sender':sender,'timestamp':datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')}
        if kind=='text':value['body']='Synthetic question'
        if kind=='audio':value['audio']={'id':'300','mime_type':'audio/ogg','sha256':'a'*64}
        return value
    def accept(self,e,**kw):return jsonrpc('accept_cloud_event',[literal(json.dumps(e))+'::jsonb'],**kw)
    def claim(self):return jsonrpc('cloud_worker',["'claim'"])
    def command(self,name,j,payload=None,**kw):
        return jsonrpc('cloud_worker',[literal(name),literal(j['id'])+'::uuid',literal(j['lease'])+'::uuid',literal(json.dumps(payload or {}))+'::jsonb'],**kw)
    def manage(self,obj,rev,action,actor=None,check=True):return jsonrpc('manage_cloud',[literal(self.a)+'::uuid',literal(obj)+'::uuid',str(rev),literal(action)],role='authenticated',actor=actor or self.owner,check=check)
    def denied(self,query,actor=None,role='authenticated'):
        r=sql(query,role=role,actor=actor or self.owner,check=False);self.assertNotEqual(r.returncode,0,r.stdout);self.assertIn('42501',r.stderr)
    def test_owner_rls_and_workspace_rpc(self):
        for w,actor in [(self.a,self.owner),(self.b,self.other)]:
            self.assertEqual(scalar('SELECT count(*) FROM public.cloud_channels;',role='authenticated',actor=actor),'1')
            panel=jsonrpc('get_cloud_workspace',[literal(w)+'::uuid'],role='authenticated',actor=actor);self.assertEqual(panel['workspaceId'],w)
        for actor in [self.other,self.member]:self.denied(f"SELECT public.get_cloud_workspace('{self.a}');",actor)
        self.denied('SELECT * FROM public.cloud_channels;',role='anon')
    def test_no_client_private_access_or_service_table_bypass(self):
        for role in ['anon','authenticated','service_role']:
            for table in ['cloud_jobs','cloud_credentials','cloud_attempts','cloud_signups','cloud_pilot_workspaces','cloud_audit','workspace_invitations','subscription_requests','cloud_media_reads']:
                self.denied(f'SELECT * FROM workspace_private.{table};',role=role)
            self.assertEqual(scalar(f"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='workspace_private' AND c.relkind='S' AND (has_sequence_privilege('{role}',c.oid,'USAGE') OR has_sequence_privilege('{role}',c.oid,'SELECT') OR has_sequence_privilege('{role}',c.oid,'UPDATE'));"),'0')
        self.denied("SELECT public.cloud_worker('claim');")
        self.denied("SELECT public.accept_cloud_event('{}');")
        self.denied("SELECT workspace_private.review_subscription_request(NULL,0,true,'fake');",role='service_role')
    def test_no_unauthorized_upgrade_or_client_writes(self):
        for actor in [self.owner,self.member,self.other]:
            self.denied(f"UPDATE public.workspace_subscriptions SET status='active',plan_id='business' WHERE workspace_id='{self.a}';",actor)
            self.denied(f"INSERT INTO public.cloud_channels(workspace_id) VALUES('{self.a}');",actor)
        request=jsonrpc('request_subscription_review',[literal(self.a)+'::uuid',"'pro'","'change'"],role='authenticated',actor=self.owner)
        self.assertIsNotNone(request)
        self.assertEqual(scalar(f"SELECT status||':'||plan_id FROM public.workspace_subscriptions WHERE workspace_id='{self.a}';"),'trialing:trial')
    def test_dedup_collision_and_trusted_mapping(self):
        e=self.event();self.assertEqual(self.accept(e),'accepted');self.assertEqual(self.accept(e),'duplicate')
        e['body']='Changed';self.assertNotEqual(self.accept(e,check=False).returncode,0)
        foreign=self.event();foreign['phoneId']='999999999999';self.assertEqual(self.accept(foreign),'ignored')
        self.assertEqual(scalar(f"SELECT count(*) FROM workspace_private.cloud_jobs WHERE workspace_id='{self.a}';"),'1')
    def test_concurrent_duplicate(self):
        e=self.event()
        with concurrent.futures.ThreadPoolExecutor(6) as pool:results=list(pool.map(lambda _:self.accept(e),range(6)))
        self.assertEqual(results.count('accepted'),1);self.assertEqual(results.count('duplicate'),5)
    def test_last_conversation_unit_race(self):
        sql("UPDATE public.wasla_subscription_plans SET limits=limits||'{\"cloud_conversations\":1}' WHERE id='trial';")
        for sender in ['964700000001','964700000002']:self.accept(self.event(sender=sender))
        with concurrent.futures.ThreadPoolExecutor(2) as pool:list(pool.map(lambda _:self.claim(),range(2)))
        self.assertEqual(scalar(f"SELECT count(*) FROM public.cloud_threads WHERE workspace_id='{self.a}';"),'1')
        self.assertEqual(scalar(f"SELECT count(*) FROM workspace_private.cloud_jobs WHERE workspace_id='{self.a}';"),'2')
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}' AND metric='whatsapp_cloud_conversations';"),'1')
    def test_expired_acceptance_and_batch_progression(self):
        sql(f"UPDATE public.workspace_subscriptions SET trial_ends_at=now()-interval '1 second' WHERE workspace_id='{self.a}';")
        self.assertEqual(self.accept(self.event()),'accepted');self.assertEqual(self.accept(self.event(w=self.b)),'accepted')
        j=self.claim();self.assertEqual(j['workspaceId'],self.b)
        self.assertEqual(scalar(f"SELECT count(*) FROM public.cloud_threads WHERE workspace_id='{self.a}';"),'0')
        self.assertEqual(scalar(f"SELECT state FROM workspace_private.cloud_jobs WHERE workspace_id='{self.a}';"),'deferred')
    def test_last_ai_unit_and_idempotency(self):
        sql("UPDATE public.wasla_subscription_plans SET limits=limits||'{\"ai_generations\":1}' WHERE id='trial';")
        jobs=[]
        for sender in ['964700000001','964700000002']:self.accept(self.event(sender=sender));jobs.append(self.claim())
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda j:self.command('reply',j,check=False),jobs))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        winner=jobs[next(i for i,r in enumerate(results) if r.returncode==0)]
        self.assertNotEqual(self.command('reply',winner,check=False).returncode,0)
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}' AND metric='ai_generations';"),'1')
    def test_takeover_blocks_generation_and_dispatch(self):
        self.accept(self.event());j=self.claim();self.command('reply',j);d=self.command('draft',j,{'text':'Synthetic draft'})
        self.manage(j['threadId'],j['revision'],'takeover')
        for command,payload in [('context',{}),('reply',{}),('dispatch',{'draftId':d['id']})]:self.assertNotEqual(self.command(command,j,payload,check=False).returncode,0)
        self.assertNotEqual(self.manage(d['id'],0,'approve',check=False).returncode,0)
    def test_unprojected_new_source_rejects_old_draft(self):
        self.accept(self.event());j=self.claim();self.command('reply',j);d=self.command('draft',j,{'text':'Old draft'})
        self.accept(self.event())
        self.assertNotEqual(self.manage(d['id'],0,'approve',check=False).returncode,0)
        self.assertNotEqual(self.command('dispatch',j,{'draftId':d['id']},check=False).returncode,0)
        self.command('defer',j,{'reason':'processing'})
        sql(f"UPDATE workspace_private.cloud_jobs SET available_at=now() WHERE workspace_id='{self.a}';")
        next_job=self.claim()
        if next_job is None:next_job=self.claim()
        self.assertNotEqual(next_job['id'],j['id'])
        self.assertEqual(scalar(f"SELECT reason FROM workspace_private.cloud_jobs WHERE id='{j['id']}';"),'superseded')
    def test_audio_budget_start_and_lease_binding(self):
        self.accept(self.event(kind='audio'));j=self.claim();self.command('audio',j);self.command('audio',j)
        self.command('audio_started',j)
        self.assertNotEqual(self.command('audio_started',j,check=False).returncode,0)
        wrong={**j,'lease':str(uuid.uuid4())};self.assertNotEqual(self.command('transcript',wrong,{'text':'foreign'},check=False).returncode,0)
        updated=self.command('transcript',j,{'text':'Synthetic Iraqi transcript'});self.assertEqual(updated['text'],'Synthetic Iraqi transcript')
        self.assertEqual(scalar(f"SELECT used FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}' AND metric='audio_transcriptions';"),'1')
    def test_queue_saturation_rollback_and_other_workspace(self):
        sql(f"INSERT INTO workspace_private.cloud_jobs(workspace_id,channel_id,event_key,source_id,kind,sender,payload,source_at,state) SELECT '{self.a}','{self.channels[self.a]}','bulk-'||i||'-{self.a}','bulk-'||i||'-{self.a}','text','964700000001','{{}}',now(),'review' FROM generate_series(1,1000)i;")
        self.assertNotEqual(self.accept(self.event(),check=False).returncode,0)
        self.assertEqual(self.accept(self.event(w=self.b)),'accepted');self.assertEqual(self.claim()['workspaceId'],self.b)
    def test_dispatch_acceptance_status_monotonic_and_unknown_no_retry(self):
        self.accept(self.event());j=self.claim();self.command('reply',j);d=self.command('draft',j,{'text':'Synthetic reply'});self.command('finish',j)
        self.manage(d['id'],0,'approve');j=self.claim();permit=self.command('dispatch',j,{'draftId':d['id']})
        self.command('uncertain',j,{'attemptId':permit['attemptId']})
        self.assertNotEqual(self.manage(d['id'],1,'retry',check=False).returncode,0)
        for status in ['read','sent','failed']:
            e=self.event();e.update(key='status:'+uuid.uuid4().hex,kind='status',sourceId='synthetic-provider-id',status={'id':'synthetic-provider-id','status':status,'recipient_id':j['sender'],'timestamp':'1794690000','biz_opaque_callback_data':permit['attemptId']})
            self.assertEqual(self.accept(e),'accepted')
        self.assertEqual(scalar(f"SELECT status FROM workspace_private.cloud_attempts WHERE id='{permit['attemptId']}';"),'read')
        self.assertEqual(scalar(f"SELECT count(*) FROM public.cloud_messages WHERE source_job='{j['id']}' AND role='assistant';"),'1')
    def test_invitation_confirmed_email_and_member_access(self):
        invited=str(uuid.uuid4());sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{invited}','invite@example.invalid',NULL);")
        result=jsonrpc('create_workspace_invitation',[literal(self.a)+'::uuid',"'invite@example.invalid'"],role='authenticated',actor=self.owner)
        args=[literal(result['token'])]
        self.assertNotEqual(jsonrpc('accept_workspace_invitation',args,role='authenticated',actor=invited,check=False).returncode,0)
        sql(f"UPDATE auth.users SET email_confirmed_at=now() WHERE id='{invited}';")
        self.assertEqual(jsonrpc('accept_workspace_invitation',args,role='authenticated',actor=invited),self.a)
        self.assertEqual(jsonrpc('accept_workspace_invitation',args,role='authenticated',actor=invited),self.a)
        self.denied(f"SELECT public.get_cloud_workspace('{self.a}');",actor=invited)
        jsonrpc('remove_workspace_member',[literal(self.a)+'::uuid',literal(invited)+'::uuid'],role='authenticated',actor=self.owner)
        self.assertNotEqual(jsonrpc('accept_workspace_invitation',args,role='authenticated',actor=invited,check=False).returncode,0)

    def test_catalog_function_acl_and_private_rls(self):
        import re
        names=re.findall(r'CREATE FUNCTION (?:public|workspace_private)\.([a-z_]+)',CLOUD.read_text())
        quoted=','.join(literal(n) for n in names)
        self.assertEqual(scalar(f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','workspace_private') AND p.proname IN ({quoted}) AND (has_function_privilege('anon',p.oid,'EXECUTE') OR (p.prosecdef AND p.proconfig IS DISTINCT FROM ARRAY['search_path=\"\"']::text[]));"),'0')
        self.assertEqual(scalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='workspace_private' AND (c.relname LIKE 'cloud_%' OR c.relname IN ('workspace_invitations','subscription_requests')) AND c.relkind='r' AND NOT c.relrowsecurity;"),'0')
        for table in ['cloud_channels','cloud_threads','cloud_messages','cloud_drafts']:
            self.denied(f'SELECT * FROM public.{table};',role='service_role')
        self.denied(f"SELECT public.get_workspace_team('{self.a}');",role='service_role')

    def prepared(self):
        self.accept(self.event());j=self.claim();self.command('reply',j);d=self.command('draft',j,{'text':'Synthetic reply'});self.command('finish',j);return j,d
    def test_context_retrieval_and_foreign_composite_fk(self):
        sql(f"INSERT INTO public.business_products(workspace_id,name,description,category,sku) VALUES('{self.a}','Only A product','','',''),('{self.b}','Only B product','','','');")
        self.accept(self.event());j=self.claim();context=self.command('context',j)
        self.assertEqual([p['name'] for p in context['knowledge']['products']],['Only A product'])
        self.assertEqual(context['workspaceId'],self.a);self.assertEqual(context['threadId'],j['threadId']);self.assertTrue(context['agent']['enabled'])
        self.assertNotEqual(sql(f"INSERT INTO public.cloud_threads(workspace_id,channel_id,customer_id,last_customer_at) VALUES('{self.b}','{self.channels[self.a]}','964711111111',now());",check=False).returncode,0)
    def test_human_release_and_manual_source_bound_dispatch(self):
        j,d=self.prepared();self.manage(j['threadId'],j['revision'],'takeover')
        rev=int(scalar(f"SELECT revision FROM public.cloud_threads WHERE id='{j['threadId']}';"))
        manual=jsonrpc('save_cloud_manual_draft',[literal(self.a)+'::uuid',literal(j['threadId'])+'::uuid',str(rev),"'Human verified reply'",'0',literal(j['id'])+'::uuid'],role='authenticated',actor=self.owner)
        self.assertEqual(manual,d['id']);self.manage(d['id'],1,'approve');new=self.claim();permit=self.command('dispatch',new,{'draftId':d['id']})
        self.assertEqual(permit['text'],'Human verified reply');self.command('uncertain',new,{'attemptId':permit['attemptId']})
        rev=int(scalar(f"SELECT revision FROM public.cloud_threads WHERE id='{j['threadId']}';"))
        self.assertNotEqual(self.manage(j['threadId'],rev,'release',check=False).returncode,0)
        sql(f"SELECT workspace_private.review_cloud_attempt('{permit['attemptId']}','not_accepted',NULL,'Synthetic evidence of non-acceptance');")
        self.manage(j['threadId'],rev,'release')
    def test_manual_subscription_review_is_not_activation(self):
        for action in ['cancel','renewal','change']:
            request=jsonrpc('request_subscription_review',[literal(self.a)+'::uuid',"'pro'",literal(action)],role='authenticated',actor=self.owner)
            rev=scalar(f"SELECT revision FROM public.workspace_subscriptions WHERE workspace_id='{self.a}';")
            sql(f"SELECT workspace_private.review_subscription_request('{request}',{rev},true,'Synthetic manual review');")
        self.assertEqual(scalar(f"SELECT status||':'||plan_id FROM public.workspace_subscriptions WHERE workspace_id='{self.a}';"),'trialing:trial')
    def test_signup_actor_workspace_binding_and_fail_closed(self):
        sql(f"UPDATE public.cloud_channels SET status='disabled' WHERE id='{self.channels[self.a]}';")
        args=[literal(self.a)+'::uuid',literal(self.channels[self.a])+'::uuid']
        started=jsonrpc('begin_cloud_signup',args,role='authenticated',actor=self.owner)
        payload={'state':started['state'],'userId':self.other,'workspaceId':self.a}
        self.assertNotEqual(jsonrpc('cloud_signup_control',["'claim'",literal(json.dumps(payload))+'::jsonb'],check=False).returncode,0)
        payload['userId']=self.owner;payload['workspaceId']=self.b
        self.assertNotEqual(jsonrpc('cloud_signup_control',["'claim'",literal(json.dumps(payload))+'::jsonb'],check=False).returncode,0)
        payload['workspaceId']=self.a;claim=jsonrpc('cloud_signup_control',["'claim'",literal(json.dumps(payload))+'::jsonb'])
        self.assertNotEqual(jsonrpc('cloud_signup_control',["'activate'",literal(json.dumps(claim))+'::jsonb'],check=False).returncode,0)
        jsonrpc('cloud_signup_control',["'fail'",literal(json.dumps(claim))+'::jsonb'])
        self.assertEqual(scalar(f"SELECT status FROM public.cloud_channels WHERE id='{self.channels[self.a]}';"),'error')
    def test_existing_thread_retained_when_trial_expires(self):
        self.accept(self.event());j=self.claim();self.command('finish',j)
        sql(f"UPDATE public.workspace_subscriptions SET trial_ends_at=now()-interval '1 second' WHERE workspace_id='{self.a}';")
        self.accept(self.event());next_job=self.claim();self.assertEqual(next_job['threadId'],j['threadId'])
        self.assertNotEqual(self.command('reply',next_job,check=False).returncode,0)
        self.assertEqual(scalar(f"SELECT count(*) FROM public.cloud_messages WHERE workspace_id='{self.a}';",role='authenticated',actor=self.owner),'2')
    def test_projection_failure_retains_intake_without_quota(self):
        sql("CREATE FUNCTION verification_private.cloud_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.content='SYNTHETIC_FAILURE' THEN RAISE EXCEPTION 'Synthetic projection fault';END IF;RETURN NEW;END$$; CREATE TRIGGER cloud_test_fault BEFORE INSERT ON public.cloud_messages FOR EACH ROW EXECUTE FUNCTION verification_private.cloud_fault();")
        try:
            e=self.event();e['body']='SYNTHETIC_FAILURE';self.accept(e);self.assertIsNone(self.claim())
            self.assertEqual(scalar(f"SELECT count(*) FROM workspace_private.cloud_jobs WHERE workspace_id='{self.a}';"),'1')
            self.assertEqual(scalar(f"SELECT count(*) FROM public.cloud_threads WHERE workspace_id='{self.a}';"),'0')
            self.assertEqual(scalar(f"SELECT coalesce(sum(used),0) FROM workspace_private.subscription_usage WHERE workspace_id='{self.a}';"),'0')
        finally:sql('DROP TRIGGER cloud_test_fault ON public.cloud_messages;DROP FUNCTION verification_private.cloud_fault();')
    def test_combined_number_capacity_concurrency(self):
        sql("UPDATE public.wasla_subscription_plans SET limits=limits||'{\"numbers\":2}' WHERE id='trial';")
        queries=[f"INSERT INTO public.cloud_channels(workspace_id) VALUES('{self.a}');",f"INSERT INTO public.whatsapp_connections(workspace_id,phone_number_id,waba_id) VALUES('{self.a}','{self.phones[self.a]}1','200');"]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda q:sql(q,check=False),queries))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertEqual(scalar(f"SELECT (SELECT count(*) FROM public.cloud_channels WHERE workspace_id='{self.a}')+(SELECT count(*) FROM public.whatsapp_connections WHERE workspace_id='{self.a}');"),'2')


def main():
    result=None
    try:
        endpoint=b.docker('context','inspect','default','--format','{{.Endpoints.docker.Host}}').stdout.strip()
        assert endpoint=='unix:///var/run/docker.sock'
        b.docker('image','inspect',b.IMAGE) # Cached only: no pull or shared configuration changes.
        b.CONTAINER=b.docker('run','-d','--pull=never','--name','wasla-cloud-'+b.RUN_ID[:12],'--label','wasla.phase9a.run='+b.RUN_ID,'--network','none','--read-only','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=16m','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--memory','1g','--pids-limit','256','-e','POSTGRES_HOST_AUTH_METHOD=trust',b.IMAGE).stdout.strip()
        for _ in range(120):
            if b.docker('exec',b.CONTAINER,'cat','/proc/1/comm',check=False).stdout.strip()=='postgres' and b.docker('exec',b.CONTAINER,'pg_isready','-U','postgres',check=False).returncode==0:break
            time.sleep(.25)
        info=b.verify_container();b.EVIDENCE['isolation']={'endpoint':endpoint,'network':info['HostConfig']['NetworkMode'],'ports':info['HostConfig']['PortBindings'],'mount_types':[m['Type'] for m in info['Mounts']],'tmpfs':info['HostConfig']['Tmpfs'],'image_reference':b.IMAGE,'image_id':info['Image'],'readonly_root':True}
        b.docker('exec','-i',b.CONTAINER,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1',input='CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;')
        for db in ['wasla_phase9a_suite','wasla_phase9a_repeat']:
            b.create_database(db);sql('ALTER TABLE auth.users ADD COLUMN email text,ADD COLUMN email_confirmed_at timestamptz;',db=db)
            b.migrate(db,b.MIGRATIONS)
            snapshot=scalar(compat.SNAPSHOT,db=db)
            sql("CREATE TABLE verification_private.before_cloud_functions AS SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','workspace_private') AND p.prokind='f';",db=db)
            sql((ROOT/'docs/sql/cloud-runtime-preflight.sql').read_text(),db=db)
            sql(CLOUD.read_text(),db=db)
            sql((ROOT/'docs/sql/cloud-runtime-postflight.sql').read_text(),db=db)
            sql((ROOT/'docs/sql/cloud-runtime-monitoring.sql').read_text(),db=db)
            assert scalar(compat.SNAPSHOT,db=db)==snapshot
            assert scalar("SELECT count(*) FROM verification_private.before_cloud_functions old LEFT JOIN pg_proc p ON p.oid=old.oid WHERE p.oid IS NULL OR pg_get_functiondef(p.oid) IS DISTINCT FROM old.definition;",db=db)=='0'
            assert scalar("SELECT count(*) FROM workspace_private.cloud_pilot_workspaces WHERE approved;",db=db)=='0'
            assert scalar("SELECT count(*) FROM public.wasla_subscription_plans WHERE features->'cloud_messaging'<>'false' OR features->'voice'<>'false';",db=db)=='0'
            replay=sql(CLOUD.read_text(),db=db,check=False);assert replay.returncode and 'collision' in replay.stderr
        b.EVIDENCE['engine']=scalar('SELECT version();')
        b.EVIDENCE['migration_chain']=[str(p.relative_to(ROOT)) for p in b.MIGRATIONS+[CLOUD]]
        b.EVIDENCE['migration_sha256']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in b.MIGRATIONS+[CLOUD]}
        b.EVIDENCE['two_fresh_setups_platform_preserved_replay_rejected']='PASS'
        result=unittest.TextTestRunner(verbosity=2,resultclass=b.EvidenceResult).run(unittest.defaultTestLoader.loadTestsFromTestCase(CloudTests))
    except Exception as e:
        b.EVIDENCE['setup_error']=str(e);print(e,file=sys.stderr)
        if getattr(e,'stderr',None):print(e.stderr,file=sys.stderr)
    finally:
        if b.CONTAINER:b.verify_container(require_running=False);b.docker('rm','-f',b.CONTAINER);b.EVIDENCE['cleanup']=True
        b.EVIDENCE['scope']='Real PostgreSQL roles/RLS/SQL concurrency with synthetic auth.uid claims; NOT real Supabase Auth/JWT/PostgREST/browser or provider traffic.'
        (ROOT/'work/cloud-database-results.json').write_text(json.dumps(b.EVIDENCE,indent=2)+'\n')
    return 0 if result and result.wasSuccessful() else 1
if __name__=='__main__':sys.exit(main())
