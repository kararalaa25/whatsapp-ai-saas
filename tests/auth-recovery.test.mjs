import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loader } from './helpers/load-ts.mjs'

const env = { NEXT_PUBLIC_APP_URL:'https://development.example', NODE_ENV:'development' }
const idle={status:'idle',message:''}
function form(values) { const f=new FormData();for(const [k,v] of Object.entries(values)) f.set(k,v);return f }
function harness(auth, overrides={}) {
 let creations=0
 const load=loader({'@/utils/supabase/server':{createClient:async()=>{creations++;return {auth}}}}, {...env,...overrides})
 return {load,creations:()=>creations}
}
test('recovery email acknowledgment is neutral for success, unknown accounts, rate limits and transport failures',async()=>{
 for(const outcome of ['ok','missing','rate','throw']){
  let calls=0
  const h=harness({resetPasswordForEmail:async(email,options)=>{
   calls++;assert.equal(email,'owner@example.test');assert.equal(options.redirectTo,'https://development.example/auth/recovery')
   if(outcome==='throw')throw Error('private provider error')
   return {error:outcome==='ok'?null:{code:outcome}}
  }})
  const result=await h.load('../src/app/forgot-password/actions.ts').requestPasswordReset(idle,form({email:' Owner@Example.test '}))
  assert.equal(result.status,'sent');assert.equal(calls,1)
  assert.doesNotMatch(JSON.stringify(result),/missing|rate|private provider/)
 }
})
test('malformed or repeated email input never calls Auth',async()=>{
 const h=harness({resetPasswordForEmail:()=>assert.fail('must not send')})
 const action=h.load('../src/app/forgot-password/actions.ts').requestPasswordReset
 for(const email of ['', 'bad', 'x'.repeat(255)+'@a.test'])assert.equal((await action(idle,form({email}))).status,'error')
 const duplicated=form({email:'a@example.test'});duplicated.append('email','b@example.test')
 assert.equal((await action(idle,duplicated)).status,'error');assert.equal(h.creations(),0)
})
test('recovery and signup reject unsafe configured redirect origins before calling Auth',async()=>{
 for(const origin of ['http://not-local.test','https://good.test/path','https://good.test?next=evil','https://user@host.test',' https://host.test','https://good.test\\evil']){
  const h=harness({}, {NEXT_PUBLIC_APP_URL:origin})
  const result=await h.load('../src/app/forgot-password/actions.ts').requestPasswordReset(idle,form({email:'owner@example.test'}))
  assert.equal(result.status,'sent');assert.equal(h.creations(),0)
  assert.equal((await h.load('../src/app/signup/actions.ts').signup(form({fullName:'Synthetic',email:'owner@example.test',password:'test-pass-123',confirmPassword:'test-pass-123'}))).status,'error')
 }
 const local=harness({}, {NEXT_PUBLIC_APP_URL:'http://localhost:3000'})
 assert.equal(local.load('../src/utils/auth/origin.ts').applicationOrigin(),'http://localhost:3000')
 const production=harness({}, {NEXT_PUBLIC_APP_URL:'http://localhost:3000',NODE_ENV:'production'})
 assert.throws(()=>production.load('../src/utils/auth/origin.ts').applicationOrigin())
})
test('signup uses fixed callback and stores only business-independent display metadata',async()=>{
 const h=harness({signUp:async args=>{
  assert.equal(args.options.emailRedirectTo,'https://development.example/auth/callback')
  assert.equal(args.options.data.full_name,'Owner');assert.equal(Object.keys(args.options.data).length,1)
  assert.equal(args.email,'owner@example.test');return {error:null}
 }})
 const result=await h.load('../src/app/signup/actions.ts').signup(form({fullName:' Owner ',email:'Owner@Example.test',password:'test-pass-123',confirmPassword:'test-pass-123',role:'owner',workspace_id:'foreign'}))
 assert.equal(result.status,'check_email')
})
test('password update requires a live Auth user and validates form before any update',async()=>{
 for(const identity of [{data:{user:null},error:null},{data:{user:{id:'owner'}},error:{code:'expired'}}]){
  const h=harness({getUser:async()=>identity,updateUser:()=>assert.fail('unauthorized update')})
  assert.equal((await h.load('../src/app/reset-password/actions.ts').updatePassword(idle,form({password:'new-pass-123',confirmPassword:'new-pass-123'}))).message,'session')
 }
 const h=harness({})
 for(const password of ['short',' '.repeat(10),'a'.repeat(129)])assert.equal((await h.load('../src/app/reset-password/actions.ts').updatePassword(idle,form({password,confirmPassword:password}))).status,'error')
 assert.equal((await h.load('../src/app/reset-password/actions.ts').updatePassword(idle,form({password:'new-pass-123',confirmPassword:'other-pass-123'}))).status,'error')
 assert.equal(h.creations(),0)
})
test('password update is caller-only and reports global sign-out failure honestly',async()=>{
 for(const signout of ['ok','error','throw']){
  const h=harness({getUser:async()=>({data:{user:{id:'owner'}},error:null}),updateUser:async args=>{
   assert.equal(Object.keys(args).join(','),'password');return {data:{user:{id:'owner'}},error:null}
  },signOut:async options=>{assert.equal(options.scope,'global');if(signout==='throw')throw Error('private');return {error:signout==='error'?{}:null}}})
  const result=await h.load('../src/app/reset-password/actions.ts').updatePassword(idle,form({password:'new-pass-123',confirmPassword:'new-pass-123',user_id:'foreign'}))
  assert.equal(result.status,'updated');assert.equal(result.message,signout==='ok'?'updated':'signout')
 }
})
test('password provider errors and mismatched returned identity cannot produce success or leak details',async()=>{
 for(const reply of [{data:{user:null},error:{message:'private'}},{data:{user:{id:'foreign'}},error:null}]){
  const h=harness({getUser:async()=>({data:{user:{id:'owner'}},error:null}),updateUser:async()=>reply,signOut:()=>assert.fail('not confirmed')})
  const result=await h.load('../src/app/reset-password/actions.ts').updatePassword(idle,form({password:'new-pass-123',confirmPassword:'new-pass-123'}))
  assert.equal(result.status,'error');assert.doesNotMatch(JSON.stringify(result),/private|foreign/)
 }
})
function callback(auth) {
 let calls=0
 const load=loader({'next/server':{NextResponse:{redirect:(url,status)=>new Response(null,{status,headers:{Location:String(url)}})}},'@/utils/supabase/server':{createClient:async()=>{calls++;return {auth}}}}, {},{Response})
 return {route:load('../src/app/auth/recovery/route.ts'),calls:()=>calls}
}
const request=query=>({url:`https://development.example/auth/recovery${query}`,nextUrl:new URL(`https://development.example/auth/recovery${query}`)})
test('PKCE and recovery OTP callbacks use fixed private redirects and ignore hostile next destinations',async()=>{
 for(const query of ['?code=synthetic&next=https://evil.test','?token_hash=synthetic&type=recovery&next=//evil.test']){
  const c=callback({exchangeCodeForSession:async()=>({data:{user:{id:'owner'},session:{}},error:null}),verifyOtp:async args=>{assert.equal(args.type,'recovery');return {data:{user:{id:'owner'},session:{}},error:null}}})
  const response=await c.route.GET(request(query))
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),'https://development.example/reset-password')
  assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer')
 }
})
test('ambiguous, duplicate, wrong-type and provider-error recovery links fail before Auth',async()=>{
 for(const query of ['', '?code=a&code=b','?code=a&token_hash=b&type=recovery','?token_hash=a&type=signup','?token_hash=a&type=recovery&type=recovery','?code=a&error=denied','?code=%0A','?code='+ 'a'.repeat(4097)]){
  const c=callback({});const response=await c.route.GET(request(query))
  assert.equal(response.headers.get('location'),'https://development.example/forgot-password?error=recovery');assert.equal(c.calls(),0)
 }
})
test('reused or failed exchange cannot redirect to password update',async()=>{
 for(const outcome of [{data:{user:{id:'owner'},session:null},error:null},{data:{user:{id:'owner'},session:{}},error:{code:'expired'}}]){
  const c=callback({exchangeCodeForSession:async()=>outcome})
  assert.match((await c.route.GET(request('?code=synthetic'))).headers.get('location'),/forgot-password/)
 }
})
const link=props=>{const rest={...props};delete rest.prefetch;return React.createElement('a',rest,props.children)}
test('homepage is branded Arabic RTL, has working account links and discloses disabled delivery/payments',()=>{
 const home=loader({'next/link':{default:link}})('../src/app/page.tsx').default
 const html=renderToStaticMarkup(home())
 assert.match(html,/dir="rtl"/);assert.match(html,/Wasla AI/);assert.match(html,/href="\/signup"/);assert.match(html,/href="\/login"/)
 assert.match(html,/غير مفعّلين/);assert.doesNotMatch(html,/Create Next App|Deploy Now|edit.*page.tsx/)
})
test('password form has labeled accessible Arabic and English controls and disables submission while pending',()=>{
 for(const english of [false,true]){
  const component=loader({'next/link':{default:link},react:{...React,useActionState:()=>[idle,()=>{},true]},'@/app/forgot-password/actions':{requestPasswordReset:()=>{}},'@/app/reset-password/actions':{updatePassword:()=>{}}})('../src/components/auth/password-form.tsx').default
  const html=renderToStaticMarkup(component({mode:'update',english}))
  assert.match(html,/aria-busy="true"/);assert.match(html,/disabled=""/);assert.match(html,/autoComplete="new-password"/i)
  assert.match(html,/minLength="8"/i);assert.match(html,/maxLength="128"/i)
 }
})
test('Arabic/English dashboard binds links to the verified workspace and omits unfinished placeholders',async()=>{
 for(const lang of ['ar','en']){
  const selected={id:'00000000-0000-4000-8000-000000000001',name:'متجر Synthetic'}
  const load=loader({'next/link':{default:link},'next/server':{connection:async()=>{}},'next/navigation':{redirect:()=>assert.fail('unexpected redirect')},'@/utils/supabase/server':{createClient:async()=>({})},'@/app/logout/actions':{logout:async()=>({})},'@/utils/workspaces/access':{loadDashboardState:async()=>({status:'ready',workspaces:[selected],selected})}})
  const shell=load('../src/app/dashboard/page.tsx').default({searchParams:Promise.resolve({workspace:selected.id,lang})})
  const html=renderToStaticMarkup(await shell.props.children.type(shell.props.children.props))
  assert.match(html,new RegExp(`dir="${lang==='ar'?'rtl':'ltr'}"`))
  for(const route of ['knowledge','agent','inbox','automation','billing','intake'])assert.ok(html.includes(`/dashboard/${route}?workspace=${selected.id}`))
  assert.doesNotMatch(html,/Coming soon|Customers|Settings|Business tools.*coming soon/)
 }
})
test('foreign dashboard selection cannot emit tenant-specific feature links',async()=>{
 const load=loader({'next/link':{default:link},'next/server':{connection:async()=>{}},'next/navigation':{redirect:()=>assert.fail('unexpected redirect')},'@/utils/supabase/server':{createClient:async()=>({})},'@/app/logout/actions':{logout:async()=>({})},'@/utils/workspaces/access':{loadDashboardState:async()=>({status:'unauthorized',workspaces:[]})}})
 const shell=load('../src/app/dashboard/page.tsx').default({searchParams:Promise.resolve({workspace:'foreign'})})
 const html=renderToStaticMarkup(await shell.props.children.type(shell.props.children.props))
 assert.doesNotMatch(html,/\/dashboard\/(?:inbox|billing|intake|agent|knowledge)\?workspace=/)
 assert.match(html,/role="alert"/)
})
test('auth-token endpoints suppress development request logging without suppressing unrelated routes',()=>{
 const config=loader()('../next.config.ts').default
 const ignored=config.logging.incomingRequests.ignore
 for(const path of ['/auth/recovery?code=private','/auth/callback?code=private','/auth/confirm?token_hash=private','/api/webhooks/whatsapp?hub.verify_token=private'])assert.ok(ignored.some(re=>re.test(path)))
 assert.equal(ignored.some(re=>re.test('/dashboard')),false)
})
test('request-scoped SSR cookie adapter preserves options and fails closed when writes are unavailable',async()=>{
 for(const writable of [true,false]){
  let adapter;const writes=[]
  const load=loader({'next/headers':{cookies:async()=>({getAll:()=>[{name:'synthetic',value:'cookie'}],set:(name,value,options)=>{
   if(!writable)throw Error('read-only cookie context');writes.push({name,value,options})
  }})},'@supabase/ssr':{createServerClient:(_url,_key,options)=>{adapter=options.cookies;return {}}}}, {NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable'})
  await load('../src/utils/supabase/server.ts').createClient()
  assert.equal(adapter.getAll()[0].name,'synthetic')
  const cookies=[{name:'new-synthetic',value:'redacted-test-value',options:{httpOnly:true,secure:true,sameSite:'lax',path:'/'}}]
  if(writable){adapter.setAll(cookies,{'Cache-Control':'private, no-store'});assert.equal(writes[0].options.secure,true);assert.equal(writes[0].options.path,'/')}
  else assert.throws(()=>adapter.setAll(cookies),/read-only/)
 }
})
test('onboarding derives workspace ownership from Auth and never accepts a paid plan or user ID',async()=>{
 const calls=[];const paths=[]
 const client={auth:{getClaims:async()=>({data:{claims:{sub:'owner',user_metadata:{role:'admin'}}},error:null})},rpc:async(name,args)=>{
  calls.push({name,args});return {data:'00000000-0000-4000-8000-000000000001',error:null}
 }}
 const load=loader({'@/utils/supabase/server':{createClient:async()=>client},'next/cache':{revalidatePath:path=>paths.push(path)},'next/navigation':{redirect:path=>{throw Error(`REDIRECT:${path}`)}}})
 await assert.rejects(load('../src/app/onboarding/actions.ts').createWorkspace({error:''},form({businessName:'  متجر Synthetic  ',plan_id:'business',user_id:'foreign',role:'owner'})),/REDIRECT:\/dashboard\?workspace=00000000-0000-4000-8000-000000000001/)
 assert.equal(calls.length,1);assert.equal(calls[0].name,'create_workspace');assert.equal(Object.keys(calls[0].args).join(','),'name');assert.equal(calls[0].args.name,'متجر Synthetic');assert.equal(paths[0],'/dashboard')
})
test('onboarding invalid names, duplicate names and missing sessions cannot create a workspace',async()=>{
 let calls=0
 const load=loader({'@/utils/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:null,error:{code:'expired'}})},rpc:()=>{calls++;assert.fail('must not write')}})},'next/cache':{revalidatePath:()=>assert.fail()},'next/navigation':{redirect:()=>assert.fail()}})
 const create=load('../src/app/onboarding/actions.ts').createWorkspace
 for(const businessName of ['', ' '.repeat(3),'a'.repeat(121),'Synthetic'])assert.ok((await create({error:''},form({businessName}))).error)
 const duplicate=form({businessName:'One'});duplicate.append('businessName','Two');assert.ok((await create({error:''},duplicate)).error)
 assert.equal(calls,0)
})
test('uncertain onboarding RPC result gives a safe check-dashboard message instead of retrying or claiming success',async()=>{
 for(const result of [{data:null,error:{code:'PGRST202'}},{data:null,error:null}]){
  let calls=0
  const load=loader({'@/utils/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:'owner'}},error:null})},rpc:async()=>{calls++;return result}})},'next/cache':{revalidatePath:()=>assert.fail()},'next/navigation':{redirect:()=>assert.fail()}})
  const outcome=await load('../src/app/onboarding/actions.ts').createWorkspace({error:''},form({businessName:'Synthetic'}))
  assert.match(outcome.error,/Check your dashboard/);assert.equal(calls,1)
 }
})
