"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import AxisLiveChart from "../../components/AxisLiveChart"; // adjust if your path differs

type Vec3 = { x: number; y: number; z: number };
type Ang3 = { alpha: number; beta: number; gamma: number };

type AxisSample = {
t: number; // epoch ms
accel: Vec3 | null;
accelIncludingGravity: Vec3 | null;
rotationRate: Ang3 | null; // we store alpha/beta/gamma
orientation: Ang3 | null;
};

type AxisTag = {
t: number; // epoch ms
dt: number; // ms since session start
label: string;
};

type PermissionState = "unknown" | "granted" | "denied";

function clamp(n: number, a: number, b: number) {
return Math.max(a, Math.min(b, n));
}

function isFiniteNumber(n: any): n is number {
return typeof n === "number" && Number.isFinite(n);
}

function mag(v: Vec3) {
return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
* One-pole high-pass filter.
* y[n] = α * ( y[n-1] + x[n] - x[n-1] )
* α = RC / (RC + dt), RC = 1 / (2π fc)
*/
class HighPass {
private fc: number;
private yPrev = 0;
private xPrev = 0;
private hasPrev = false;

constructor(fcHz: number) {
this.fc = fcHz;
}

reset() {
this.yPrev = 0;
this.xPrev = 0;
this.hasPrev = false;
}

step(x: number, dtSec: number) {
if (!this.hasPrev) {
this.hasPrev = true;
this.xPrev = x;
this.yPrev = 0;
return 0;
}
const RC = 1 / (2 * Math.PI * this.fc);
const alpha = RC / (RC + dtSec);
const y = alpha * (this.yPrev + x - this.xPrev);
this.xPrev = x;
this.yPrev = y;
return y;
}
}

export default function RunClient() {
const [permission, setPermission] = useState<PermissionState>("unknown");
const [status, setStatus] = useState<"Idle" | "Capturing">("Idle");

const [samples, setSamples] = useState<AxisSample[]>([]);
const [tags, setTags] = useState<AxisTag[]>([]);

// live UI sensor readouts
const [accel, setAccel] = useState<Vec3 | null>(null);
const [accelG, setAccelG] = useState<Vec3 | null>(null);
const [rot, setRot] = useState<Ang3 | null>(null);
const [ori, setOri] = useState<Ang3 | null>(null);

// Axis Line stream (numbers only)
const [axisLine, setAxisLine] = useState<number[]>([]);

const startEpochMsRef = useRef<number | null>(null);
const lastMotionTRef = useRef<number | null>(null);

// filter for Axis Line
const hpRef = useRef<HighPass>(new HighPass(0.8)); // cutoff Hz; tweak 0.6–1.2 to taste

// to prevent setState on every sensor event from exploding
const pendingSamplesRef = useRef<AxisSample[]>([]);
const pendingAxisRef = useRef<number[]>([]);
const flushTimerRef = useRef<number | null>(null);

const maxAxisPoints = 360; // ~6 seconds at 60Hz
const maxSamplesStored = 60 * 60 * 3; // cap just in case (3 min at 60Hz ≈ 10,800)

const canRequestPermission = useMemo(() => {
return (
typeof window !== "undefined" &&
typeof (window as any).DeviceMotionEvent !== "undefined" &&
typeof (window as any).DeviceMotionEvent.requestPermission === "function"
);
}, []);

const canListenSensors = useMemo(() => {
return typeof window !== "undefined" && "addEventListener" in window;
}, []);

function fmt(n: number | null | undefined, digits = 3) {
if (!isFiniteNumber(n)) return "—";
return n.toFixed(digits);
}

function nowMs() {
return Date.now();
}

function ensureFlushLoop() {
if (flushTimerRef.current != null) return;
// flush ~10 fps so UI feels live but stable
flushTimerRef.current = window.setInterval(() => {
const batch = pendingSamplesRef.current;
const axisBatch = pendingAxisRef.current;

if (batch.length) {
pendingSamplesRef.current = [];
setSamples((prev) => {
const next = prev.concat(batch);
if (next.length > maxSamplesStored) {
return next.slice(next.length - maxSamplesStored);
}
return next;
});
}

if (axisBatch.length) {
pendingAxisRef.current = [];
setAxisLine((prev) => {
const next = prev.concat(axisBatch);
if (next.length > maxAxisPoints) {
return next.slice(next.length - maxAxisPoints);
}
return next;
});
}
}, 100);
}

function stopFlushLoop() {
if (flushTimerRef.current != null) {
window.clearInterval(flushTimerRef.current);
flushTimerRef.current = null;
}
}

async function enableSensors() {
try {
// iOS Safari requires explicit permission request for motion
if (canRequestPermission) {
const res = await (window as any).DeviceMotionEvent.requestPermission();
if (res !== "granted") {
setPermission("denied");
return;
}
}
setPermission("granted");
} catch {
// Some browsers don't support the permission API; assume user can proceed
setPermission("granted");
}
}

function startCapture() {
if (permission !== "granted") return;

setStatus("Capturing");
hpRef.current.reset();
startEpochMsRef.current = nowMs();
lastMotionTRef.current = null;

// clear current run buffers (keep if you want continuous multi-runs)
setSamples([]);
setTags([]);
setAxisLine([]);

pendingSamplesRef.current = [];
pendingAxisRef.current = [];

ensureFlushLoop();
}

function stopCapture() {
setStatus("Idle");
stopFlushLoop();
}

function addTag(label: string) {
const start = startEpochMsRef.current;
if (!start) return;
const t = nowMs();
const dt = Math.max(0, t - start);
setTags((prev) => prev.concat([{ t, dt, label }]));
}

function downloadJSON() {
const start = startEpochMsRef.current ?? nowMs();
const ended = nowMs();

const payload = {
exported_at: new Date().toISOString(),
environment: "basketball",
started_at_epoch_ms: start,
ended_at_epoch_ms: ended,
samples_count: samples.length,
tags_count: tags.length,
samples,
tags,
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
}

useEffect(() => {
if (!canListenSensors) return;

const onMotion = (e: DeviceMotionEvent) => {
if (status !== "Capturing") return;

const t = nowMs();

// accel (m/s^2-ish)
const a = e.acceleration;
const ag = e.accelerationIncludingGravity;
const rr = e.rotationRate;

const accelNext: Vec3 | null =
a && isFiniteNumber(a.x) && isFiniteNumber(a.y) && isFiniteNumber(a.z)
? { x: a.x!, y: a.y!, z: a.z! }
: null;

const accelGNext: Vec3 | null =
ag &&
isFiniteNumber(ag.x) &&
isFiniteNumber(ag.y) &&
isFiniteNumber(ag.z)
? { x: ag.x!, y: ag.y!, z: ag.z! }
: null;

// rotationRate fields differ across browsers; normalize to alpha/beta/gamma
const rotNext: Ang3 | null =
rr &&
isFiniteNumber((rr as any).alpha) &&
isFiniteNumber((rr as any).beta) &&
isFiniteNumber((rr as any).gamma)
? {
alpha: (rr as any).alpha,
beta: (rr as any).beta,
gamma: (rr as any).gamma,
}
: null;

// update readouts (cheap)
if (accelNext) setAccel(accelNext);
if (accelGNext) setAccelG(accelGNext);
if (rotNext) setRot(rotNext);

// Axis Line calculation (from accelIncludingGravity magnitude)
if (accelGNext) {
const x = mag(accelGNext);

const lastT = lastMotionTRef.current;
const dtSec =
lastT == null ? 1 / 60 : clamp((t - lastT) / 1000, 1 / 240, 1 / 10);

lastMotionTRef.current = t;

const hp = hpRef.current.step(x, dtSec);

// stabilize: soft clip for display
// (keeps huge spikes from flattening everything else)
const display = Math.tanh(hp / 3) * 3;

pendingAxisRef.current.push(display);
}

const sample: AxisSample = {
t,
accel: accelNext,
accelIncludingGravity: accelGNext,
rotationRate: rotNext,
orientation: ori, // latest orientation we have
};

pendingSamplesRef.current.push(sample);
};

const onOrientation = (e: DeviceOrientationEvent) => {
if (status !== "Capturing") return;

const alpha = (e.alpha ?? NaN) as number;
const beta = (e.beta ?? NaN) as number;
const gamma = (e.gamma ?? NaN) as number;

if (
isFiniteNumber(alpha) &&
isFiniteNumber(beta) &&
isFiniteNumber(gamma)
) {
const next = { alpha, beta, gamma };
setOri(next);
}
};

window.addEventListener("devicemotion", onMotion, { passive: true });
window.addEventListener("deviceorientation", onOrientation, {
passive: true,
});

return () => {
window.removeEventListener("devicemotion", onMotion as any);
window.removeEventListener("deviceorientation", onOrientation as any);
};
}, [canListenSensors, status, ori]);

// UI helpers
const permissionText =
permission === "granted"
? "granted"
: permission === "denied"
? "denied"
: "—";

const isCapturing = status === "Capturing";

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto w-full max-w-2xl px-5 pb-16 pt-10">
<h1 className="text-5xl font-semibold tracking-tight">Run (Axis One)</h1>
<p className="mt-3 text-lg text-white/55">
Capture motion, tag decision windows, export the session.
</p>

<div className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_40px_80px_rgba(0,0,0,0.6)]">
<div className="flex items-start justify-between gap-4">
<div>
<div className="text-sm text-white/50">Axis One • Run</div>
<div className="mt-2 text-5xl font-semibold leading-[1.05]">
{permission === "granted"
? isCapturing
? "Capturing..."
: "Permission granted."
: "Idle"}
</div>
{isCapturing && (
<div className="mt-2 text-2xl font-semibold text-white/85">
move the device.
</div>
)}
</div>
<div className="text-sm text-white/40">Home</div>
</div>

{/* buttons grid */}
<div className="mt-8 grid grid-cols-2 gap-4">
<button
onClick={enableSensors}
className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-6 text-center text-xl font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] active:scale-[0.99]"
>
1) Enable
<br />
Sensors
</button>

<button
onClick={startCapture}
disabled={permission !== "granted" || isCapturing}
className={`rounded-2xl px-5 py-6 text-center text-xl font-semibold active:scale-[0.99] ${
permission !== "granted" || isCapturing
? "bg-white/15 text-white/40"
: "bg-white text-black"
}`}
>
2) Start
</button>

<button
onClick={stopCapture}
disabled={!isCapturing}
className={`rounded-2xl border border-white/10 px-5 py-6 text-center text-xl font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] active:scale-[0.99] ${
!isCapturing ? "bg-white/[0.03] text-white/30" : "bg-white/[0.06]"
}`}
>
Stop
</button>

<button
onClick={() => addTag("Decision")}
disabled={!isCapturing}
className={`rounded-2xl border border-white/10 px-5 py-6 text-center text-xl font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] active:scale-[0.99] ${
!isCapturing ? "bg-white/[0.03] text-white/30" : "bg-white/[0.06]"
}`}
>
Decision
</button>
</div>

<button
onClick={() => addTag("Tag")}
disabled={!isCapturing}
className={`mt-4 w-full rounded-2xl border border-white/10 px-5 py-6 text-center text-xl font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] active:scale-[0.99] ${
!isCapturing ? "bg-white/[0.03] text-white/30" : "bg-white/[0.06]"
}`}
>
3) Tag
</button>

<button
onClick={downloadJSON}
className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-6 text-center text-2xl font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] active:scale-[0.99]"
>
Download JSON
</button>

{/* Axis Line */}
<div className="mt-6 rounded-[22px] border border-white/10 bg-black/40 p-5">
<div className="flex items-center justify-between">
<div className="text-2xl font-semibold">Axis Line</div>
<div className="text-sm text-white/45">live signal</div>
</div>

<div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-3">
<AxisLiveChart data={axisLine} />
</div>

<div className="mt-3 text-sm text-white/35">
(This is a stable high-pass signal from accel+gravity magnitude.
Next step is D/R/J extraction.)
</div>
</div>

{/* counters */}
<div className="mt-6 grid grid-cols-2 gap-4">
<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
<div className="text-sm text-white/45">Samples</div>
<div className="mt-2 text-6xl font-semibold leading-none">
{samples.length}
</div>
<div className="mt-2 text-white/35">~60 Hz</div>
</div>

<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
<div className="text-sm text-white/45">Tags</div>
<div className="mt-2 text-6xl font-semibold leading-none">
{tags.length}
</div>
<div className="mt-2 text-white/35">Decision events</div>
</div>
</div>

{/* permission + sensor readouts */}
<div className="mt-6 grid gap-4">
<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
<div className="text-sm text-white/45">Permission</div>
<div className="mt-2 text-4xl font-semibold">{permissionText}</div>
<div className="mt-1 text-white/35">Sensor access</div>
</div>

<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
<div className="text-xl font-semibold">Acceleration (m/s²-ish)</div>
<div className="mt-4 grid grid-cols-2 gap-y-2 text-lg">
<div className="text-white/60">x</div>
<div className="text-right">{fmt(accel?.x)}</div>
<div className="text-white/60">y</div>
<div className="text-right">{fmt(accel?.y)}</div>
<div className="text-white/60">z</div>
<div className="text-right">{fmt(accel?.z)}</div>
</div>
</div>

<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
<div className="text-xl font-semibold">Accel + Gravity</div>
<div className="mt-4 grid grid-cols-2 gap-y-2 text-lg">
<div className="text-white/60">x</div>
<div className="text-right">{fmt(accelG?.x)}</div>
<div className="text-white/60">y</div>
<div className="text-right">{fmt(accelG?.y)}</div>
<div className="text-white/60">z</div>
<div className="text-right">{fmt(accelG?.z)}</div>
</div>
</div>

<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
<div className="text-xl font-semibold">Rotation Rate (gyro-ish)</div>
<div className="mt-4 grid grid-cols-2 gap-y-2 text-lg">
<div className="text-white/60">alpha</div>
<div className="text-right">{fmt(rot?.alpha)}</div>
<div className="text-white/60">beta</div>
<div className="text-right">{fmt(rot?.beta)}</div>
<div className="text-white/60">gamma</div>
<div className="text-right">{fmt(rot?.gamma)}</div>
</div>
</div>

<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
<div className="text-xl font-semibold">Orientation (angles)</div>
<div className="mt-4 grid grid-cols-2 gap-y-2 text-lg">
<div className="text-white/60">alpha</div>
<div className="text-right">{fmt(ori?.alpha)}</div>
<div className="text-white/60">beta</div>
<div className="text-right">{fmt(ori?.beta)}</div>
<div className="text-white/60">gamma</div>
<div className="text-right">{fmt(ori?.gamma)}</div>
</div>
<div className="mt-4 text-sm text-white/35">
Tip: iPhone Safari requires tapping <b>Enable Sensors</b> first.
If values stay null, check iOS Settings → Safari → Motion &
Orientation Access.
</div>
</div>
</div>
</div>
</div>
</div>
);
}