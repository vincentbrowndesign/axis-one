import Link from "next/link";

export default function StatesPage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-6 py-12">

<Link href="/" className="text-sm text-white/60 hover:text-white">
← Back
</Link>

<h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
Axis States
</h1>

<p className="mt-4 max-w-2xl text-white/70">
Axis returns a clear structural state during a decision window.
</p>

<div className="mt-10 grid gap-4 md:grid-cols-3">

<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">
Out of Control
</div>
<div className="mt-2 text-sm text-white/70">
Structure breaks under load.
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">
In Rhythm
</div>
<div className="mt-2 text-sm text-white/70">
Structure mostly holds with minor deviation.
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">
In Control
</div>
<div className="mt-2 text-sm text-white/70">
Structure remains stable during the decision.
</div>
</div>

</div>

</div>
</main>
);
}