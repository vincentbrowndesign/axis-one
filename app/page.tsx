// app/page.tsx
import Link from "next/link";

const Card = ({
title,
children,
}: {
title: string;
children: React.ReactNode;
}) => (
<div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
<h3 className="text-lg font-semibold tracking-tight">{title}</h3>
<div className="mt-3 text-sm leading-6 text-white/80">{children}</div>
</div>
);

export default function HomePage() {
return (
<main className="min-h-screen bg-black text-white">
{/* Top */}
<header className="mx-auto max-w-5xl px-6 pt-10">
<nav className="flex items-center justify-between">
<Link href="/" className="text-sm font-semibold tracking-wide">
AXIS
</Link>

<div className="hidden gap-5 text-sm text-white/70 md:flex">
<Link className="hover:text-white" href="/axis-one">
Axis One
</Link>
<Link className="hover:text-white" href="/measure">
Measure
</Link>
<Link className="hover:text-white" href="/states">
States
</Link>
<Link className="hover:text-white" href="/sessions">
Sessions
</Link>
<Link className="hover:text-white" href="/research">
Research
</Link>
<Link className="hover:text-white" href="/contact">
Contact
</Link>
</div>
</nav>

<div className="mt-14">
<p className="text-xs uppercase tracking-[0.35em] text-white/50">
Measurement Instrument
</p>

<h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight md:text-5xl">
Axis measures how the body holds structure during decisions.
</h1>

<p className="mt-5 max-w-2xl text-base leading-7 text-white/70">
Capture motion. Tag decision windows. Compute structural control.
Output a clear state you can train.
</p>

<div className="mt-8 flex flex-wrap gap-3">
<Link
href="/axis-one"
className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
>
View Axis One
</Link>
<Link
href="/measure"
className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5"
>
What is the Measure?
</Link>
</div>
</div>
</header>

{/* Pyramid */}
<section className="mx-auto max-w-5xl px-6 pb-20 pt-16">
<div className="grid gap-4 md:grid-cols-2">
<Card title="Signal">
Motion stream from sensors (accelerometer + gyro) over time.
</Card>
<Card title="Data">
Sessions = signal + tags + a decision window.
</Card>
<Card title="Product">
<span className="font-semibold text-white">Axis One</span> captures,
measures, and returns a state.
</Card>
<Card title="Platform">
Sessions aggregate across players/teams to reveal patterns.
</Card>
</div>

<div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="text-sm text-white/70">
Category level: Axis becomes the standard measurement for{" "}
<span className="text-white font-semibold">Decision Stability</span>
.
</div>
</div>

{/* CTA */}
<div className="mt-10 rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/0 p-7">
<h2 className="text-xl font-semibold tracking-tight">
Start with a live session.
</h2>
<p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
One person. One device. Tag the decision. Axis returns the state.
</p>
<div className="mt-5 flex flex-wrap gap-3">
<Link
href="/sessions"
className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
>
How Sessions Work
</Link>
<Link
href="/contact"
className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5"
>
Contact / Pilot
</Link>
</div>
</div>
</section>
</main>
);
}