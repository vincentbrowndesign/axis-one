import Link from "next/link";

const widgets = [
{
title: "Axis Camera",
href: "/axis-camera",
description: "Sense the kid with camera while you hold the phone.",
},
{
title: "Axis Live",
href: "/axis",
description: "Instrument-only alignment meter from calibrated baseline.",
},
{
title: "Run Instrument",
href: "/axis-run-instrument",
description: "Route reserved for running / movement capture flows.",
},
];

export default function HomePage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/35">
Axis OS
</div>

<h1 className="mt-2 text-3xl font-semibold tracking-[0.18em] sm:text-5xl">
AXIS WIDGETS
</h1>

<div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
{widgets.map((widget) => (
<Link
key={widget.href}
href={widget.href}
className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/25 hover:bg-white/[0.05]"
>
<div className="text-[10px] uppercase tracking-[0.32em] text-white/35">
Widget
</div>

<div className="mt-3 text-2xl font-semibold tracking-[0.12em]">
{widget.title}
</div>

<div className="mt-3 text-sm leading-6 text-white/55">
{widget.description}
</div>
</Link>
))}
</div>
</div>
</main>
);
}