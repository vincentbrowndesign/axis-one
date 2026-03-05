import Link from "next/link";

export default function ResearchPage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-6 py-12">
<Link href="/" className="text-sm text-white/60 hover:text-white">
← Back
</Link>

<h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
Research
</h1>
<p className="mt-4 max-w-2xl text-white/70">
Axis is a measurable property: structural control during decisions.
This page will host definitions, methods, and validation.
</p>

<div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
v0 includes: definitions, session protocol, and state calibration.
</div>
</div>
</main>
);
}