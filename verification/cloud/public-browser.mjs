// Public loopback checks only. No Auth, credentials, SQL or provider traffic.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:3210'
const {chromium}=createRequire(import.meta.url)(process.env.WASLA_PLAYWRIGHT_PATH??'playwright')
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],headless:true})
const checks=[]
await mkdir('work/cloud-browser',{recursive:true})
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort())
  const page=await context.newPage()
  await page.goto(base+'/join#token=invalid',{waitUntil:'networkidle'})
  await page.getByRole('heading',{name:'الانضمام إلى مساحة عمل'}).waitFor()
  await page.getByRole('button',{name:'قبول الدعوة'}).click()
  await page.locator('main [role=alert]').waitFor()
  assert.equal(new URL(page.url()).hash,'')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:`work/cloud-browser/join-${width}.png`,fullPage:true})
  checks.push(`PASS ${width}px: invitation RTL, invalid token rejection, fragment removed, no overflow`)
  for(const path of ['/dashboard/cloud','/dashboard/team']){
   await page.goto(base+path+'?workspace=00000000-0000-4000-8000-000000000001')
   await page.waitForURL('**/login');checks.push(`PASS ${width}px: unauthenticated ${path} redirects`)
  }
  await context.close()
 }
 for(const [path,method,status] of [['/api/cloud/worker','POST',403],['/api/cloud/onboarding','POST',403],['/api/webhooks/meta','POST',503],['/api/webhooks/meta','GET',503]]){
  const result=await fetch(base+path,{method});assert.equal(result.status,status)
  checks.push(`PASS unconfigured ${method} ${path}: ${status}, fails closed`)
 }
 await writeFile('work/cloud-browser/results.json',JSON.stringify({checks,scope:'Public local browser and unconfigured HTTP only. Real Auth/PostgREST/Meta/STT NOT TESTED.'},null,2)+'\n')
 console.log(checks.join('\n'))
}finally{await browser.close()}
