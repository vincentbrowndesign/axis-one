"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Pusher from "pusher-js";
import { QRCodeCanvas } from "qrcode.react";

/**
* Axis One — Run Client
* - Captures iPhone motion sensors (DeviceMotion + DeviceOrientation)
* - Builds Axis Line (high-pass accel+gravity magnitude)
* - Supports remote control via Pusher (different networks)
* - Shows QR to pair a controller device
*
* ENV (Vercel):
* NEXT_PUBLIC_PUSHER_KEY=...
* NEXT_PUBLIC_PUSHER_CLUSTER=...
*
* Controller should publish events to the SAME channel+event:
* Channel: axis-one-<sessionId>
* Event: control
* Payload: { action: "start"|"stop"|"tag"|"decision" }
*/

type AxisTagType = "tag" | "decision";

type AxisTag = {
id: string;
type: AxisTagType;
t_ms: number; // session-relative ms
at_iso: string;
};

type MotionSample = {
t_ms: number; // session-relative ms
at_iso: string;

// DeviceMotion
ax?: number | null;
ay?: number | null;
az?: number | null;

agx?: number | null; // accel including gravity
agy?: number | null;
agz?: number | null;

rx?: number | null; // rotationRate
ry?: number | null;
rz?: number | null;

interval?: number | null;

// DeviceOrientation
alpha?: number | null;
beta?: number | null;
gamma?: number | null;
};

function uid(prefix = "id") {
return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Math.random()
.toString(36)
.slice(2, 6)}`;
}

function clamp(n: number, lo: number, hi: number) {
return Math.max(lo, Math.min(hi, n));
}

function fmtHzFromIntervalMs(ms: number | null | undefined) {
if (!ms || ms <= 0) return "~60 Hz";
const hz = 1000 / ms;
if (!isFinite(hz)) return "~60 Hz";
if (hz >= 55) return "~60 Hz";
return `~${hz.toFixed(0)} Hz`;
}

/**
* One-pole high-pass filter:
* y[n] = a * (y[n-1] + x[n] - x[n-1])
* a = RC / (RC + dt)
* RC = 1 / (2*pi*fc)
*/
function makeHighPass(fcHz: number) {
const RC = 1 / (2 * Math.PI * fcHz);
let prevX = 0;
let prevY = 0;
let prevT = 0;
return (x: number, tMs: number) => {
if (prevT === 0) {
prevT = tMs;
prevX = x;
prevY = 0;
return 0;
}
const dt = (tMs - prevT) / 1000;
prevT = tMs;
const a = RC / (RC + dt);
const y = a * (prevY + x - prevX);
prevX = x;
prevY = y;
return y;
};
}

function AxisLineMiniChart({
data,
height = 140,
}: {
data: number[];
height?: number;
}) {
const w = 640;
const h = height;
const padding = 10;

const { pathD } = useMemo(() => {
if (!data.length) return { pathD: "" };
const maxAbs = Math.max(1e-6, ...data.map((v) => Math.abs(v)));
const xs = data.map((_, i) => i / (data.length - 1 || 1));
const ys = data.map((v) => v / maxAbs); // [-1,1]

const pts = xs.map((x, i) => {
const px = padding + x * (w - padding * 2);
const py = padding + (1 - (ys[i] * 0.5 + 0.5)) * (h - padding * 2);
return [px, py] as const;
});

let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
for (let i = 1; i < pts.length; i++) {
d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
}
return { pathD: d };
}, [data, h]);

return (
<div className="w-full rounded-2xl overflow-hidden border border-white/10 bg-black/40">
<svg
viewBox={`0 0 ${w} ${h}`}
className="block w-full h-auto"
aria-label="Axis Line"
>
{/* grid */}
<g opacity={0.25} stroke="white" strokeWidth="1">
{Array.from({ length: 7 }).map((_, i) => {
const x = padding + (i / 6) * (w - padding * 2);
return <line key={`vx${i}`} x1={x} y1={0} x2={x} y2={h} />;
})}
{Array.from({ length: 5 }).map((_, i) => {
const y = padding + (i / 4) * (h - padding * 2);
return <line key={`hy${i}`} x1={0} y1={y} x2={w} y2={y} />;
})}
</g>

{/* waveform */}
<path
d={pathD}
fill="none"
stroke="white"
strokeWidth="3"
strokeLinejoin="round"
strokeLinecap="round"
/>
</svg>
</div>
);
}

export default function RunClient() {
const [sessionId] = useState(() => uid("sess"));
const [permission, setPermission] = useState<"unknown" | "granted" | "denied">(
"unknown"
);

const [status, setStatus] = useState<
"Idle" | "Permission granted." | "Capturing... move the device."
>("Idle");

const [isCapturing, setIsCapturing] = useState(false);
const [samplesCount, setSamplesCount] = useState(0);
const [tagsCount, setTagsCount] = useState(0);

const startEpochRef = useRef<number | null>(null);
const lastIntervalMsRef = useRef<number | null>(null);

const samplesRef = useRef<MotionSample[]>([]);
const tagsRef = useRef<AxisTag[]>([]);

// Axis line ring buffer (keeps UI fast)
const AXIS_BUF = 220;
const axisLineRef = useRef<number[]>([]);
const [, bump] = useState(0);

// Filter for accel+gravity magnitude -> Axis Line
const hpRef = useRef<(x: number, tMs: number) => number>(() => 0);
const lastMotionStampRef = useRef<number>(0);

// Pusher
const pusherRef = useRef<Pusher | null>(null);

const origin =
typeof window !== "undefined" ? window.location.origin : "https://axismeasure.com";

const pairingUrl = useMemo(() => {
return `${origin}/control?sid=${encodeURIComponent(sessionId)}`;
}, [origin, sessionId]);

const nowIso = () => new Date().toISOString();

const getTms = () => {
if (!startEpochRef.current) return 0;
return performance.now() - startEpochRef.current;
};

const pushAxisLine = (v: number) => {
const buf = axisLineRef.current;
buf.push(v);
if (buf.length > AXIS_BUF) buf.splice(0, buf.length - AXIS_BUF);
};

const addTag = useCallback((type: AxisTagType) => {
const t_ms = getTms();
const tag: AxisTag = {
id: uid("tag"),
type,
t_ms,
at_iso: nowIso(),
};
tagsRef.current.push(tag);
setTagsCount(tagsRef.current.length);
}, []);

const onMotion = useCallback((e: DeviceMotionEvent) => {
if (!startEpochRef.current) return;

const t_ms = getTms();

// throttle-ish to avoid insane push rate on some devices
const last = lastMotionStampRef.current;
if (last && t_ms - last < 12) return; // ~83Hz max
lastMotionStampRef.current = t_ms;

const acc = e.acceleration;
const ag = e.accelerationIncludingGravity;
const rr = e.rotationRate;

const sample: MotionSample = {
t_ms,
at_iso: nowIso(),

ax: acc?.x ?? null,
ay: acc?.y ?? null,
az: acc?.z ?? null,

agx: ag?.x ?? null,
agy: ag?.y ?? null,
agz: ag?.z ?? null,

rx: rr?.alpha ?? null,
ry: rr?.beta ?? null,
rz: rr?.gamma ?? null,

interval: typeof e.interval === "number" ? e.interval : null,
};

lastIntervalMsRef.current = sample.interval ?? lastIntervalMsRef.current;

samplesRef.current.push(sample);
setSamplesCount(samplesRef.current.length);

// Axis Line source: accel+gravity magnitude
const gx = sample.agx ?? 0;
const gy = sample.agy ?? 0;
const gz = sample.agz ?? 0;
const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);

// High-pass to remove gravity DC + slow drift
const hp = hpRef.current(mag, t_ms);

// Visual scaling (keeps line readable)
const scaled = clamp(hp * 0.35, -6, 6);

pushAxisLine(scaled);

// update UI occasionally (not every sample)
if (samplesRef.current.length % 4 === 0) bump((x) => x + 1);
}, []);

const onOrientation = useCallback((e: DeviceOrientationEvent) => {
if (!startEpochRef.current) return;

// add orientation into the latest sample (cheap + keeps sample format stable)
const s = samplesRef.current[samplesRef.current.length - 1];
if (!s) return;

s.alpha = typeof e.alpha === "number" ? e.alpha : null;
s.beta = typeof e.beta === "number" ? e.beta : null;
s.gamma = typeof e.gamma === "number" ? e.gamma : null;
}, []);

const stopCapture = useCallback(() => {
window.removeEventListener("devicemotion", onMotion as any);
window.removeEventListener("deviceorientation", onOrientation as any);
setIsCapturing(false);
setStatus(permission === "granted" ? "Permission granted." : "Idle");
}, [onMotion, onOrientation, permission]);

const startCapture = useCallback(() => {
if (permission !== "granted") return;

if (!startEpochRef.current) startEpochRef.current = performance.now();

// reset filter each run start so the line feels stable
hpRef.current = makeHighPass(0.7);

window.addEventListener("devicemotion", onMotion as any, { passive: true });
window.addEventListener("deviceorientation", onOrientation as any, {
passive: true,
});

setIsCapturing(true);
setStatus("Capturing... move the device.");
}, [onMotion, onOrientation, permission]);

const requestPermission = useCallback(async () => {
try {
// iOS Safari requires user gesture + requestPermission
const anyDM = DeviceMotionEvent as any;
if (typeof anyDM?.requestPermission === "function") {
const res = await anyDM.requestPermission();
if (res === "granted") {
setPermission("granted");
setStatus("Permission granted.");
return;
}
setPermission("denied");
setStatus("Idle");
return;
}

// Non-iOS browsers generally allow immediately
setPermission("granted");
setStatus("Permission granted.");
} catch {
setPermission("denied");
setStatus("Idle");
}
}, []);

const downloadJson = useCallback(() => {
const payload = {
exported_at: nowIso(),
environment: "basketball",
session_id: sessionId,
samples_count: samplesRef.current.length,
tags_count: tagsRef.current.length,
tags: tagsRef.current,
samples: samplesRef.current,
axis_line_preview: axisLineRef.current, // last ~220 points
};

const blob = new Blob([JSON.stringify(payload, null, 2)], {
type: "application/json",
});
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `axis-one-session-${new Date()
.toISOString()
.replace(/[:.]/g, "-")}.json`;
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
}, [sessionId]);

// Pusher: listen for controller actions
useEffect(() => {
const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

if (!key || !cluster) return;

// Avoid reconnect loop if HMR
if (pusherRef.current) return;

const p = new Pusher(key, {
cluster,
forceTLS: true,
});

pusherRef.current = p;

const channelName = `axis-one-${sessionId}`;
const ch = p.subscribe(channelName);

ch.bind("control", (payload: any) => {
const action = payload?.action as
| "start"
| "stop"
| "tag"
| "decision"
| undefined;

if (!action) return;

if (action === "start") startCapture();
if (action === "stop") stopCapture();
if (action === "tag") addTag("tag");
if (action === "decision") addTag("decision");
});

return () => {
try {
ch.unbind_all();
p.unsubscribe(channelName);
p.disconnect();
} catch {}
pusherRef.current = null;
};
}, [addTag, sessionId, startCapture, stopCapture]);

const hzLabel = useMemo(() => fmtHzFromIntervalMs(lastIntervalMsRef.current), [
samplesCount,
]);

// ---------- UI ----------
const canStart = permission === "granted" && !isCapturing;
const canStop = isCapturing;

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-xl px-5 py-10">
<h1 className="text-5xl font-semibold tracking-tight">Run (Axis One)</h1>
<p className="mt-3 text-white/55 text-lg">
Capture motion, tag decision windows, export the session.
</p>

<div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_60px_rgba(255,255,255,0.06)]">
<div className="text-white/45 text-sm">Axis One • Run</div>
<div className="mt-2 text-5xl font-semibold leading-[0.95]">
{status}
</div>

<div className="mt-7 grid grid-cols-2 gap-4">
<button
onClick={requestPermission}
className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-6 text-xl font-semibold active:scale-[0.99]"
>
1) Enable
<br />
Sensors
</button>

<button
onClick={startCapture}
disabled={!canStart}
className={[
"rounded-2xl px-4 py-6 text-xl font-semibold active:scale-[0.99]",
canStart
? "bg-white text-black"
: "bg-white/15 text-white/40 border border-white/10",
].join(" ")}
>
2) Start
</button>

<button
onClick={stopCapture}
disabled={!canStop}
className={[
"rounded-2xl border border-white/10 px-4 py-5 text-xl font-semibold active:scale-[0.99]",
canStop ? "bg-white/[0.06]" : "bg-white/[0.02] text-white/30",
].join(" ")}
>
Stop
</button>

<button
onClick={() => addTag("decision")}
disabled={!isCapturing}
className={[
"rounded-2xl border border-white/10 px-4 py-5 text-xl font-semibold active:scale-[0.99]",
isCapturing ? "bg-white/[0.06]" : "bg-white/[0.02] text-white/30",
].join(" ")}
>
Decision
</button>

<button
onClick={() => addTag("tag")}
disabled={!isCapturing}
className={[
"col-span-2 rounded-2xl border border-white/10 px-4 py-5 text-xl font-semibold active:scale-[0.99]",
isCapturing ? "bg-white/[0.06]" : "bg-white/[0.02] text-white/30",
].join(" ")}
>
3) Tag
</button>

<button
onClick={downloadJson}
className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-5 text-xl font-semibold active:scale-[0.99]"
>
Download JSON
</button>
</div>

<div className="mt-8 rounded-3xl border border-white/10 bg-black/30 p-5">
<div className="flex items-center justify-between">
<div className="text-3xl font-semibold">Axis Line</div>
<div className="text-white/45">live signal</div>
</div>

<div className="mt-4">
<AxisLineMiniChart data={axisLineRef.current} height={160} />
</div>

<div className="mt-4 text-white/40 text-sm leading-relaxed">
(This is a stable high-pass signal from accel+gravity magnitude.
Next step is D/R/J extraction.)
</div>
</div>

<div className="mt-6 grid grid-cols-2 gap-4">
<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
<div className="text-white/45">Samples</div>
<div className="mt-2 text-6xl font-semibold">{samplesCount}</div>
<div className="mt-2 text-white/40">{hzLabel}</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
<div className="text-white/45">Tags</div>
<div className="mt-2 text-6xl font-semibold">{tagsCount}</div>
<div className="mt-2 text-white/40">Decision events</div>
</div>
</div>

<div className="mt-7 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
<div className="flex items-center justify-between">
<div className="text-lg font-semibold">Pair controller</div>
<div className="text-white/40 text-sm">{sessionId}</div>
</div>

<div className="mt-4 flex justify-center">
<div className="rounded-2xl bg-white p-4">
<QRCodeCanvas value={pairingUrl} size={220} />
</div>
</div>

<div className="mt-4 text-white/45 text-sm break-all">
{pairingUrl}
</div>

<div className="mt-2 text-white/35 text-xs">
Tip: iPhone Safari requires tapping <b>Enable Sensors</b> first. If
values stay null: iOS Settings → Safari → Motion &amp; Orientation
Access.
</div>
</div>
</div>
</div>
</main>
);
}