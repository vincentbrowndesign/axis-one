// app/run/run-client.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Pusher from "pusher-js";
import { saveLastRun } from "@/lib/runStore";

type Sample = { t: number; mag: number };

function uid() {
return (
Math.random().toString(36).slice(2, 10) +
Math.random().toString(36).slice(2, 10)
);
}

function btnClass(primary = false) {
return [
"px-4 py-3 rounded-xl border text-sm",
"bg-neutral-900 border-neutral-700 text-white",
primary ? "ring-1 ring-emerald-500/40 border-emerald-600/40" : "",
"disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");
}

function clamp(n: number, a: number, b: number) {
return Math.max(a, Math.min(b, n));
}

export default function RunClient() {
const [status, setStatus] = useState<"ready" | "running" | "stopped">("ready");
const [permission, setPermission] = useState<
"unknown" | "granted" | "denied"
>("unknown");
const [sid, setSid] = useState("");

const samplesRef = useRef<Sample[]>([]);
const tagsRef = useRef<number[]>([]);

const [avg, setAvg] = useState(0);
const [peak, setPeak] = useState(0);
const [stability, setStability] = useState(100);
const [tagsCount, setTagsCount] = useState(0);

// waveform
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const rafRef = useRef<number | null>(null);

// ---- SID / pairing link ----
useEffect(() => {
const url = new URL(window.location.href);
const fromUrl = url.searchParams.get("sid");

if (fromUrl) {
setSid(fromUrl);
localStorage.setItem("axis:sid", fromUrl);
return;
}

const fromStorage = localStorage.getItem("axis:sid");
const newSid = fromStorage || uid();

setSid(newSid);
localStorage.setItem("axis:sid", newSid);

url.searchParams.set("sid", newSid);
window.history.replaceState({}, "", url.toString());
}, []);

const controlUrl = useMemo(() => {
if (!sid) return "";
const base = window.location.origin;
return `${base}/control?sid=${encodeURIComponent(sid)}`;
}, [sid]);

// ---- Pusher subscribe: listen for controller commands ----
useEffect(() => {
if (!sid) return;

const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

// If these are missing on the Run phone, it will NEVER receive controller events.
if (!key || !cluster) {
// keep silent in prod UI, but this helps if you open devtools
console.warn("Missing NEXT_PUBLIC_PUSHER_KEY/CLUSTER on client");
return;
}

// IMPORTANT: create once per sid and tear down cleanly
const pusher = new Pusher(key, {
cluster,
forceTLS: true,
});

const channelName = `axis-${sid}`;
const channel = pusher.subscribe(channelName);

const handler = (msg: any) => {
const type = String(msg?.type || "");
if (type === "start") start();
else if (type === "stop") stop();
else if (type === "reset") reset();
else if (type === "tag") tagDecision();
};

channel.bind("control", handler);

return () => {
try {
channel.unbind("control", handler);
channel.unbind_all();
pusher.unsubscribe(channelName);
pusher.disconnect();
} catch {}
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [sid]);

// ---- Motion permission ----
async function requestMotion() {
try {
const anyDM = DeviceMotionEvent as any;
if (typeof anyDM?.requestPermission === "function") {
const res = await anyDM.requestPermission();
setPermission(res === "granted" ? "granted" : "denied");
} else {
setPermission("granted");
}
} catch {
setPermission("denied");
}
}

// ---- Sensor loop ----
useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
if (status !== "running") return;

const ax = e.accelerationIncludingGravity?.x ?? 0;
const ay = e.accelerationIncludingGravity?.y ?? 0;
const az = e.accelerationIncludingGravity?.z ?? 0;

const mag = Math.sqrt(ax * ax + ay * ay + az * az);
samplesRef.current.push({ t: Date.now(), mag });

// keep last ~90s (guard)
if (samplesRef.current.length > 2500) samplesRef.current.shift();
}

window.addEventListener("devicemotion", onMotion);
return () => window.removeEventListener("devicemotion", onMotion);
}, [status]);

// ---- UI metrics update loop ----
useEffect(() => {
const id = setInterval(() => {
const data = samplesRef.current;
setTagsCount(tagsRef.current.length);

if (data.length < 2) {
setAvg(0);
setPeak(0);
setStability(100);
return;
}

let sum = 0;
let pk = 0;
for (const s of data) {
sum += s.mag;
if (s.mag > pk) pk = s.mag;
}
const a = sum / data.length;

// stability = % within +/- 15% of avg
let within = 0;
const band = a * 0.15;
for (const s of data) {
if (Math.abs(s.mag - a) <= band) within++;
}

setAvg(Number(a.toFixed(2)));
setPeak(Number(pk.toFixed(2)));
setStability(Math.round((within / data.length) * 100));
}, 250);

return () => clearInterval(id);
}, []);

// ---- Waveform draw loop ----
useEffect(() => {
function draw() {
const canvas = canvasRef.current;
if (!canvas) {
rafRef.current = requestAnimationFrame(draw);
return;
}

const ctx = canvas.getContext("2d");
if (!ctx) {
rafRef.current = requestAnimationFrame(draw);
return;
}

// fit canvas to CSS size
const cssW = canvas.clientWidth;
const cssH = canvas.clientHeight;
const dpr = window.devicePixelRatio || 1;
const w = Math.max(1, Math.floor(cssW * dpr));
const h = Math.max(1, Math.floor(cssH * dpr));
if (canvas.width !== w || canvas.height !== h) {
canvas.width = w;
canvas.height = h;
}

// background
ctx.clearRect(0, 0, w, h);
ctx.fillStyle = "#0b0b0b";
ctx.fillRect(0, 0, w, h);

// subtle grid
ctx.strokeStyle = "rgba(255,255,255,0.06)";
ctx.lineWidth = 1;
for (let i = 1; i < 6; i++) {
const y = (h * i) / 6;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(w, y);
ctx.stroke();
}

const data = samplesRef.current;

if (data.length < 2) {
ctx.fillStyle = "rgba(255,255,255,0.7)";
ctx.font =
"14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText("No signal yet — tap Start and move the device.", 14, 24);

rafRef.current = requestAnimationFrame(draw);
return;
}

// last N samples across width
const N = Math.min(data.length, 500);
const slice = data.slice(data.length - N);

let minV = Infinity;
let maxV = -Infinity;
for (const s of slice) {
if (s.mag < minV) minV = s.mag;
if (s.mag > maxV) maxV = s.mag;
}
const span = Math.max(0.001, maxV - minV);
const pad = span * 0.2;
minV -= pad;
maxV += pad;

ctx.strokeStyle = "rgba(52, 211, 153, 0.95)"; // emerald-ish
ctx.lineWidth = 2;

ctx.beginPath();
for (let i = 0; i < slice.length; i++) {
const x = (i / (slice.length - 1)) * (w - 1);
const v = slice[i].mag;
const y = h - ((v - minV) / (maxV - minV)) * (h - 1);
if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
}
ctx.stroke();

ctx.fillStyle = "rgba(255,255,255,0.55)";
ctx.font =
"12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText(
`Axis line • samples: ${data.length} • sid: ${sid || "…"}`,
14,
h - 14
);

rafRef.current = requestAnimationFrame(draw);
}

rafRef.current = requestAnimationFrame(draw);
return () => {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
};
}, [sid]);

function start() {
if (status === "running") return;
samplesRef.current = [];
tagsRef.current = [];
setTagsCount(0);
setStatus("running");
}

function stop() {
if (status !== "running") return;
setStatus("stopped");

const data = samplesRef.current;

const startedAt = data[0]?.t ?? Date.now();
const endedAt = data[data.length - 1]?.t ?? Date.now();
const durationMs = Math.max(0, endedAt - startedAt);

// recompute summary metrics (deterministic)
let sum = 0;
let pk = 0;
for (const s of data) {
sum += s.mag;
if (s.mag > pk) pk = s.mag;
}
const a = data.length ? sum / data.length : 0;

// stability = % within +/- 15% of avg
let stab = 100;
if (data.length >= 2) {
let within = 0;
const band = a * 0.15;
for (const s of data) if (Math.abs(s.mag - a) <= band) within++;
stab = Math.round((within / data.length) * 100);
}

// jolts = count of big jumps between consecutive samples
// (this is a simple placeholder that works well enough for v1)
let jolts = 0;
const joltThreshold = 2.2; // tune later
for (let i = 1; i < data.length; i++) {
const d = Math.abs(data[i].mag - data[i - 1].mag);
if (d >= joltThreshold) jolts++;
}

// controlTime (v1): use stability as proxy
const controlTime = clamp(stab, 0, 100);

// label (v1): simple rule
const resultLabel =
stab >= 85 && jolts <= 2 ? "In Control" : stab >= 70 ? "In Rhythm" : "Out of Control";

// IMPORTANT: match what your saveLastRun expects (AxisLastRun)
// The build error you showed means saveLastRun expects startedAt/endedAt.
const summary = {
sid,
at: Date.now(),
startedAt,
endedAt,
durationMs,
samples: data.length,
tags: tagsRef.current.length,
avgMagnitude: Number(a.toFixed(2)),
peakMagnitude: Number(pk.toFixed(2)),
stability: clamp(stab, 0, 100),
controlTime,
jolts,
resultLabel,
};

saveLastRun(summary as any);
}

function reset() {
samplesRef.current = [];
tagsRef.current = [];
setStatus("ready");
setAvg(0);
setPeak(0);
setStability(100);
setTagsCount(0);
try {
localStorage.removeItem("axis:lastRun");
localStorage.removeItem("axis:lastRunAt");
} catch {}
}

function tagDecision() {
if (status !== "running") return;
tagsRef.current.push(Date.now());
setTagsCount(tagsRef.current.length);
}

async function copyControlLink() {
if (!controlUrl) return;
await navigator.clipboard.writeText(controlUrl);
}

return (
<div className="min-h-screen bg-black text-white">
<div className="max-w-2xl mx-auto p-6">
<div className="flex items-center justify-between gap-3 mb-4">
<div className="flex items-center gap-2">
<div className="h-2 w-2 rounded-full bg-emerald-400" />
<div className="text-lg font-semibold">Axis Run</div>
<div className="text-sm text-neutral-400">{status}</div>
</div>
</div>

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 mb-4">
<div className="text-xs text-neutral-400 mb-2">Controller pairing</div>
<div className="text-sm text-neutral-200 break-all">
{controlUrl || "..."}
</div>
<div className="flex gap-2 mt-3">
<button
className={btnClass(true)}
onClick={copyControlLink}
disabled={!controlUrl}
>
Copy Control Link
</button>
</div>
<div className="text-xs text-neutral-500 mt-2">
Open that link on the controller phone. It will control this session
id.
</div>
</div>

<div className="flex flex-wrap gap-2 mb-3">
<button className={btnClass()} onClick={requestMotion}>
Motion Permission
</button>
<button className={btnClass(true)} onClick={start}>
Start
</button>
<button className={btnClass()} onClick={stop}>
Stop
</button>
<button className={btnClass()} onClick={reset}>
Reset
</button>
<button className={btnClass(true)} onClick={tagDecision}>
Tag Decision
</button>
</div>

<div className="text-sm text-neutral-400 mb-4">
Permission: <b className="text-neutral-200">{permission}</b> • Realtime:{" "}
<b className="text-neutral-200">enabled</b> • Tags:{" "}
<b className="text-neutral-200">{tagsCount}</b>
</div>

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 mb-4">
<div className="text-xs text-neutral-400 mb-2">Waveform</div>
<div className="rounded-2xl border border-neutral-800 bg-black overflow-hidden">
<canvas ref={canvasRef} className="w-full h-[160px]" />
</div>
<div className="text-xs text-neutral-500 mt-3">
Tip: On iPhone, tap <b className="text-neutral-300">Motion Permission</b> once,
then <b className="text-neutral-300">Start</b>. Use{" "}
<b className="text-neutral-300">Tag Decision</b> for key moments.
</div>
</div>

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Avg Magnitude</div>
<div className="text-3xl font-semibold mt-2">{avg.toFixed(2)}</div>
</div>
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Peak Magnitude</div>
<div className="text-3xl font-semibold mt-2">{peak.toFixed(2)}</div>
</div>
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Stability</div>
<div className="text-3xl font-semibold mt-2">{stability}%</div>
</div>
</div>
</div>
</div>
</div>
);
}