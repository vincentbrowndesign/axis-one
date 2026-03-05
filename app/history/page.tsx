"use client";

import * as React from "react";
import { interpretAxisOneSession } from "@/lib/axis/interpreter";
import type { AxisDecision, AxisOneSession } from "@/lib/axis/types";
import { AxisLineChart } from "@/components/AxisLineChart";

function fmtMs(ms: number) {
const d = new Date(ms);
return d.toLocaleString();
}

export default function AxisHistoryPage() {
const [session, setSession] = React.useState<AxisOneSession | null>(null);
const [decisions, setDecisions] = React.useState<AxisDecision[]>([]);
const [selected, setSelected] = React.useState<number>(0);
const [error, setError] = React.useState<string>("");

async function onFile(file: File) {
setError("");
setSession(null);
setDecisions([]);
setSelected(0);

try {
const txt = await file.text();
const json = JSON.parse(txt) as AxisOneSession;
setSession(json);

const out = interpretAxisOneSession(json, {
fsHz: 60,
preSec: 1,
postSec: 4,
N: 128,
gyroUnits: "deg/s",
});

// @ts-expect-error optional warning
if (out.warning) setError(String(out.warning));
setDecisions(out.decisions);
} catch (e: any) {
setError(e?.message ?? "Failed to load JSON.");
}
}

const d = decisions[selected];

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-4xl p-5">
<div className="mb-4">
<h1 className="text-3xl font-semibold">Axis One</h1>
<p className="mt-1 text-white/60">Structural Motion Capture — Axis History</p>
</div>

<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
<label className="inline-flex items-center gap-3">
<span className="text-sm text-white/70">Load a session export (.json)</span>
<input
type="file"
accept="application/json,.json"
onChange={(e) => {
const f = e.target.files?.[0];
if (f) onFile(f);
}}
className="text-sm"
/>
</label>

<div className="text-sm text-white/60">
{session ? (
<span>
Samples: <b className="text-white">{session.samples_count}</b> · Tags:{" "}
<b className="text-white">{session.tags_count}</b>
</span>
) : (
<span>No session loaded.</span>
)}
</div>
</div>

{error ? <p className="mt-3 text-sm text-white/70">{error}</p> : null}
</div>

{decisions.length > 0 ? (
<div className="mt-5 grid gap-4 lg:grid-cols-[280px_1fr]">
{/* left list */}
<div className="rounded-2xl border border-white/10 bg-white/5 p-3">
<div className="mb-2 text-sm text-white/70">Decisions</div>
<div className="max-h-[520px] overflow-auto pr-1">
{decisions.map((x, i) => (
<button
key={x.tagIndex}
onClick={() => setSelected(i)}
className={[
"mb-2 w-full rounded-xl border p-3 text-left",
i === selected
? "border-white/25 bg-white/10"
: "border-white/10 bg-black/20 hover:bg-white/5",
].join(" ")}
>
<div className="flex items-center justify-between">
<div className="text-sm font-medium">Decision {x.tagIndex + 1}</div>
<div className="text-xs text-white/60">
{x.pattern.label} · {Math.round(x.pattern.confidence * 100)}%
</div>
</div>
<div className="mt-1 text-xs text-white/50">{fmtMs(x.tagTimeMs)}</div>
<div className="mt-2 grid grid-cols-3 gap-2 text-xs text-white/70">
<div>
D <span className="text-white/90">{x.peaks.Dmax.toFixed(2)}</span>
</div>
<div>
R <span className="text-white/90">{x.peaks.Rmax.toFixed(2)}</span>
</div>
<div>
J <span className="text-white/90">{x.peaks.Jmax.toFixed(2)}</span>
</div>
</div>
</button>
))}
</div>
</div>

{/* right detail */}
<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
<div>
<div className="text-lg font-semibold">Decision {d.tagIndex + 1}</div>
<div className="text-sm text-white/60">{d.pattern.reason}</div>
</div>
<div className="text-sm text-white/70">
Guess: <b className="text-white">{d.pattern.label}</b> ·{" "}
<b className="text-white">{Math.round(d.pattern.confidence * 100)}%</b>
</div>
</div>

<div className="mt-4">
<AxisLineChart points={d.points} />
</div>

<div className="mt-4 grid gap-3 sm:grid-cols-3">
<div className="rounded-xl border border-white/10 bg-black/20 p-3">
<div className="text-xs text-white/60">Peak timing</div>
<div className="mt-1 text-sm">
D: <b>{d.features.tPeakD.toFixed(2)}</b> · R: <b>{d.features.tPeakR.toFixed(2)}</b> · J:{" "}
<b>{d.features.tPeakJ.toFixed(2)}</b>
</div>
</div>
<div className="rounded-xl border border-white/10 bg-black/20 p-3">
<div className="text-xs text-white/60">Shape</div>
<div className="mt-1 text-sm">
Smooth: <b>{d.features.smoothness.toFixed(3)}</b> · Asym: <b>{d.features.asymmetry.toFixed(3)}</b>
</div>
</div>
<div className="rounded-xl border border-white/10 bg-black/20 p-3">
<div className="text-xs text-white/60">Impulse</div>
<div className="mt-1 text-sm">
Index: <b>{d.features.impulseIndex.toFixed(3)}</b>
</div>
</div>
</div>

<div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
Window: {fmtMs(d.windowStartMs)} → {fmtMs(d.windowEndMs)}
</div>
</div>
</div>
) : session ? (
<div className="mt-5 text-sm text-white/70">
Loaded session, but no decisions were produced. If your export has <b>tags_count</b> but no <b>tags</b>{" "}
array, update the exporter to include tags.
</div>
) : null}
</div>
</div>
);
}