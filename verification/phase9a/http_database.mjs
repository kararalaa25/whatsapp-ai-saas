// Real route + ingestion adapter + real disposable PostgreSQL. Only the Supabase
// RPC transport is replaced; this is NOT a PostgREST/Auth/browser verification.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHmac } from 'node:crypto'
import { loader } from '../../tests/helpers/load-ts.mjs'
const run=promisify(execFile)
const [container,runId,db,workspace,phone,ingress='public.ingest_whatsapp_ai_test_message']=process.argv.slice(2)
assert.match(container,/^[a-f0-9]{64}$/);assert.match(runId,/^[a-f0-9]{32}$/)
assert.equal(db,'wasla_phase9a_suite');assert.match(workspace,/^[a-f0-9-]{36}$/);assert.match(phone,/^[0-9]+$/)
assert.ok(['public.ingest_whatsapp_ai_test_message','public.ingest_wasla_whatsapp_test_message'].includes(ingress))
const docker=async(...args)=>(await run('docker',['--context','default',...args])).stdout
const info=JSON.parse(await docker('inspect',container))[0]
assert.equal(info.Config.Labels['wasla.phase9a.run'],runId)
assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(info.HostConfig.ReadonlyRootfs,true)
assert.ok(!info.HostConfig.PortBindings||Object.keys(info.HostConfig.PortBindings).length===0)
assert.ok(!info.HostConfig.Binds||info.HostConfig.Binds.length===0)
assert.ok(info.Mounts.every(m=>m.Type==='tmpfs'))
assert.deepEqual(Object.keys(info.HostConfig.Tmpfs).sort(),['/tmp','/var/lib/postgresql/data','/var/run/postgresql'])
async function sql(query){
 // execFile stdin isn't an option; feed the immutable local target using a child
 // with explicit stdin. No shell, URLs, host psql, or user config files.
 const {spawn}=await import('node:child_process')
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['--context','default','exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],{stdio:['pipe','pipe','pipe']})
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d)
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)))
  child.stdin.end("DO $$BEGIN IF inet_server_addr() IS NOT NULL OR current_database()<>'wasla_phase9a_suite' THEN RAISE EXCEPTION 'Unsafe target'; END IF; END$$;\n"+query)
 })
}
assert.equal(await sql(`SELECT run_id FROM verification_private.marker;`),runId)
const literal=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'"
let failId=null,failAfterCommitId=null,calls=0
const secret='synthetic-phase9a-local-signing-secret'
const load=loader({'@supabase/supabase-js':{createClient:()=>({async rpc(name,args){
 assert.equal(name,'ingest_wasla_whatsapp_test_message');assert.equal('p_workspace_id' in args,false)
 calls++;if(args.p_meta_message_id===failId)throw Error('Synthetic transport unavailable')
 const values=['p_phone_number_id','p_waba_id','p_meta_message_id','p_message_type','p_body','p_meta_timestamp','p_sender_id'].map(key=>literal(args[key])).join(',')
 try{
  const data=await sql(`BEGIN; SET LOCAL ROLE service_role; SELECT ${ingress}(${values}); COMMIT;`)
  if(args.p_meta_message_id===failAfterCommitId){failAfterCommitId=null;throw Error('Synthetic response lost after commit')}
  return {data,error:null}
 }
 catch{return {data:null,error:{code:'storage'}}}
}})}},{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_WEBHOOK_SECRET_KEY:'synthetic-local-only',META_APP_SECRET:secret,META_TEST_PHONE_NUMBER_IDS:phone},{Buffer,Uint8Array,TextDecoder,Request,Response,URL})
const route=load('../src/app/api/webhooks/whatsapp/route.ts')
const event=(id,sender='123456789')=>({id,from:sender,timestamp:'1700000000',type:'text',text:{body:`Synthetic route ${id}`}})
async function post(messages,valid=true){
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'200',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:phone},messages}}]}]})
 return route.POST(new Request('https://example.invalid/api/webhooks/whatsapp',{method:'POST',headers:{'x-hub-signature-256':valid?'sha256='+createHmac('sha256',secret).update(body).digest('hex'):'sha256='+'0'.repeat(64)},body}))
}
const prefix='http-'+runId
assert.equal((await post([event(prefix+'-seed')])).status,200)
await sql(`UPDATE public.workspace_subscriptions SET trial_ends_at=now()-interval '1 second' WHERE workspace_id='${workspace}';`)
const batch=[event(prefix+'-deferred','222222222'),event(prefix+'-existing')]
assert.equal((await post(batch)).status,200)
assert.equal((await post(batch)).status,200)
assert.equal(await sql(`SELECT count(*) FROM public.whatsapp_inbound_messages WHERE workspace_id='${workspace}';`),'3')
assert.equal(await sql(`SELECT count(*) FROM public.ai_messages WHERE workspace_id='${workspace}';`),'2')
const before=calls;assert.equal((await post([event(prefix+'-unsigned')],false)).status,403);assert.equal(calls,before)
failId=prefix+'-unavailable';const retry=[event(failId,'333333333'),event(prefix+'-later')]
assert.equal((await post(retry)).status,503)
assert.equal(await sql(`SELECT count(*) FROM public.whatsapp_inbound_messages WHERE workspace_id='${workspace}';`),'4')
failId=null;assert.equal((await post(retry)).status,200)
assert.equal(await sql(`SELECT count(*) FROM public.whatsapp_inbound_messages WHERE workspace_id='${workspace}';`),'5')
failAfterCommitId=prefix+'-ambiguous'
assert.equal((await post([event(failAfterCommitId)])).status,503)
assert.equal((await post([event(prefix+'-ambiguous')])).status,200)
assert.equal(await sql(`SELECT count(*) FROM public.ai_messages m JOIN public.whatsapp_inbound_messages i ON i.workspace_id=m.workspace_id AND i.id=m.inbound_message_id WHERE i.meta_message_id='${prefix}-ambiguous';`),'1')
await sql(`INSERT INTO public.whatsapp_inbound_messages(workspace_id,connection_id,meta_message_id,message_type,body,meta_timestamp)
SELECT '${workspace}',c.id,'http-fill-'||gen_random_uuid(),'text','Synthetic route backlog',now() FROM public.whatsapp_connections c CROSS JOIN generate_series(1,998) n WHERE c.workspace_id='${workspace}';
INSERT INTO workspace_private.whatsapp_intake(workspace_id,inbound_id,connection_id,sender_id,received_at)
SELECT workspace_id,id,connection_id,'999999999',received_at FROM public.whatsapp_inbound_messages WHERE workspace_id='${workspace}' AND body='Synthetic route backlog';`)
assert.equal((await post([event(prefix+'-overflow','777777777'),event(prefix+'-after-full')])).status,503)
assert.equal(await sql(`SELECT count(*) FROM public.whatsapp_inbound_messages WHERE meta_message_id='${prefix}-overflow';`),'0')
assert.equal(await sql(`SELECT count(*) FROM public.whatsapp_inbound_messages WHERE meta_message_id='${prefix}-after-full';`),'1')
assert.equal(await sql(`SELECT count(*) FROM workspace_private.whatsapp_intake WHERE workspace_id='${workspace}' AND status<>'processed';`),'1000')
console.log(JSON.stringify({result:'pass',checks:9,transport:'direct SQL adapter; not PostgREST/Auth',scope:'real webhook route + real ingestion adapter + PostgreSQL'}))
