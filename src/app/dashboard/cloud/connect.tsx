'use client'
import { useEffect,useRef,useState } from 'react'
import { useRouter } from 'next/navigation'
import { collectEmbeddedSignup,type MetaSDK } from '@/utils/cloud/embedded'
declare global { interface Window { FB?:MetaSDK } }
type Prepared={sdk:MetaSDK;state:string;configId:string}
async function loadSDK(){
 if(window.FB)return window.FB
 await new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://connect.facebook.net/en_US/sdk.js';script.async=true;script.referrerPolicy='no-referrer';script.onload=()=>resolve();script.onerror=()=>{script.remove();reject(Error('SDK unavailable'))};document.head.appendChild(script)
 })
 if(!window.FB)throw Error('SDK unavailable')
 return window.FB
}
export default function ConnectWhatsApp({workspaceId,enabled,channelId}:{workspaceId:string;enabled:boolean;channelId?:string}){
 const [pin,setPin]=useState('');const [prepared,setPrepared]=useState<Prepared|null>(null);const [pending,setPending]=useState(false);const [message,setMessage]=useState('');const cancellation=useRef<AbortController|null>(null);const router=useRouter()
 useEffect(()=>()=>cancellation.current?.abort(),[])
 async function prepare(){
  setPending(true);setMessage('');const controller=new AbortController();cancellation.current=controller
  try{
   const start=await fetch('/api/cloud/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'start',workspaceId,...(channelId?{channelId}:{})}),signal:controller.signal})
   if(!start.ok)throw Error('Setup unavailable')
   const {state,appId,configId,version}=await start.json()
   const sdk=await loadSDK();sdk.init({appId,version,cookie:false,xfbml:false})
   if(controller.signal.aborted)throw Error('Canceled')
   setPrepared({sdk,state,configId});setMessage('جاهز. افتح Meta للمتابعة خلال عشر دقائق.')
  }catch{setMessage('تعذرت تهيئة الربط. تحقق من الصلاحيات وتهيئة Meta، أو أعد المحاولة لاحقاً.')}
  finally{setPending(false);cancellation.current=null}
 }
 async function connect(){
  if(!prepared||!/^\d{6}$/.test(pin)){setMessage('أدخل رمز تسجيل الرقم لدى Meta من ستة أرقام.');return}
  setPending(true);setMessage('');const controller=new AbortController();cancellation.current=controller;let submitted=false
  try{
   // Called synchronously from this second user click: an awaited preparation
   // request before FB.login would lose browser popup activation.
   const signup=await collectEmbeddedSignup(prepared.sdk,window,prepared.configId,controller.signal)
   submitted=true
   const response=await fetch('/api/cloud/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'complete',workspaceId,signup:{...signup,state:prepared.state,pin}}),signal:controller.signal})
   const result=response.ok?await response.json():null
   if(result?.status!=='connected')throw Error('Connection not confirmed')
   setMessage('تم تأكيد الاتصال. إعداد الردود يبدأ بالمراجعة اليدوية.');router.refresh()
  }catch{setMessage('لم يتأكد الاتصال. تحقق من تهيئة Meta أو حاول لاحقاً. لم يتم تفعيل إرسال تلقائي.')}
  finally{if(submitted)setPrepared(null);setPin('');setPending(false);cancellation.current=null}
 }
 return <section className="space-y-4 rounded-xl border p-5"><h2 className="text-xl font-semibold">ربط WhatsApp Business</h2><p className="text-sm leading-7 text-slate-600">تُراجع ملكية الحساب والرقم لدى Meta قبل الاتصال. رمز التسجيل لا يُحفظ في المتصفح.</p>{prepared&&<label className="block space-y-2"><span>رمز تسجيل الرقم لدى Meta (6 أرقام)</span><input dir="ltr" value={pin} onChange={e=>setPin(e.target.value)} type="password" inputMode="numeric" autoComplete="off" maxLength={6} disabled={!enabled||pending} className="min-h-11 rounded-lg border p-3" /></label>}<button disabled={!enabled||pending} onClick={prepared?connect:prepare} className="min-h-11 rounded-lg bg-emerald-800 px-5 text-white disabled:opacity-50">{pending?'جارٍ التحقق…':prepared?'فتح Meta للمتابعة':'تهيئة ربط الرقم'}</button>{pending&&<button className="ms-3 min-h-11 underline" onClick={()=>cancellation.current?.abort()}>إلغاء</button>}{message&&<p role="status" className="text-sm leading-7">{message}</p>}</section>
}
