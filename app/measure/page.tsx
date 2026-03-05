"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Sample = {
t: number; // ms since run start
ax: number;
ay: number;
az: number;
mag: number;
};

type RunSave = {
v: 1;
savedAt: number;
durationMs: number;
samples: Sample[];
tags: number[];
};

const STORAGE_KEY = "axis:lastRun:v1";

function clamp(n: number, lo: number, hi: number) {
return Math.max(lo, Math.min(hi, n));
}

function safeGetLocalStorage<T>(key: string): T | null {
try {
const raw = localStorage.getItem(key);
if (!raw) return null;
return JSON.parse(raw) as T;
} catch {
return null;
}
}

function Stat({ label, value }: { label: string; value: string }) {
return (
<div
style={{
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 14,
padding: 12,
background: "rgba(255,255,255,0.02)",
}}
>
<div style={{ opacity: 0.7, fontSize: 12 }}>{label}</div>
<div style={{ fontSize: 20, marginTop: 6 }}>{value}</div>
</div>
);
}

export default function MeasurePage() {
const [refreshNonce, setRefreshNonce] = useState(0);

const run = useMemo(() => {
// refreshNonce forces re-read if you tap Refresh
void refreshNonce;
return safeGetLocalStorage<RunSave>(STORAGE_KEY);
}, [refreshNonce]);

const computed = useMemo(() => {
if (!run || !run.samples || run.samples.length < 10) return null;

const samples = run.samples;
const tags = run.tags ?? [];

const mags = samples.map((s) => s.mag);
const peak = Math.max(...mags);
const avg = mags.reduce((a, b) => a + b, 0) / mags.length;

// baseline from last N
const N = Math.min(60, mags.length);
const tail = mags.slice(mags.length - N);
const baseline = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);

const dev = mags.map((m) => m - baseline);

// std dev
const devAvg = dev.reduce((a, b) => a + b, 0) / dev.length;
const variance =
dev.reduce((acc, v) => acc + (v - devAvg) * (v - devAvg), 0) / dev.length;
const std = Math.sqrt(variance);

// Stability score (same style as Run)
const stability = clamp(100 - std * 80, 0, 100); // stronger scaling for "Measure"

// Control band = 1 * std (within normal variation)
const band = Math.max(0.15, std * 1.0);

const controlCount = dev.filter((d) => Math.abs(d) <= band).length;
const controlTime = Math.round((100 * controlCount) / dev.length);

// Jolts = spikes above 2.5 * std (with a simple cooldown)
const joltThresh = Math.max(0.35, std * 2.5);
let joltCount = 0;
let cooldown = 0;
for (let i = 0; i < dev.length; i++) {
if (cooldown > 0) {
cooldown--;
continue;
}
if (Math.abs(dev[i]) >= joltThresh) {
joltCount++;
cooldown = 8; // prevents counting the same jolt multiple frames
}
}

const verdict =
stability >= 85 ? "In Control" : stability >= 65 ? "Searching" : "Out of Control";

// Per-tag peaks in +-500ms windows (Decision Windows)
const tagWindows = tags.slice(-12).map((tagT) => {
const windowStart = tagT - 500;
const windowEnd = tagT + 500;
const w = samples.filter((s) => s.t >= windowStart && s.t <= windowEnd);
const wPeak = w.length ? Math.max(...w.map((s) => s.mag)) : 0;
const wAvg = w.length ? w.reduce((a, s) => a + s.mag, 0) / w.length : 0;

// "Decision Coherence" placeholder: higher when window std is low
const wDev = w.map((s) => s.mag - wAvg);
const wVar =
wDev.length > 1
? wDev.reduce((acc, v) => acc + v * v, 0) / wDev.length
: 0;
const wStd = Math.sqrt(wVar);
const coherence = clamp(100 - wStd * 120, 0, 100);

return {
tagT,
peak: wPeak,
avg: wAvg,
coherence,
};
});

return {
savedAt: run.savedAt,
durationMs: run.durationMs,
sampleCount: samples.length,
tagCount: tags.length,
avg,
peak,
baseline,
std,
stability,
controlTime,
joltCount,
verdict,
tagWindows,
};
}, [run]);

const btn: React.CSSProperties = {
padding: "10px 12px",
borderRadius: 10,
border: "1px solid rgba(255,255,255,0.16)",
background: "rgba(255,255,255,0.06)",
color: "white",
cursor: "pointer",
textDecoration: "none",
};

return (
<main style={{ padding: 16 }}>
<div style={{ padding: "12px 0 8px" }}>
<div style={{ opacity: 0.75, fontSize: 13 }}>Axis</div>
<h1 style={{ margin: "6px 0 0", fontSize: 26 }}>Measure</h1>
<div style={{ marginTop: 10, opacity: 0.75, maxWidth: 720 }}>
Measure auto-computes from your most recent Run (saved locally).
</div>
</div>

<div
style={{
marginTop: 14,
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 16,
padding: 14,
background: "rgba(255,255,255,0.03)",
}}
>
<div
style={{
display: "flex",
justifyContent: "space-between",
gap: 12,
flexWrap: "wrap",
alignItems: "center",
}}
>
<div>
<div style={{ opacity: 0.7, fontSize: 12 }}>Result</div>
<div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
{computed?.verdict ?? "No run saved yet"}
</div>
<div style={{ marginTop: 6, opacity: 0.65, fontSize: 12 }}>
{computed
? `Samples: ${computed.sampleCount} • Tags: ${computed.tagCount} • Duration: ${Math.round(
computed.durationMs / 1000
)}s`
: "Go to Run, Start, then Stop. Then come back here."}
</div>
</div>

<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
<Link href="/run" style={btn}>
Go to Run
</Link>

<button type="button" onClick={() => setRefreshNonce((n) => n + 1)} style={btn}>
Refresh
</button>
</div>
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
gap: 10,
marginTop: 14,
}}
>
<Stat label="Stability" value={computed ? `${computed.stability.toFixed(0)}%` : "—"} />
<Stat label="Control Time" value={computed ? `${computed.controlTime}%` : "—"} />
<Stat label="Jolt Count" value={computed ? String(computed.joltCount) : "—"} />
<Stat label="Avg Magnitude" value={computed ? computed.avg.toFixed(2) : "—"} />
<Stat label="Peak Magnitude" value={computed ? computed.peak.toFixed(2) : "—"} />
<Stat label="Baseline" value={computed ? computed.baseline.toFixed(2) : "—"} />
</div>

{computed && computed.tagWindows.length > 0 && (
<div style={{ marginTop: 14 }}>
<div style={{ opacity: 0.75, fontSize: 12 }}>Decision Windows (last 12 tags)</div>

<div style={{ display: "grid", gap: 10, marginTop: 10 }}>
{computed.tagWindows.map((w, idx) => (
<div
key={`${w.tagT}-${idx}`}
style={{
border: "1px solid rgba(255,255,255,0.10)",
borderRadius: 14,
padding: 12,
background: "rgba(255,255,255,0.02)",
display: "flex",
justifyContent: "space-between",
gap: 12,
flexWrap: "wrap",
}}
>
<div>
<div style={{ opacity: 0.7, fontSize: 12 }}>Tag</div>
<div style={{ fontSize: 16, fontWeight: 700 }}>
{Math.round(w.tagT / 100) / 10}s
</div>
</div>

<div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
<MiniStat label="Window Peak" value={w.peak ? w.peak.toFixed(2) : "—"} />
<MiniStat label="Window Avg" value={w.avg ? w.avg.toFixed(2) : "—"} />
<MiniStat label="Coherence" value={`${w.coherence.toFixed(0)}%`} />
</div>
</div>
))}
</div>

<div style={{ marginTop: 10, opacity: 0.65, fontSize: 12 }}>
Coherence is a first-pass “decision window stability” metric. Next we’ll align this with real
decision types (drive / stop / change direction).
</div>
</div>
)}
</div>
</main>
);
}

function MiniStat({ label, value }: { label: string; value: string }) {
return (
<div style={{ minWidth: 120 }}>
<div style={{ opacity: 0.7, fontSize: 12 }}>{label}</div>
<div style={{ fontSize: 16, marginTop: 4 }}>{value}</div>
</div>
);
}