#!/usr/bin/env python3
"""Read-only evidence collection after the blocked local-stack attempt.
Never connects to a database/Auth/API or creates/removes Docker resources.
Private CLI logs stay in work/ and are reduced to safe booleans/error categories.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'work'
state=json.loads((WORK/'state.json').read_text())

def run(*args):
    return subprocess.run(args,cwd=ROOT,check=True,capture_output=True,text=True).stdout.strip()

def docker(*args):
    return run('docker','--context','default',*args)

assert docker('context','inspect','default','--format','{{.Endpoints.docker.Host}}')=='unix:///var/run/docker.sock'
assert not docker('ps','-aq','--filter','label=com.supabase.cli.project='+state['project'])
assert not docker('volume','ls','-q','--filter','label=com.supabase.cli.project='+state['project'])
assert not docker('network','ls','-q','--filter','label=wasla.phase9b.run='+state['run'])
checksums=(WORK/'cli-checksums.txt').read_text()
expected=next(line.split()[0] for line in checksums.splitlines() if line.endswith('supabase_linux_amd64.tar.gz'))
assert hashlib.sha256((WORK/'cli.tar.gz').read_bytes()).hexdigest()==expected
initial=(WORK/'stack-start.log').read_text()
fallback=(WORK/'stack-start-dockerhub.log').read_text()
assert 'https://public.ecr.aws/v2/' in initial and 'Forbidden' in initial
assert 'no space left on device' in fallback
assert 'Started supabase local development setup' not in fallback
assert not (WORK/'stack/supabase/.temp/project-ref').exists()
assert not list((WORK/'stack/supabase/migrations').glob('*.sql'))
assert not (WORK/'fixtures-private.json').exists()
assert not (WORK/'app-process.json').exists()
assert not (ROOT/'.env.local').exists()
source_diff=run('git','diff','7bbb1d8fcda7110425feeb9595e9ecdbb4df105f','--','src','supabase/migrations')
assert source_diff==''
unit=(WORK/'unit.log').read_text();assert 'pass 212' in unit and 'fail 0' in unit
assert 'error TS' not in (WORK/'types.log').read_text()
build=(WORK/'build.log').read_text();assert 'Compiled successfully' in build and 'Route (app)' in build
lint=(WORK/'lint.log').read_text();assert '0 errors' in lint
result={
 'base_commit':'7bbb1d8fcda7110425feeb9595e9ecdbb4df105f',
 'phase8_commit':'e5f44b43d84dcfe5e49f66a8657132982339193e',
 'cli':{'version':run(str(WORK/'bin/supabase'),'--version'),'archive_sha256':expected,'official_checksum_verified':True},
 'docker':{'endpoint':'unix:///var/run/docker.sock','engine':docker('version','--format','{{.Server.Version}}'),'driver':docker('info','--format','{{.Driver}}'),'root':docker('info','--format','{{.DockerRootDir}}')},
 'tooling_failures':[
  {'step':'default official registry pull','status':'FAIL','reason':'public.ecr.aws HTTP 403'},
  {'step':'supported Docker Hub fallback','status':'FAIL','reason':'Docker vfs layer registration: no space left on device'},
 ],
 'integration':{name:{'status':'BLOCKED','reason':'Supabase stack could not be provisioned; no substitute shared endpoint'} for name in ['full_migration_chain','real_auth_and_jwts','postgrest','authenticated_browser']},
 'not_tested':['signup/login/logout','session refresh/revocation','SSR cookies','live RPC/API security','authenticated UI and viewport tests'],
 'regressions':{'unit':{'status':'PASS','passed':212,'failed':0},'typescript':{'status':'PASS'},'lint':{'status':'PASS','existing_warnings':1},'production_build':{'status':'PASS'}},
 'schema_writes':False,'synthetic_users_created':False,'next_dev_started':False,
 'cleanup':{'own_containers_remaining':0,'own_volumes_remaining':0,'own_networks_remaining':0,'preexisting_postgres_image_retained':bool(docker('image','ls','-q','postgres:17'))},
 'app_and_migrations_unchanged':True,
 'keys_or_sessions_in_evidence':False,
}
(ROOT/'verification/phase9b/evidence.json').write_text(json.dumps(result,indent=2)+'\n')
print('Evidence collected: integration BLOCKED; 212 tests/types/lint/build PASS; own project resources absent')
