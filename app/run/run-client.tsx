"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Pusher from "pusher-js";
import { QRCodeCanvas } from "qrcode.react";

type Action = "start" | "stop" | "decision" | "tag" | "ping";

function createId(prefix = "sess_") {
return prefix + Math.random().toString(36).slice(2, 14);
}

export default function RunClient() {
const [sid, setSid] = useState<string>("");
const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
const [capturing, setCapturing] = useState(false);
const [samples, setSamples] = useState(0);
const [tags, setTags] = useState(0);

const origin = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);
const controlUrl = useMemo(() => {
if (!origin || !sid) return "";
return `${origin}/control?sid=${encodeURIComponent(sid)}`;
}, [origin, sid]);

// live line (simple rolling buffer)
const bufRef = useRef<number[]>([]);
const [line, setLine] = useState<number[]>([]);

// Read sid from URL / storage
useEffect(() => {
const url = new URL(window.location.href);
const qsSid = url.searchParams.get("sid");
const stored = window.localStorage.getItem("axis:run:sid");
const initial = qsSid || stored || createId("sess_");
setSid(initial);
window.localStorage.setItem("axis:run:sid", initial);

// keep URL with sid
url.searchParams.set("sid", initial);
window.history.replaceState({}, "", url.toString());
}, []);

// Subscribe to controller events
useEffect(() => {
if (!sid) return;

const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

if (!key || !cluster) {
console.warn("Missing NEXT_PUBLIC_PUSHER_KEY or NEXT_PUBLIC_PUSHER_CLUSTER");
return;
}

const p = new Pusher(key, { cluster });

const channelName = `axis-one-${sid}`;
const ch = p.subscribe(channelName);

ch.bind("control", (payload: { action?: Action }) => {
const action = payload?.action;
if (!action) return;

if (action === "start") startCapture();
if (action === "stop") stopCapture();
if (action === "decision") addDecision();
if (action === "tag") addTag();
if (action === "ping") console.log("PING", Date.now());
});

return () => {
try {
ch.unbind_all();
p.unsubscribe(channelName);
p.disconnect();
} catch {}
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [sid]);

async function enableSensors() {
try {
// iOS Safari requires user gesture + requestPermission (when available)
const anyWin = window as any;

if (typeof anyWin.DeviceMotionEvent?.requestPermission === "function") {
const res = await anyWin.DeviceMotionEvent.requestPermission();
if (res !== "granted") {
setPermission("denied");
return;
}
}

setPermission("granted");
} catch {
setPermission("denied");
}
}

// basic accel+gravity magnitude feed (DeviceMotion)
useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
if (!capturing) return;

const ax = e.accelerationIncludingGravity?.x ?? 0;
const ay = e.accelerationIncludingGravity?.y ?? 0;
const az = e.accelerationIncludingGravity?.z ?? 0;

const mag = Math.sqrt(ax * ax + ay * ay + az * az);

// high-pass-ish: subtract rolling mean (cheap + stable)
const buf = bufRef.current;
buf.push(mag);
if (buf.length > 240) buf.shift(); // ~4 seconds @ 60Hz
const mean = buf.reduce((a, b) => a + b, 0) / buf.length;
const hp = mag - mean;

// line buffer for rendering
const lineBuf = line.slice();
lineBuf.push(hp);
if (lineBuf.length > 200) lineBuf.shift();
setLine(lineBuf);

setSamples((s) => s + 1);
}

window.addEventListener("devicemotion", onMotion);
return () => window.removeEventListener("devicemotion", onMotion);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [capturing, line]);

function startCapture() {
if (permission !== "granted") return;
setCapturing(true);
}

function stopCapture() {
setCapturing(false);
}

function addDecision() {
setTags((t) => t + 1);
}

function addTag() {
setTags((t) => t + 1);
}

const btnBase =
"rounded-3xl border border-white/10 bg-white/5 px-6 py-8 text-xl font-semibold tracking-tight active:scale-[0.99] transition";
const btnPrimary =
"rounded-3xl border border-white/10 bg-white text-black px-6 py-8 text-xl font-semibold tracking-tight active:scale-[0.99] transition";
const card =
"rounded-3xl border border-white/10 bg-white/5 backdrop-blur px-6 py-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]";

return (
<main className="min-h-screen bg-black text-white px-6 py-10">
<div className="max-w-xl mx-auto">
<h1 className="text-6xl font-semibold tracking-tight">Run (Axis One)</h1>
<p className="text-white/60 mt-3">
Capture motion, tag decision windows, export the session.
</p>

<div className="mt-6 grid gap-4">
<div className={card}>
<div className="text-white/60 text-sm">Axis One • Run</div>
<div className="text-5xl font-semibold mt-2">
{permission === "granted" ? (capturing ? "Capturing..." : "Permission granted.") : "Idle"}
</div>

<div className="grid grid-cols-2 gap-4 mt-6">
<button onClick={enableSensors} className={btnBase}>
1) Enable
<br />
Sensors
</button>
<button
onClick={startCapture}
className={btnPrimary}
disabled={permission !== "granted"}
>
2) Start
</button>

<button onClick={stopCapture} className={btnBase} disabled={!capturing}>
Stop
</button>
<button onClick={addDecision} className={btnBase} disabled={!capturing}>
Decision
</button>
</div>

<button onClick={addTag} className="mt-4 rounded-3xl border border-white/10 bg-white/5 py-6 text-xl font-semibold">
3) Tag
</button>

<button className="mt-4 rounded-3xl border border-white/10 bg-white/5 py-6 text-xl font-semibold">
Download JSON
</button>

<div className="mt-6 rounded-3xl border border-white/10 bg-black/40 px-5 py-5">
<div className="flex items-center justify-between">
<div className="text-3xl font-semibold">Axis Line</div>
<div className="text-white/50">live signal</div>
</div>

<div className="mt-4 rounded-2xl border border-white/10 bg-black/60 p-3">
<svg viewBox="0 0 400 140" width="100%" height="140" role="img" aria-label="Axis line">
<path
d={line.length ? buildPath(line, 400, 140) : ""}
fill="none"
stroke="white"
strokeWidth="2"
strokeLinejoin="round"
strokeLinecap="round"
opacity="0.95"
/>
{/* simple grid */}
{Array.from({ length: 7 }).map((_, i) => (
<line
key={`v${i}`}
x1={(i * 400) / 6}
y1={0}
x2={(i * 400) / 6}
y2={140}
stroke="rgba(255,255,255,0.08)"
strokeWidth="1"
/>
))}
{Array.from({ length: 5 }).map((_, i) => (
<line
key={`h${i}`}
x1={0}
y1={(i * 140) / 4}
x2={400}
y2={(i * 140) / 4}
stroke="rgba(255,255,255,0.08)"
strokeWidth="1"
/>
))}
</svg>
</div>

<div className="mt-3 text-white/45 text-sm">
(Stable high-pass from accel+gravity magnitude.)
</div>
</div>

<div className="grid grid-cols-2 gap-4 mt-6">
<div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-6">
<div className="text-white/50">Samples</div>
<div className="text-6xl font-semibold mt-1">{samples}</div>
<div className="text-white/45 mt-1">~60 Hz</div>
</div>
<div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-6">
<div className="text-white/50">Tags</div>
<div className="text-6xl font-semibold mt-1">{tags}</div>
<div className="text-white/45 mt-1">Decision events</div>
</div>
</div>
</div>

<div className={card}>
<div className="text-white/60 text-sm mb-3">Pair a controller</div>
<div className="flex items-center gap-4">
<div className="rounded-2xl bg-white p-3">
<QRCodeCanvas value={controlUrl || "about:blank"} size={150} />
</div>
<div className="text-sm text-white/60 break-all">
Open this on the other device:
<div className="mt-2 text-white/80">{controlUrl || "—"}</div>
</div>
</div>
</div>
</div>
</div>
</main>
);
}

function buildPath(data: number[], w: number, h: number) {
const min = Math.min(...data);
const max = Math.max(...data);
const range = Math.max(1e-6, max - min);

const pad = 10;
const innerH = h - pad * 2;
const innerW = w;

const points = data.map((v, i) => {
const x = (i / Math.max(1, data.length - 1)) * (innerW - 2) + 1;
const t = (v - min) / range; // 0..1
const y = pad + (1 - t) * innerH;
return [x, y] as const;
});

return points.reduce((d, [x, y], i) => (i === 0 ? `M ${x} ${y}` : `${d} L ${x} ${y}`), "");
}