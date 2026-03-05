// app/measure/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Sample = { t: number; mag: number };
type LastRun = {
sid: string;
startedAt: number;
endedAt: number;
durationMs: number;
tags: number[];
samples: Sample[];
};

function card() {
return "rounded-2xl border border-neutral-800 bg-neutral-950 p-4";
}
function metric() {
return "rounded-2xl border border-neutral-800 bg-black p-4";
}

function classify(stability: number, controlTime: number) {
if (stability >= 90 && controlTime >= 85) return "In Rhythm";
if (stability >= 75) return "Searching";
return "Out of Control";
}

export default function MeasurePage() {
const [run, setRun] = useState<LastRun | null>(null);

useEffect(() => {
try {
const raw = localStorage.getItem("axis:lastRun");
if (!raw) return;
setRun(JSON.parse(raw));
} catch {}
}, []);

const computed = useMemo(() => {
if (!run || !run.samples?.length) return null;

const mags = run.samples.map((s) => s.mag);
const avg = mags.reduce((a, b) => a + b, 0) / mags.length;
const peak = mags.reduce((a, b) => Math.max(a, b), 0);

// same stability calc as Run: within +/-15% of avg
const band = avg * 0.15;
const within = mags.filter((m) => Math.abs(m - avg) <= band).length;
const stability = Math.round((within / mags.length) * 100);

// “control time” = percent of samples below avg + 10% (simple v1)
const control = mags.filter((m) => m <= avg * 1.1).length;
const controlTime = Math.round((control / mags.length) * 100);

// “jolts” = count of spikes over avg + 50%
const jolts = mags.filter((m) => m >= avg * 1.5).length;

const result = classify(stability, controlTime);

return {
avg: Number(avg.toFixed(2)),
peak: Number(peak.toFixed(2)),
stability,
controlTime,
jolts,
tags: run.tags?.length ?? 0,
durationSec: Math.round((run.durationMs || 0) / 1000),
result,
};
}, [run]);

return (
<div className="min-h-screen bg-black text-white">
<div className="max-w-2xl mx-auto p-6">
<div className="flex items-center gap-2 mb-5">
<div className="h-2 w-2 rounded-full bg-emerald-400" />
<div className="text-lg font-semibold">Axis Measure</div>
</div>

<div className={card()}>
<div className="text-3xl font-semibold">Measure</div>
<div className="text-sm text-neutral-400 mt-2">
Measure auto-computes from your most recent Run (saved locally on this device).
</div>

<div className="flex gap-2 mt-4">
<Link href="/run" className="px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-sm">
Go to Run
</Link>
</div>
</div>

{!computed ? (
<div className={`${card()} mt-4`}>
<div className="text-sm text-neutral-400">Result</div>
<div className="text-3xl font-semibold mt-2">Searching</div>
<div className="text-sm text-neutral-500 mt-2">
No recent Run found on this device. Do a Run, press Stop, then come back.
</div>
</div>
) : (
<div className={`${card()} mt-4`}>
<div className="text-sm text-neutral-400">Result</div>
<div className="text-3xl font-semibold mt-2">{computed.result}</div>

<div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
<div className={metric()}>
<div className="text-xs text-neutral-400">Stability</div>
<div className="text-3xl font-semibold mt-2">{computed.stability}%</div>
</div>

<div className={metric()}>
<div className="text-xs text-neutral-400">Control Time</div>
<div className="text-3xl font-semibold mt-2">{computed.controlTime}%</div>
</div>

<div className={metric()}>
<div className="text-xs text-neutral-400">Avg</div>
<div className="text-3xl font-semibold mt-2">{computed.avg}</div>
</div>

<div className={metric()}>
<div className="text-xs text-neutral-400">Peak</div>
<div className="text-3xl font-semibold mt-2">{computed.peak}</div>
</div>

<div className={metric()}>
<div className="text-xs text-neutral-400">Jolts</div>
<div className="text-3xl font-semibold mt-2">{computed.jolts}</div>
</div>

<div className={metric()}>
<div className="text-xs text-neutral-400">Tags • Duration</div>
<div className="text-3xl font-semibold mt-2">
{computed.tags} • {computed.durationSec}s
</div>
</div>
</div>

<div className="text-xs text-neutral-500 mt-4">
Next: we’ll compute windows around tags (drive/stop/change-direction) and save each Measure to History.
</div>
</div>
)}
</div>
</div>
);
}