"use client";

import { useEffect, useMemo, useState } from "react";
import { clearLastRun, computeSummary, loadLastRun, type AxisRunSummary } from "@/lib/runStore";

function btnClass(primary = false) {
return [
"px-4 py-3 rounded-xl border text-sm",
"bg-neutral-900 border-neutral-700 text-white",
primary ? "ring-1 ring-emerald-500/40 border-emerald-600/40" : "",
].join(" ");
}

export default function MeasureClient() {
const [summary, setSummary] = useState<AxisRunSummary | null>(null);

function refresh() {
const run = loadLastRun();
if (!run) {
setSummary(null);
return;
}
setSummary(computeSummary(run));
}

useEffect(() => {
refresh();
}, []);

const shareText = useMemo(() => {
if (!summary) return "";
const secs = Math.round((summary.durationMs || 0) / 1000);
return [
"Axis Measure",
`Result: ${summary.resultLabel}`,
`Stability: ${summary.stability}%`,
`Control Time: ${summary.controlTime}%`,
`Jolts: ${summary.jolts}`,
`Avg: ${summary.avgMagnitude} • Peak: ${summary.peakMagnitude}`,
`Tags: ${summary.tags} • Duration: ${secs}s`,
"axismeasure.com",
].join("\n");
}, [summary]);

async function copySummary() {
if (!shareText) return;
await navigator.clipboard.writeText(shareText);
}

async function share() {
if (!shareText) return;
// iOS/Android share if available
const anyNav = navigator as any;
if (anyNav?.share) {
try {
await anyNav.share({ text: shareText });
return;
} catch {}
}
await copySummary();
}

function wipe() {
clearLastRun();
setSummary(null);
}

return (
<div className="min-h-screen bg-black text-white">
<div className="max-w-3xl mx-auto p-6">
<div className="text-sm text-neutral-400 mb-2">Axis</div>
<div className="text-4xl font-semibold mb-2">Measure</div>
<div className="text-neutral-400 mb-6">
Measure auto-computes from your most recent Run (saved locally on this device).
</div>

{!summary ? (
<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
<div className="text-xs text-neutral-500 mb-2">Result</div>
<div className="text-2xl font-semibold">Searching</div>
<div className="text-sm text-neutral-500 mt-2">
No recent Run found on this device. Do a Run, press Stop, then come back.
</div>
<div className="flex gap-2 mt-4">
<button className={btnClass(true)} onClick={refresh}>Refresh</button>
<a className={btnClass()} href="/run">Go to Run</a>
</div>
</div>
) : (
<>
<div className="rounded-2xl border border-emerald-600/30 bg-neutral-950 p-4 mb-4">
<div className="text-xs text-neutral-400 mb-1">Share</div>
<div className="text-3xl font-semibold">{summary.resultLabel}</div>
<div className="text-sm text-neutral-400 mt-1">
Stability {summary.stability}% • Control {summary.controlTime}% • Jolts {summary.jolts}
</div>

<div className="flex flex-wrap gap-2 mt-4">
<button className={btnClass(true)} onClick={share}>Share</button>
<button className={btnClass()} onClick={copySummary}>Copy Summary</button>
<a className={btnClass()} href="/run">Go to Run</a>
<button className={btnClass()} onClick={refresh}>Refresh</button>
<button className={btnClass()} onClick={wipe}>Clear</button>
</div>

<pre className="mt-4 text-sm text-neutral-200 whitespace-pre-wrap rounded-xl border border-neutral-800 bg-black p-4">
{shareText}
</pre>
</div>

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
<div className="text-xs text-neutral-500 mb-2">Details</div>
<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Stability</div>
<div className="text-3xl font-semibold mt-2">{summary.stability}%</div>
</div>
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Control Time</div>
<div className="text-3xl font-semibold mt-2">{summary.controlTime}%</div>
</div>
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Avg Magnitude</div>
<div className="text-3xl font-semibold mt-2">{summary.avgMagnitude.toFixed(2)}</div>
</div>
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Peak Magnitude</div>
<div className="text-3xl font-semibold mt-2">{summary.peakMagnitude.toFixed(2)}</div>
</div>
</div>

<div className="text-xs text-neutral-500 mt-4">
Next: we’ll compute windows around Tags and add decision types (drive / stop / change direction).
</div>
</div>
</>
)}
</div>
</div>
);
}