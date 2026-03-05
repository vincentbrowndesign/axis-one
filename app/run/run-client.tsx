// app/run/run-client.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Pusher from "pusher-js";
import { computeSummary, saveLastRun, type AxisLastRun, type Sample } from "@/lib/runStore";

function uid() {
return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

function btnClass(primary = false) {
return [
"px-4 py-3 rounded-xl border text-sm",
"bg-neutral-900 border-neutral-700 text-white",
primary ? "ring-1 ring-emerald-500/40 border-emerald-600/40" : "",
"disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");
}

export default function RunClient() {
const [status, setStatus] = useState<"ready" | "running" | "stopped">("ready");
const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
const [sid, setSid] = useState<string>("");

const samplesRef = useRef<Sample[]>([]);
const tagsRef = useRef<number[]>([]);

const [avg, setAvg] = useState(0);
const [peak, setPeak] = useState(0);
const [stability, setStability] = useState(100);
const [tagsCount, setTagsCount] = useState(0);

// Remote-start UX (iOS won’t grant motion permission without a tap)
const [remoteStartRequested, setRemoteStartRequested] = useState(false);

// waveform canvas
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

// ---- Motion permission ----
async function requestMotion() {
try {
const anyDM = DeviceMotionEvent as any;
if (typeof anyDM?.requestPermission === "function") {
const res = await anyDM.requestPermission();
const granted = res === "granted";
setPermission(granted ? "granted" : "denied");
return granted;
} else {
setPermission("granted");
return true;
}
} catch {
setPermission("denied");
return false;
}
}

// ---- Start/Stop/Reset/Tag ----
function startLocal() {
if (status === "running") return;
samplesRef.current = [];
tagsRef.current = [];
setTagsCount(0);
setRemoteStartRequested(false);
setStatus("running");
}

function stopLocal() {
if (status !== "running") return;
setStatus("stopped");

const data = samplesRef.current;
const startedAt = data[0]?.t ?? Date.now();
const endedAt = data[data.length - 1]?.t ?? Date.now();
const durationMs = Math.max(0, endedAt - startedAt);

const run: AxisLastRun = {
sid,
startedAt,
endedAt,
durationMs,
tags: tagsRef.current.slice(),
samples: data.slice(),
};

// Save full run (Measure computes summary deterministically)
saveLastRun(run);

// Also update the visible metrics one last time
const summary = computeSummary(run);
setAvg(summary.avgMagnitude);
setPeak(summary.peakMagnitude);
setStability(summary.stability);
setTagsCount(summary.tags);
}

function resetLocal() {
samplesRef.current = [];
tagsRef.current = [];
setStatus("ready");
setAvg(0);
setPeak(0);
setStability(100);
setTagsCount(0);
setRemoteStartRequested(false);
try {
localStorage.removeItem("axis:lastRun");
if (sid) localStorage.removeItem(`axis:lastRun:${sid}`);
} catch {}
}

function tagDecisionLocal() {
if (status !== "running") return;
tagsRef.current.push(Date.now());
setTagsCount(tagsRef.current.length);
}

// ---- Pusher subscribe: controller commands ----
useEffect(() => {
if (!sid) return;

const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
if (!key || !cluster) return;

const pusher = new Pusher(key, { cluster });

const channelName = `axis-${sid}`;
const channel = pusher.subscribe(channelName);

channel.bind("control", async (msg: any) => {
const type = String(msg?.type || "");

if (type === "start") {
// iOS cannot grant permission without a tap, so request it but also show a prompt.
setRemoteStartRequested(true);
const ok = await requestMotion();
if (ok) startLocal();
return;
}

if (type === "stop") stopLocal();
if (type === "reset") resetLocal();
if (type === "tag") tagDecisionLocal();
});

return () => {
try {
channel.unbind_all();
pusher.unsubscribe(channelName);
pusher.disconnect();
} catch {}
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [sid]);

// ---- Sensor loop ----
useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
if (status !== "running") return;

const ax = e.accelerationIncludingGravity?.x ?? 0;
const ay = e.accelerationIncludingGravity?.y ?? 0;
const az = e.accelerationIncludingGravity?.z ?? 0;

const mag = Math.sqrt(ax * ax + ay * ay + az * az);
samplesRef.current.push({ t: Date.now(), mag });

// guard memory
if (samplesRef.current.length > 2500) samplesRef.current.shift();
}

window.addEventListener("devicemotion", onMotion);
return () => window.removeEventListener("devicemotion", onMotion);
}, [status]);

// ---- UI metrics update loop ----
useEffect(() => {
const id = setInterval(() => {
const data = samplesRef.current;

if (data.length < 2) {
setAvg(0);
setPeak(0);
setStability(100);
setTagsCount(tagsRef.current.length);
return;
}

// quick compute for live display
let sum = 0;
let pk = 0;
for (const s of data) {
sum += s.mag;
if (s.mag > pk) pk = s.mag;
}
const a = sum / data.length;

let within = 0;
const band = a * 0.15;
for (const s of data) {
if (Math.abs(s.mag - a) <= band) within++;
}

setAvg(Number(a.toFixed(2)));
setPeak(Number(pk.toFixed(2)));
setStability(Math.round((within / data.length) * 100));
setTagsCount(tagsRef.current.length);
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

const cssW = canvas.clientWidth;
const cssH = canvas.clientHeight;
const dpr = window.devicePixelRatio || 1;
const w = Math.max(1, Math.floor(cssW * dpr));
const h = Math.max(1, Math.floor(cssH * dpr));
if (canvas.width !== w || canvas.height !== h) {
canvas.width = w;
canvas.height = h;
}

ctx.clearRect(0, 0, w, h);
ctx.fillStyle = "#0b0b0b";
ctx.fillRect(0, 0, w, h);

// grid
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
ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText("No signal yet — tap Start and move the device.", 14, 24);
rafRef.current = requestAnimationFrame(draw);
return;
}

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

ctx.strokeStyle = "rgba(52, 211, 153, 0.95)";
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
ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
ctx.fillText(`Axis line • samples: ${data.length} • sid: ${sid || "…"}`, 14, h - 14);

rafRef.current = requestAnimationFrame(draw);
}

rafRef.current = requestAnimationFrame(draw);
return () => {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
};
}, [sid]);

async function copyControlLink() {
if (!controlUrl) return;
await navigator.clipboard.writeText(controlUrl);
}

async function onPressStart() {
const ok = await requestMotion();
if (ok) startLocal();
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

{remoteStartRequested && permission !== "granted" ? (
<div className="rounded-2xl border border-amber-700/40 bg-amber-950/30 p-4 mb-4">
<div className="text-sm font-semibold text-amber-200">Remote start requested</div>
<div className="text-sm text-neutral-300 mt-1">
iPhone requires a tap to allow motion. Tap <b>Motion Permission</b>, then <b>Start</b>.
</div>
</div>
) : null}

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 mb-4">
<div className="text-xs text-neutral-400 mb-2">Controller pairing</div>
<div className="text-sm text-neutral-200 break-all">{controlUrl || "..."}</div>
<div className="flex gap-2 mt-3">
<button className={btnClass(true)} onClick={copyControlLink} disabled={!controlUrl}>
Copy Control Link
</button>
</div>
<div className="text-xs text-neutral-500 mt-2">
Open that link on the controller phone. It will control this session id.
</div>
</div>

<div className="flex flex-wrap gap-2 mb-3">
<button className={btnClass()} onClick={requestMotion}>
Motion Permission
</button>
<button className={btnClass(true)} onClick={onPressStart}>
Start
</button>
<button className={btnClass()} onClick={stopLocal}>
Stop
</button>
<button className={btnClass()} onClick={resetLocal}>
Reset
</button>
<button className={btnClass(true)} onClick={tagDecisionLocal} disabled={status !== "running"}>
Tag Decision
</button>
</div>

<div className="text-sm text-neutral-400 mb-4">
Permission: <b className="text-neutral-200">{permission}</b> • Realtime:{" "}
<b className="text-neutral-200">enabled</b> • Tags:{" "}
<b className="text-neutral-200">{tagsCount}</b>
</div>

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 mb-4">
<div className="text-xs text-neutral-400 mb-2">Axis Line</div>
<div className="rounded-2xl border border-neutral-800 bg-black overflow-hidden">
<canvas ref={canvasRef} className="w-full h-44 block" />
</div>
<div className="text-xs text-neutral-500 mt-3">
Tip: On iPhone, tap <b className="text-neutral-300">Motion Permission</b> once, then{" "}
<b className="text-neutral-300">Start</b>. Controller can’t grant motion permission remotely.
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