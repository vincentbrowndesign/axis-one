import Link from "next/link";

export default function SessionsPage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-6 py-12">
<Link href="/" className="text-sm text-white/60 hover:text-white">
← Back
</Link>

<h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
Sessions
</h1>
<p className="mt-4 max-w-2xl text-white/70">
A session is the smallest unit of Axis. One person. One movement. One
decision window.
</p>

<ol className="mt-10 space-y-3 text-sm text-white/80">
<li className="rounded-2xl border border-white/10 bg-white/5 p-6">
<span className="font-semibold">1) Start capture</span>
<div className="mt-1 text-white/70">Begin motion recording.</div>
</li>
<li className="rounded-2xl border border-white/10 bg-white/5 p-6">
<span className="font-semibold">2) Perform movement</span>
<div className="mt-1 text-white/70">Drive, stop, cut, step, etc.</div>
</li>
<li className="rounded-2xl border border-white/10 bg-white/5 p-6">
<span className="font-semibold">3) Tag the decision</span>
<div className="mt-1 text-white/70">
Mark the moment the decision happens.
</div>
</li>
<li className="rounded-2xl border border-white/10 bg-white/5 p-6">
<span className="font-semibold">4) Compute</span>
<div className="mt-1 text-white/70">
Axis returns Measure + State.
</div>
</li>
</ol>
</div>
</main>
);
}