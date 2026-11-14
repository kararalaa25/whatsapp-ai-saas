'use client'
import { useState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removeMember } from './actions'
export default function MemberRoster({workspaceId,members,enabled}:{workspaceId:string;enabled:boolean;members:Array<{user_id:string;role:string;email?:string|null}>}){
 const [pending,start]=useTransition();const [message,setMessage]=useState('');const router=useRouter()
 return <section className="space-y-3 rounded-xl border p-5"><h2 className="text-xl font-semibold">الأعضاء</h2><ul>{members.map(member=><li key={member.user_id} className="flex flex-wrap items-center justify-between gap-4 py-3"><span dir="ltr">{member.email??member.user_id.slice(0,8)+'…'}</span><span>{member.role==='owner'?'المالك':member.role==='admin'?'مشرف':'عضو'}</span>{member.role!=='owner'&&<button disabled={!enabled||pending} onClick={()=>{if(!window.confirm('إزالة وصول هذا العضو وإلغاء دعواته المعلقة في هذه المساحة؟'))return;start(async()=>{const result=await removeMember(workspaceId,member.user_id);setMessage(result.ok?'أُزيل وصول العضو إلى المساحة. السجل السابق محفوظ.':'تعذرت الإزالة. تحقق من الصلاحيات وأعد تحميل البيانات.');router.refresh()})}} className="min-h-11 underline disabled:opacity-50">إزالة الوصول</button>}</li>)}</ul>{message&&<p role="status" className="text-sm">{message}</p>}</section>
}
