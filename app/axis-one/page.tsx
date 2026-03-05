import Link from "next/link";

export default function AxisOnePage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-6 py-12">
<Link href="/" className="text-sm text-white/60 hover:text-white">
← Back
</Link>

<h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
Axis One
</h1>
<p className="mt-4 max-w-2xl text-white/70">
The instrument. Capture motion, tag decision windows, compute the
measure, output the state.
</p>

<div className="mt-10 grid gap-4 md:grid-cols-3">
<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">Capture</div>
<div className="mt-2 text-sm text-white/70">
Accelerometer + gyro stream
</div>
</div>
<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">Tag</div>
<div className="mt-2 text-sm text-white/70">
“Decision happened here”
</div>
</div>
<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">Measure</div>
<div className="mt-2 text-sm text-white/70">
Structure under load → Axis Measure
</div>
</div>
</div>

<div className="mt-10 flex gap-3">
<Link
href="/sessions"
className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
>
Run a Session
</Link>
<Link
href="/measure"
className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5"
>
See the Measure
</Link>
</div>
</div>
</main>
);
}