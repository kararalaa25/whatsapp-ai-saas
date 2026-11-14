'use client'
import { useRef,useState,useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { joinWorkspace } from './actions'
export default function Join(){
 const token=useRef('');const [message,setMessage]=useState('');const [pending,start]=useTransition();const router=useRouter()

 return <main dir="rtl" lang="ar" className="mx-auto max-w-lg space-y-6 px-5 py-16 text-slate-950"><h1 className="text-3xl font-semibold">الانضمام إلى مساحة عمل</h1><p className="leading-8 text-slate-600">سجّل الدخول بالبريد المؤكد الذي وُجّهت إليه الدعوة. إذا احتجت تسجيل الدخول أولاً، افتح رابط الدعوة مجدداً بعده. الانضمام يخضع لصلاحية الرابط وحدود الاشتراك.</p><Link href="/login" className="inline-flex min-h-11 items-center underline">تسجيل الدخول</Link><button disabled={pending} onClick={()=>{const value=token.current||new URLSearchParams(window.location.hash.slice(1)).get('token')||'';window.history.replaceState(window.history.state,'','/join');if(!/^[a-f0-9]{64}$/.test(value)){setMessage('رابط الدعوة غير صالح. افتح الرابط الذي شاركه المالك.');return}token.current=value;start(async()=>{const result=await joinWorkspace(value);if(result.ok){token.current='';router.replace(`/dashboard?workspace=${encodeURIComponent(result.workspaceId)}`)}else setMessage('الدعوة غير متاحة أو لا تطابق بريدك أو تجاوزت المساحة حدودها. تحقق من تسجيل الدخول أو تواصل مع المالك.')})}} className="block min-h-12 rounded-lg bg-emerald-800 px-5 text-white disabled:opacity-50">قبول الدعوة</button>{message&&<p role="alert" className="text-sm leading-7">{message}</p>}</main>
}
