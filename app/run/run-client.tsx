"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Sample = {
t: number; // ms since run start
ax: number;
ay: number;
az: number;
mag: number; // sqrt(ax^2+ay^2+az^2)
};

type RunSave = {
v: 1;
savedAt: number; // Date.now()
durationMs: number;
samples: Sample[];
tags: number[]; // tag times in ms since run start
};

const STORAGE_KEY = "axis:lastRun:v1";

function clamp(n: number, lo: number, hi: number) {
return Math.max(lo, Math.min(hi, n));
}

function nowMs() {
return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function safeSetLocalStorage(key: string, value: any) {
try {
localStorage.setItem(key, JSON.stringify(value));
} catch {
// ignore
}
}

const btnStyle: React.CSSProperties = {
padding: "10px 12px",
borderRadius: 10,
border: "1px solid rgba(255,255,255,0.16)",
background: "rgba(255,255,255,0.06)",
color: "white",
cursor: "pointer",
textDecoration: "none",
display: "inline-flex",
alignItems: "center",
gap: 8,
};

function StatCard({ label, value }: { label: string; value: string }) {
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

export default function RunClient() {
// SAFE env reads — never throw
const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY ?? "";
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "us2";
const PUSHER_ENABLED = PUSHER_KEY.length > 0 && PUSHER_CLUSTER.length > 0;

const [permissionState, setPermissionState] = useState<"unknown" | "granted" | "denied" | "not-needed">(
"unknown"
);

const [isRunning, setIsRunning] = useState(false);
const [status, setStatus] = useState<string>(() => (PUSHER_ENABLED ? "Ready" : "Ready (Realtime disabled)"));
const [canMeasure, setCanMeasure] = useState(false);

const [samples, setSamples] = useState<Sample[]>([]);
const bufRef = useRef<Sample[]>([]);
const rafRef = useRef<number | null>(null);

const [tags, setTags] = useState<number[]>([]);
const tagsRef = useRef<number[]>([]);

const canvasRef = useRef<HTMLCanvasElement | null>(null);

const runStartRef = useRef<number | null>(null); // performance start
const lastAutosaveRef = useRef<number>(0);

async function requestMotionPermission() {
try {
const anyWindow = window as any;
const DeviceMotionEventAny = anyWindow.DeviceMotionEvent;

if (DeviceMotionEventAny && typeof DeviceMotionEventAny.requestPermission === "function") {
const res = await DeviceMotionEventAny.requestPermission();
if (res === "granted") {
setPermissionState("granted");
setStatus("Motion permission granted");
} else {
setPermissionState("denied");
setStatus("Motion permission denied");
}
} else {
setPermissionState("not-needed");
setStatus("Motion permission not required");
}
} catch (e: any) {
setPermissionState("denied");
setStatus(`Motion permission error: ${String(e?.message ?? e)}`);
}
}

function persistRun(force: boolean) {
const start = runStartRef.current;
if (start == null) return;

const durationMs = Math.max(0, Math.round(nowMs() - start));
const payload: RunSave = {
v: 1,
savedAt: Date.now(),
durationMs,
samples: bufRef.current,
tags: tagsRef.current,
};

// autosave at most every 500ms unless forced
const t = nowMs();
if (!force && t - lastAutosaveRef.current < 500) return;
lastAutosaveRef.current = t;

safeSetLocalStorage(STORAGE_KEY, payload);
}

function start() {
bufRef.current = [];
setSamples([]);
tagsRef.current = [];
setTags([]);
runStartRef.current = nowMs();
lastAutosaveRef.current = 0;
setCanMeasure(false);

setIsRunning(true);
setStatus(PUSHER_ENABLED ? "Running" : "Running (Realtime disabled)");
}

function stop() {
setIsRunning(false);
persistRun(true); // final save

// if we have enough samples to compute, enable Measure CTA
const ok = bufRef.current.length >= 10;
setCanMeasure(ok);
setStatus(ok ? "Stopped • Ready to Measure" : "Stopped");
}

function reset() {
bufRef.current = [];
setSamples([]);
tagsRef.current = [];
setTags([]);
setCanMeasure(false);

setStatus("Reset");
if (isRunning) {
runStartRef.current = nowMs();
persistRun(true);
} else {
safeSetLocalStorage(STORAGE_KEY, {
v: 1,
savedAt: Date.now(),
durationMs: 0,
samples: [],
tags: [],
} satisfies RunSave);
}
}

function tagDecision() {
const start = runStartRef.current;
if (start == null) return;
const t = Math.round(nowMs() - start);

tagsRef.current = [...tagsRef.current, t];
setTags(tagsRef.current);
setStatus(`Tagged decision • ${tagsRef.current.length}`);
persistRun(true);
}

// DeviceMotion listener
useEffect(() => {
if (!isRunning) return;

const onMotion = (ev: DeviceMotionEvent) => {
const start = runStartRef.current;
if (start == null) return;

const a = ev.accelerationIncludingGravity || ev.acceleration;
const ax = a?.x ?? 0;
const ay = a?.y ?? 0;
const az = a?.z ?? 0;
const mag = Math.sqrt(ax * ax + ay * ay + az * az);

const t = Math.round(nowMs() - start);

bufRef.current.push({ t, ax, ay, az, mag });

if (bufRef.current.length > 900) {
bufRef.current.splice(0, bufRef.current.length - 900);
}

persistRun(false);
};

window.addEventListener("devicemotion", onMotion, { passive: true });
return () => window.removeEventListener("devicemotion", onMotion as any);
}, [isRunning]);

// Snapshot buffer to state 10x/sec
useEffect(() => {
if (!isRunning) return;

const id = window.setInterval(() => {
setSamples([...bufRef.current]);
setTags([...tagsRef.current]);
}, 100);

return () => window.clearInterval(id);
}, [isRunning]);

// Draw axis line
useEffect(() => {
const canvas = canvasRef.current;
if (!canvas) return;

const ctx = canvas.getContext("2d");
if (!ctx) return;

const draw = () => {
const w = canvas.width;
const h = canvas.height;

// background
ctx.clearRect(0, 0, w, h);
ctx.fillStyle = "#0b0b0b";
ctx.fillRect(0, 0, w, h);

// grid
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
for (let i = 1; i < 6; i++) {
const y = (h * i) / 6;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(w, y);
ctx.stroke();
}

const data = samples;
if (data.length < 2) {
ctx.fillStyle = "rgba(255,255,255,0.7)";
ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto";
ctx.fillText("No signal yet — tap Start and move the device.", 14, 24);
rafRef.current = requestAnimationFrame(draw);
return;
}

const mags = data.map((s) => s.mag);

// baseline = average of last N samples
const N = Math.min(60, mags.length);
const tail = mags.slice(mags.length - N);
const baseline = tail.reduce((acc, v) => acc + v, 0) / Math.max(1, tail.length);

const dev = mags.map((m) => m - baseline);
const maxAbs = Math.max(1, ...dev.map((d) => Math.abs(d)));
const yMid = h * 0.5;

// midline
ctx.strokeStyle = "rgba(255,255,255,0.18)";
ctx.beginPath();
ctx.moveTo(0, yMid);
ctx.lineTo(w, yMid);
ctx.stroke();

// axis line
ctx.strokeStyle = "rgba(0,255,180,0.9)";
ctx.lineWidth = 2;
ctx.beginPath();
for (let i = 0; i < dev.length; i++) {
const x = (w * i) / (dev.length - 1);
const y = yMid - (dev[i] / maxAbs) * (h * 0.35);
if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
}
ctx.stroke();

// tag markers
if (tags.length > 0) {
const firstT = data[0].t;
const lastT = data[data.length - 1].t;
const span = Math.max(1, lastT - firstT);

ctx.strokeStyle = "rgba(255,255,255,0.25)";
ctx.lineWidth = 1;

for (const tagT of tags) {
if (tagT < firstT || tagT > lastT) continue;
const x = ((tagT - firstT) / span) * w;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, h);
ctx.stroke();
}
}

// label
ctx.fillStyle = "rgba(255,255,255,0.75)";
ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto";
ctx.fillText(
`Axis line (deviation) • samples: ${data.length} • tags: ${tags.length} • baseline: ${baseline.toFixed(2)}`,
14,
h - 14
);

rafRef.current = requestAnimationFrame(draw);
};

if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = requestAnimationFrame(draw);

return () => {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
};
}, [samples, tags]);

const metrics = useMemo(() => {
if (samples.length < 2) return { peak: 0, avg: 0, stability: 100 };
const mags = samples.map((s) => s.mag);
const peak = Math.max(...mags);
const avg = mags.reduce((a, b) => a + b, 0) / mags.length;

const variance = mags.reduce((acc, v) => acc + (v - avg) * (v - avg), 0) / mags.length;
const std = Math.sqrt(variance);

const stability = clamp(100 - std * 8, 0, 100);
return { peak, avg, stability };
}, [samples]);

// Realtime can be added later safely (never block the app)
useEffect(() => {
if (!PUSHER_ENABLED) return;
}, [PUSHER_ENABLED]);

return (
<div
style={{
minHeight: "calc(100vh - 60px)",
background: "#050505",
color: "white",
padding: 16,
fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
}}
>
<div style={{ maxWidth: 980, margin: "0 auto" }}>
<div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
<h1 style={{ fontSize: 22, margin: 0 }}>Axis Run</h1>
<div style={{ opacity: 0.7, fontSize: 13 }}>{status}</div>
</div>

{/* CONTROLS */}
<div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
<button onClick={requestMotionPermission} style={btnStyle} type="button">
Motion Permission
</button>

{!isRunning ? (
<button onClick={start} style={btnStyle} type="button">
Start
</button>
) : (
<button onClick={stop} style={btnStyle} type="button">
Stop
</button>
)}

<button onClick={reset} style={btnStyle} type="button">
Reset
</button>

<button
onClick={tagDecision}
style={{ ...btnStyle, border: "1px solid rgba(0,255,180,0.35)" }}
type="button"
disabled={!isRunning}
title={!isRunning ? "Start a run to tag decisions" : "Tag a decision moment"}
>
Tag Decision
</button>

{/* AFTER-STOP CTA */}
<Link
href="/measure"
style={{
...btnStyle,
border: canMeasure ? "1px solid rgba(0,255,180,0.55)" : "1px solid rgba(255,255,255,0.12)",
opacity: canMeasure ? 1 : 0.55,
pointerEvents: canMeasure ? "auto" : "none",
}}
aria-disabled={!canMeasure}
title={!canMeasure ? "Stop a run with enough samples first" : "Compute results"}
>
Go to Measure →
</Link>
</div>

<div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
Permission: <b>{permissionState}</b> • Realtime: <b>{PUSHER_ENABLED ? "enabled" : "disabled"}</b> • Tags:{" "}
<b>{tags.length}</b>
</div>

{/* CANVAS */}
<div style={{ marginTop: 14 }}>
<canvas
ref={canvasRef}
width={920}
height={360}
style={{
width: "100%",
height: "auto",
borderRadius: 12,
border: "1px solid rgba(255,255,255,0.12)",
background: "#0b0b0b",
}}
/>
</div>

{/* STATS */}
<div
style={{
marginTop: 14,
display: "grid",
gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
gap: 10,
}}
>
<StatCard label="Avg Magnitude" value={metrics.avg.toFixed(2)} />
<StatCard label="Peak Magnitude" value={metrics.peak.toFixed(2)} />
<StatCard label="Stability" value={`${metrics.stability.toFixed(0)}%`} />
</div>

{/* TAGS LIST */}
{tags.length > 0 && (
<div
style={{
marginTop: 14,
border: "1px solid rgba(255,255,255,0.10)",
borderRadius: 14,
padding: 12,
background: "rgba(255,255,255,0.02)",
}}
>
<div style={{ opacity: 0.75, fontSize: 12 }}>Decisions (Tags)</div>
<div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
{tags.slice(-12).map((t, i) => (
<div
key={`${t}-${i}`}
style={{
padding: "6px 10px",
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.03)",
fontSize: 12,
opacity: 0.9,
}}
>
{Math.round(t / 100) / 10}s
</div>
))}
</div>

<div style={{ marginTop: 10, opacity: 0.65, fontSize: 12 }}>
Flow: <b>Start</b> → <b>Tag</b> → <b>Stop</b> → <b>Measure</b>
</div>
</div>
)}

<div style={{ marginTop: 14, opacity: 0.65, fontSize: 12 }}>
Tip: On iPhone, tap <b>Motion Permission</b> once, then <b>Start</b>. Use <b>Tag Decision</b> for key moments.
</div>
</div>
</div>
);
}