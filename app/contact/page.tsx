import Link from "next/link";

export default function ContactPage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-6 py-12">
<Link href="/" className="text-sm text-white/60 hover:text-white">
← Back
</Link>

<h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
Contact
</h1>
<p className="mt-4 max-w-2xl text-white/70">
Want to run a pilot? Email us and include: environment (basketball,
school, work), number of people, and session frequency.
</p>

<div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm text-white/70">
Email: <span className="text-white font-semibold">your@email.com</span>
</div>
<div className="mt-2 text-xs text-white/50">
(We’ll wire a proper form + Supabase next.)
</div>
</div>
</div>
</main>
);
}