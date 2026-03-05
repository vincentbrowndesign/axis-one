"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Pusher from "pusher-js";

/**
* Axis One — Sensor client
* - Captures DeviceMotion
* - Builds "Axis Line" = stable high-pass signal from accel+gravity magnitude
* - Exports JSON
* - Listens for remote commands (Pusher) from /control page
*/

type PermissionState = "idle" | "granted" | "denied";

type Sample = {
t: number; // ms epoch
dt: number; // ms since previous
// accel (linear-ish, no gravity) if available
ax?: number; ay?: number; az?: number;
// accelIncludingGravity (m/s^2)
gx?: number; gy?: number; gz?: number;
// rotationRate (deg/s) if available
ra?: number; rb?: number; rg?: number;
// orientation (deg)
oa?: number; ob?: number; og?: number;

// derived
gmag?: number; // |accelIncludingGravity|
axisLine?: number; // high-pass filtered signal
};

type TagEvent = {
t: number;
kind: "tag" | "decision";
note?: string;
sampleIndex: number;
};

function clamp(n: number, a: number, b: number) {
return Math.max(a, Math.min(b, n));
}

function fmt(n: number, d = 3) {
if (!Number.isFinite(n)) return "—";
return n.toFixed(d);
}

function makeId(len = 8) {
const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
const arr = new Uint8Array(len);
crypto.getRandomValues(arr);
return Array.from(arr, (x) => chars[x % chars.length]).join("");
}

function downloadJson(filename: string, data: any) {
const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url);
}

/**
* Simple “stable” high-pass:
* - compute magnitude |accelIncludingGravity|
* - remove slow baseline via 1st order low-pass
* - axisLine = mag - baseline
* - optional light smoothing / limiter
*/
class AxisLineFilter {
private baseline = 0;
private initialized = false;

// alpha controls baseline speed (smaller = slower baseline)
// at ~60Hz, alpha 0.02 feels stable
constructor(private alpha = 0.02) {}

step(mag: number) {
if (!this.initialized) {
this.baseline = mag;
this.initialized = true;
return 0;
}
this.baseline = this.baseline + this.alpha * (mag - this.baseline);
const hp = mag - this.baseline;
return hp;
}

reset() {
this.baseline = 0;
this.initialized = false;
}
}

const btn =
"w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-5 text-xl font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)] active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100";
const btnPrimary =
"w-full rounded-2xl bg-white px-5 py-5 text-xl font-semibold text-black shadow-[0_18px_60px_rgba(255,255,255,0.12)] active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100";

function AxisLineChart({ data }: { data: number[] }) {
// tiny canvas chart (no chart libs needed)
const ref = useRef<HTMLCanvasElement | null>(null);

useEffect(() => {
const c = ref.current;
if (!c) return;
const ctx = c.getContext("2d");
if (!ctx) return;

const dpr = window.devicePixelRatio || 1;
const w = c.clientWidth;
const h = c.clientHeight;
c.width = Math.floor(w * dpr);
c.height = Math.floor(h * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

// background
ctx.clearRect(0, 0, w, h);

// grid
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
const gx = 6;
const gy = 4;
for (let i = 1; i < gx; i++) {
const x = (w * i) / gx;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, h);
ctx.stroke();
}
for (let j = 1; j < gy; j++) {
const y = (h * j) / gy;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(w, y);
ctx.stroke();
}

if (!data.length) return;

const maxAbs = Math.max(0.0001, ...data.map((v) => Math.abs(v)));
const scale = (h * 0.42) / maxAbs;

ctx.strokeStyle = "rgba(255,255,255,0.95)";
ctx.lineWidth = 2;

ctx.beginPath();
for (let i = 0; i < data.length; i++) {
const x = (w * i) / Math.max(1, data.length - 1);
const y = h / 2 - data[i] * scale;
if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
}
ctx.stroke();
}, [data]);

return <canvas ref={ref} className="h-48 w-full rounded-2xl" />;
}

export default function RunClient() {
const search = useSearchParams();

// session id used for remote control
const sessionId = useMemo(() => {
const fromUrl = search.get("session")?.trim();
return fromUrl && fromUrl.length >= 6 ? fromUrl : makeId(8);
}, [search]);

const [permission, setPermission] = useState<PermissionState>("idle");
const [isCapturing, setIsCapturing] = useState(false);
const [samples, setSamples] = useState<Sample[]>([]);
const [tags, setTags] = useState<TagEvent[]>([]);
const [error, setError] = useState<string | null>(null);

const filterRef = useRef(new AxisLineFilter(0.02));
const lastTRef = useRef<number | null>(null);

// ring buffer for chart
const chartMax = 240;
const [axisLineRing, setAxisLineRing] = useState<number[]>([]);

const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY!;
const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER!;

// --- Pusher: listen for remote commands
useEffect(() => {
if (!pusherKey || !pusherCluster) return;

const pusher = new Pusher(pusherKey, { cluster: pusherCluster });
const channelName = `axis-one-${sessionId}`;
const channel = pusher.subscribe(channelName);

channel.bind("cmd", (data: any) => {
const name = data?.name as string;
if (!name) return;

if (name === "ENABLE_SENSORS") enableSensors();
if (name === "START") start();
if (name === "STOP") stop();
if (name === "TAG") doTag();
if (name === "DECISION") doDecision();
if (name === "DOWNLOAD") doDownload();
});

return () => {
try {
pusher.unsubscribe(channelName);
pusher.disconnect();
} catch {}
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [sessionId, pusherKey, pusherCluster]);

// --- push state to controller (server triggers)
async function pushState(extra?: Partial<any>) {
const payload = {
isCapturing,
permission,
samples: samples.length,
tags: tags.length,
...extra,
};
await fetch("/api/remote", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ sessionId, type: "state", payload }),
}).catch(() => {});
}

useEffect(() => {
pushState();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [isCapturing, permission, samples.length, tags.length]);

// --- Sensor permission on iOS
async function enableSensors() {
setError(null);

try {
// iOS Safari requires user gesture to call requestPermission
const anyDM: any = DeviceMotionEvent as any;
if (typeof anyDM?.requestPermission === "function") {
const res = await anyDM.requestPermission();
if (res !== "granted") {
setPermission("denied");
setError("Motion permission denied. iOS: Settings → Safari → Motion & Orientation Access.");
return;
}
}
setPermission("granted");
} catch (e: any) {
setPermission("denied");
setError("Motion permission denied. iOS: Settings → Safari → Motion & Orientation Access.");
}
}

function onMotion(e: DeviceMotionEvent) {
if (!isCapturing) return;
const now = Date.now();
const last = lastTRef.current;
const dt = last ? now - last : 0;
lastTRef.current = now;

const acc = e.acceleration;
const accG = e.accelerationIncludingGravity;
const rr = e.rotationRate;

const gx = accG?.x ?? undefined;
const gy = accG?.y ?? undefined;
const gz = accG?.z ?? undefined;

const gmag =
gx != null && gy != null && gz != null
? Math.sqrt(gx * gx + gy * gy + gz * gz)
: undefined;

const axisLine = gmag != null ? filterRef.current.step(gmag) : undefined;

const s: Sample = {
t: now,
dt,
ax: acc?.x ?? undefined,
ay: acc?.y ?? undefined,
az: acc?.z ?? undefined,
gx,
gy,
gz,
ra: rr?.alpha ?? undefined,
rb: rr?.beta ?? undefined,
rg: rr?.gamma ?? undefined,
gmag,
axisLine,
};

setSamples((prev) => {
// keep memory sane (you can raise this)
const next = prev.length > 20000 ? prev.slice(-15000) : prev.slice();
next.push(s);
return next;
});

if (axisLine != null) {
setAxisLineRing((prev) => {
const next = prev.length >= chartMax ? prev.slice(prev.length - chartMax + 1) : prev.slice();
// light limiter so chart is stable
next.push(clamp(axisLine, -25, 25));
return next;
});
}
}

function onOrientation(e: DeviceOrientationEvent) {
if (!isCapturing) return;
// store orientation into the latest sample (cheap: append a small sample)
const now = Date.now();
setSamples((prev) => {
if (!prev.length) return prev;
const last = prev[prev.length - 1];
// only update if close in time (avoid weird merges)
if (Math.abs(now - last.t) > 50) return prev;
const next = prev.slice();
next[next.length - 1] = {
...last,
oa: e.alpha ?? undefined,
ob: e.beta ?? undefined,
og: e.gamma ?? undefined,
};
return next;
});
}

function start() {
if (permission !== "granted") {
setError("Tap Enable Sensors first.");
return;
}
setError(null);

filterRef.current.reset();
lastTRef.current = null;

setIsCapturing(true);

window.addEventListener("devicemotion", onMotion as any, { passive: true });
window.addEventListener("deviceorientation", onOrientation as any, { passive: true });
}

function stop() {
setIsCapturing(false);
window.removeEventListener("devicemotion", onMotion as any);
window.removeEventListener("deviceorientation", onOrientation as any);
}

function doTag() {
if (!samples.length) return;
const t = Date.now();
const sampleIndex = samples.length - 1;
setTags((prev) => [...prev, { t, kind: "tag", sampleIndex }]);
pushState({ lastTag: { t, kind: "tag" } });
}

function doDecision() {
if (!samples.length) return;
const t = Date.now();
const sampleIndex = samples.length - 1;
setTags((prev) => [...prev, { t, kind: "decision", sampleIndex }]);
pushState({ lastTag: { t, kind: "decision" } });
}

function doDownload() {
const exported = {
exported_at: new Date().toISOString(),
environment: "axis-one",
session_id: sessionId,
samples_count: samples.length,
tags_count: tags.length,
samples,
tags,
};
const name = `axis-one-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
downloadJson(name, exported);
}

// cleanup
useEffect(() => {
return () => stop();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

const controllerUrl = useMemo(() => {
if (typeof window === "undefined") return "";
return `${window.location.origin}/control?session=${sessionId}`;
}, [sessionId]);

const statusText =
permission === "granted"
? isCapturing
? "Capturing… move the device."
: "Permission granted."
: permission === "denied"
? "Permission denied."
: "Idle";

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto w-full max-w-xl px-6 pb-20 pt-10">
<h1 className="text-5xl font-semibold tracking-tight">Run (Axis One)</h1>
<p className="mt-2 text-white/60 text-lg">
Capture motion, tag decision windows, export the session.
</p>

<div className="mt-7 rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.65)]">
<div className="text-white/50">Axis One • Run</div>
<div className="mt-2 text-5xl font-semibold">{statusText}</div>

{error ? (
<div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-100">
{error}
</div>
) : null}

<div className="mt-6 grid grid-cols-2 gap-4">
<button className={btn} onClick={enableSensors}>
1) Enable Sensors
</button>
<button className={btnPrimary} onClick={start} disabled={isCapturing}>
2) Start
</button>
<button className={btn} onClick={stop} disabled={!isCapturing}>
Stop
</button>
<button className={btn} onClick={doDecision} disabled={!samples.length}>
Decision
</button>

<button className={btn} onClick={doTag} disabled={!samples.length}>
3) Tag
</button>
<button className={btn} onClick={doDownload} disabled={!samples.length}>
Download JSON
</button>
</div>

{/* Axis Line */}
<div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="flex items-end justify-between">
<div className="text-3xl font-semibold">Axis Line</div>
<div className="text-white/50">live signal</div>
</div>
<div className="mt-4 rounded-3xl border border-white/10 bg-black/30 p-3">
<AxisLineChart data={axisLineRing} />
</div>
<div className="mt-3 text-white/45">
(This is a stable high-pass signal from accel+gravity magnitude. Next step is D/R/J extraction.)
</div>
</div>

<div className="mt-6 grid grid-cols-2 gap-4">
<div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="text-white/50">Samples</div>
<div className="mt-2 text-6xl font-semibold">{samples.length}</div>
<div className="mt-1 text-white/40">~60 Hz</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="text-white/50">Tags</div>
<div className="mt-2 text-6xl font-semibold">{tags.length}</div>
<div className="mt-1 text-white/40">Decision events</div>
</div>
</div>

{/* Remote control share */}
<div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="text-white/50">Remote Control</div>
<div className="mt-2 text-xl font-semibold">Session: {sessionId}</div>
<div className="mt-2 text-white/60 break-all">{controllerUrl}</div>
<div className="mt-3 flex gap-3">
<button
className={btn}
onClick={() => {
navigator.clipboard?.writeText(sessionId).catch(() => {});
}}
>
Copy Session ID
</button>
<button
className={btn}
onClick={() => {
navigator.clipboard?.writeText(controllerUrl).catch(() => {});
}}
>
Copy Controller Link
</button>
</div>
</div>

{/* live sensor readout (optional) */}
<div className="mt-6 space-y-3">
<div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="text-2xl font-semibold">Accel + Gravity (m/s²-ish)</div>
<div className="mt-4 grid grid-cols-2 gap-y-2 text-white/70">
<div>x</div>
<div className="text-right">{fmt(samples.at(-1)?.gx ?? NaN)}</div>
<div>y</div>
<div className="text-right">{fmt(samples.at(-1)?.gy ?? NaN)}</div>
<div>z</div>
<div className="text-right">{fmt(samples.at(-1)?.gz ?? NaN)}</div>
</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="text-2xl font-semibold">Rotation Rate (gyro-ish)</div>
<div className="mt-4 grid grid-cols-2 gap-y-2 text-white/70">
<div>alpha</div>
<div className="text-right">{fmt(samples.at(-1)?.ra ?? NaN)}</div>
<div>beta</div>
<div className="text-right">{fmt(samples.at(-1)?.rb ?? NaN)}</div>
<div>gamma</div>
<div className="text-right">{fmt(samples.at(-1)?.rg ?? NaN)}</div>
</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="text-2xl font-semibold">Orientation (angles)</div>
<div className="mt-4 grid grid-cols-2 gap-y-2 text-white/70">
<div>alpha</div>
<div className="text-right">{fmt(samples.at(-1)?.oa ?? NaN)}</div>
<div>beta</div>
<div className="text-right">{fmt(samples.at(-1)?.ob ?? NaN)}</div>
<div>gamma</div>
<div className="text-right">{fmt(samples.at(-1)?.og ?? NaN)}</div>
</div>

<div className="mt-4 text-white/40">
Tip: iPhone Safari requires tapping <b>Enable Sensors</b> first. If values stay null,
check iOS Settings → Safari → Motion & Orientation Access.
</div>
</div>
</div>
</div>
</div>
</main>
);
}