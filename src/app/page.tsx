import Link from 'next/link'

export default function Home() {
  return <main lang="ar" dir="rtl" className="min-h-screen bg-slate-50 px-5 text-slate-950 sm:px-10">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 py-6">
        <Link href="/" className="text-2xl font-bold tracking-tight text-emerald-800">وصلة <span dir="ltr" className="text-sm font-medium">Wasla AI</span></Link>
        <nav aria-label="الحساب" className="flex gap-4"><Link href="/login" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-emerald-800 underline-offset-4 hover:underline">تسجيل الدخول</Link><Link href="/signup" className="inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-5 font-semibold text-white hover:bg-emerald-900">ابدأ الآن</Link></nav>
      </header>
      <section className="grid gap-12 py-16 sm:py-24 lg:grid-cols-2 lg:items-center">
        <div className="space-y-7"><p className="font-semibold text-emerald-800">مساحة عمل لأعمالك في العراق</p><h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">معلومات أعمالك ومحادثات زبائنك، بمكان واحد.</h1><p className="max-w-xl text-lg leading-9 text-slate-600">نظّم منتجاتك وأسئلتك الشائعة، جهّز مساعدك، وراجع الردود مع إبقاء القرار بيد فريقك.</p><div className="flex flex-wrap gap-4"><Link href="/signup" className="inline-flex min-h-12 items-center rounded-xl bg-emerald-800 px-6 font-semibold text-white hover:bg-emerald-900">أنشئ حساب أعمال</Link><Link href="/login" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-6 font-semibold hover:border-emerald-700">لدي حساب</Link></div><p lang="en" dir="ltr" className="text-sm leading-6 text-slate-500">Business knowledge, customer conversations and reviewed reply drafts in one workspace.</p></div>
        <aside className="space-y-6 rounded-3xl border border-emerald-100 bg-white p-7 shadow-sm sm:p-10"><h2 className="text-xl font-semibold">ابدأ بخطوات واضحة</h2><ol className="list-inside list-decimal space-y-5 leading-8 text-slate-600"><li>أنشئ مساحة عمل مستقلة لنشاطك.</li><li>أضف المنتجات، ساعات العمل وسياساتك.</li><li>اضبط المساعد واختبر الردود قبل استخدامها.</li><li>راجع المحادثات والاستخدام وصلاحية الاشتراك.</li></ol></aside>
      </section>
      <section aria-label="أدوات أعمالك" className="grid gap-5 pb-14 sm:grid-cols-3">{[
        ['معرفة تخص أعمالك', 'الردود تستند إلى معلوماتك المسجلة، مع طلب التوضيح عند غياب التفاصيل.'],
        ['تحكم بشري واضح', 'استلام المحادثة يوقف تجهيز الردود الآلية. الموافقة على المسودة لا تعني إرسالها.'],
        ['استخدام واشتراك واضحان', 'راقب حدود خطتك وموعد انتهاء التجربة من مساحة عملك.'],
      ].map(([title, body]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-3 text-sm leading-8 text-slate-600">{body}</p></article>)}</section>
      <p role="note" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-8 text-amber-950">نسخة تطوير للمراجعة: اتصال واتساب متاح لأرقام الاختبار التي يهيئها المسؤول. الإرسال والمدفوعات غير مفعّلين حالياً، ولا يتم إرسال المسودات تلقائياً.</p>
      <footer className="flex flex-wrap justify-between gap-4 py-8 text-sm text-slate-500"><span>وصلة · Wasla AI</span><Link href="/forgot-password" className="min-h-11 underline">تحتاج مساعدة في تسجيل الدخول؟</Link></footer>
    </div>
  </main>
}
