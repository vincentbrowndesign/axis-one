// app/measure/page.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

function clamp(n: number, lo: number, hi: number) {
return Math.max(lo, Math.min(hi, n));
}

export default function MeasurePage() {
// Minimal “Measure v1”: shows a result layout and lets you proceed.
// Next step: connect to last run buffer or Supabase sessions.
const [demoMode, setDemoMode] = useState(true);

const result = useMemo(() => {
// Placeholder numbers for now (so the UI exists and feels real).
// We’ll replace with actual computations from the last run next.
if (!demoMode) return null;

const avg = 10.81;
const peak = 23.45;
const stability = clamp(79, 0, 100);

// “Control time” + “Jolt count” are the next 2 we’ll compute from real data.
return {
stability,
avg,
peak,
controlTime: 82,
joltCount: 7,
verdict:
stability >= 80 ? "In Control" : stability >= 60 ? "Searching" : "Out of Control",
};
}, [demoMode]);

return (
<main style={{ padding: 16 }}>
<div style={{ padding: "12px 0 8px" }}>
<div style={{ opacity: 0.75, fontSize: 13 }}>Axis</div>
<h1 style={{ margin: "6px 0 0", fontSize: 26 }}>Measure</h1>
<div style={{ marginTop: 10, opacity: 0.75, maxWidth: 720 }}>
This page is where the signal becomes a result you can show a parent,
coach, or investor.
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
<div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
<div>
<div style={{ opacity: 0.7, fontSize: 12 }}>Result</div>
<div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
{result?.verdict ?? "No data yet"}
</div>
</div>

<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
<Link
href="/run"
style={{
padding: "10px 12px",
borderRadius: 10,
border: "1px solid rgba(255,255,255,0.16)",
background: "rgba(255,255,255,0.06)",
color: "white",
textDecoration: "none",
}}
>
Go to Run
</Link>

<button
type="button"
onClick={() => setDemoMode((v) => !v)}
style={{
padding: "10px 12px",
borderRadius: 10,
border: "1px solid rgba(255,255,255,0.16)",
background: "rgba(255,255,255,0.06)",
color: "white",
cursor: "pointer",
}}
>
{demoMode ? "Demo: ON" : "Demo: OFF"}
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
<Stat label="Stability" value={result ? `${result.stability}%` : "—"} />
<Stat label="Avg Magnitude" value={result ? result.avg.toFixed(2) : "—"} />
<Stat label="Peak Magnitude" value={result ? result.peak.toFixed(2) : "—"} />
<Stat label="Control Time" value={result ? `${result.controlTime}%` : "—"} />
<Stat label="Jolt Count" value={result ? String(result.joltCount) : "—"} />
</div>

<div style={{ marginTop: 12, opacity: 0.65, fontSize: 12 }}>
Next: we’ll compute these from your real Run buffer and save each
“Measure” to History.
</div>
</div>
</main>
);
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