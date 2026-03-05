import Link from "next/link";

export default function MeasurePage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-6 py-12">
<Link href="/" className="text-sm text-white/60 hover:text-white">
← Back
</Link>

<h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
Axis Measure
</h1>
<p className="mt-4 max-w-2xl text-white/70">
A single value that reflects structural control during a tagged
decision window.
</p>

<div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">Definition</div>
<div className="mt-2 text-sm leading-6 text-white/70">
Axis Measure quantifies how well the body maintains structure while
force and direction change around a decision.
</div>
</div>

<div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm font-semibold">Inputs</div>
<ul className="mt-2 list-disc pl-5 text-sm text-white/70">
<li>Motion stream (accel/gyro)</li>
<li>Decision tag timestamp</li>
<li>Window length (e.g. 4s)</li>
</ul>
</div>
</div>
</main>
);
}