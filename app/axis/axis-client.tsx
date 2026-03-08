"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PushDirection =
| "Centered"
| "Forward"
| "Back"
| "Left"
| "Right"
| "Forward Left"
| "Forward Right"
| "Back Left"
| "Back Right";

type LockItem = {
id: string;
ts: number;
mark: number;
push: PushDirection;
};

type SensorSample = {
t: number;
ax: number;
ay: number;
az: number;
gx: number;
gy: number;
gz: number;
};

const BUFFER_SIZE = 240;
const LIVE_WINDOW = 22;
const LOCK_THRESHOLD = 82;
const STAY_THRESHOLD = 74;
const FREEZE_MS = 800;
const LOCK_COOLDOWN_MS = 1800;
const CALIBRATION_MS = 1800;

function clamp(n: number, min: number, max: number) {
return Math.max(min, Math.min(max, n));
}

function mean(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function variance(values: number[]) {
if (values.length < 2) return 0;
const m = mean(values);
return mean(values.map((v) => (v - m) ** 2));
}

function std(values: number[]) {
return Math.sqrt(variance(values));
}

function range(values: number[]) {
if (!values.length) return 0;
return Math.max(...values) - Math.min(...values);
}

function uid() {
return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function smoothSeries(values: number[], alpha = 0.28) {
if (!values.length) return [];
const out = [values[0]];
for (let i = 1; i < values.length; i += 1) {
out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
}
return out;
}

function resample(values: number[], count = 72) {
if (!values.length) return Array.from({ length: count }, () => 0);
if (values.length === 1) return Array.from({ length: count }, () => values[0]);

const out: number[] = [];
for (let i = 0; i < count; i += 1) {
const idx = Math.floor((i / (count - 1)) * (values.length - 1));
out.push(values[idx]);
}
return out;
}

function linePath(values: number[], width: number, height: number) {
if (!values.length) return "";
const min = Math.min(...values);
const max = Math.max(...values);
const span = Math.max(max - min, 1);

return values
.map((v, i) => {
const x = (i / Math.max(values.length - 1, 1)) * width;
const y = height - ((v - min) / span) * height;
return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
})
.join(" ");
}

function formatTime(ts: number) {
return new Date(ts).toLocaleTimeString([], {
hour: "numeric",
minute: "2-digit",
second: "2-digit",
});
}

function directionFromVector(x: number, y: number): PushDirection {
const dead = 0.12;
if (Math.abs(x) < dead && Math.abs(y) < dead) return "Centered";

const horiz =
x > 0.22 ? "Right" : x < -0.22 ? "Left" : "";
const vert =
y > 0.22 ? "Forward" : y < -0.22 ? "Back" : "";

const combined = [vert, horiz].filter(Boolean).join(" ") as PushDirection;
return (combined || "Centered") as PushDirection;
}

export default function AxisClient() {
const [mode, setMode] = useState<"demo" | "live">("demo");
const [running, setRunning] = useState(true);
const [sensorReady, setSensorReady] = useState(false);
const [permissionNeeded, setPermissionNeeded] = useState(false);

const [phase, setPhase] = useState<"idle" | "calibrating" | "live">("idle");
const [axisMark, setAxisMark] = useState(0);
const [axisPush, setAxisPush] = useState<PushDirection>("Centered");
const [locked, setLocked] = useState(false);
const [lockFlash, setLockFlash] = useState(false);

const [history, setHistory] = useState<LockItem[]>([]);

const framesRef = useRef<SensorSample[]>([]);
const markSeriesRef = useRef<number[]>([]);

const baselineTiltRef = useRef({ x: 0, y: 0, z: 9.8 });
const calibrationStartRef = useRef<number | null>(null);

const fastMarkRef = useRef(0);
const slowMarkRef = useRef(0);
const lockedStateRef = useRef(false);

const demoTimerRef = useRef<number | null>(null);
const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
const freezeTimerRef = useRef<number | null>(null);
const lockCooldownRef = useRef<number>(0);

const latestPushVectorRef = useRef({ x: 0, y: 0 });

function resetAxisSession(keepMode = true) {
framesRef.current = [];
markSeriesRef.current = [];
fastMarkRef.current = 0;
slowMarkRef.current = 0;
lockedStateRef.current = false;
calibrationStartRef.current = null;
baselineTiltRef.current = { x: 0, y: 0, z: 9.8 };
lockCooldownRef.current = 0;
latestPushVectorRef.current = { x: 0, y: 0 };

setAxisMark(0);
setAxisPush("Centered");
setLocked(false);
setLockFlash(false);
setHistory([]);
setPhase("idle");

if (!keepMode) {
setMode("demo");
setSensorReady(false);
}
}

function beginCalibration() {
calibrationStartRef.current = Date.now();
setPhase("calibrating");
setLocked(false);
setLockFlash(false);
}

function clearLockFlash() {
if (freezeTimerRef.current) {
window.clearTimeout(freezeTimerRef.current);
}
freezeTimerRef.current = window.setTimeout(() => {
setLockFlash(false);
}, FREEZE_MS);
}

function captureLock(mark: number, push: PushDirection) {
const now = Date.now();
if (now < lockCooldownRef.current) return;
lockCooldownRef.current = now + LOCK_COOLDOWN_MS;

setLockFlash(true);
clearLockFlash();

setHistory((prev) => [
{
id: uid(),
ts: now,
mark,
push,
},
...prev,
].slice(0, 10));
}

function processSample(sample: SensorSample) {
framesRef.current.push(sample);
if (framesRef.current.length > BUFFER_SIZE) framesRef.current.shift();

const recent = framesRef.current.slice(-LIVE_WINDOW);
if (recent.length < 10) return;

if (phase === "calibrating") {
const tiltX = mean(recent.map((s) => s.ax));
const tiltY = mean(recent.map((s) => s.ay));
const tiltZ = mean(recent.map((s) => s.az));

baselineTiltRef.current = { x: tiltX, y: tiltY, z: tiltZ };

const started = calibrationStartRef.current ?? Date.now();
if (Date.now() - started >= CALIBRATION_MS) {
setPhase("live");
}
return;
}

if (phase !== "live") return;

const accelMag = recent.map((s) =>
Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az),
);
const gyroMag = recent.map((s) =>
Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz),
);

const accelSmooth = smoothSeries(accelMag, 0.24);
const gyroSmooth = smoothSeries(gyroMag, 0.24);

const accelNoise = std(accelSmooth);
const gyroNoise = std(gyroSmooth);

const base = baselineTiltRef.current;
const tiltX = mean(recent.map((s) => s.ax - base.x));
const tiltY = mean(recent.map((s) => s.ay - base.y));
const tiltZ = mean(recent.map((s) => s.az - base.z));

const tiltMagnitude = Math.sqrt(tiltX * tiltX + tiltY * tiltY);
const motionNoise = accelNoise * 2.2 + gyroNoise * 0.12 + range(accelSmooth) * 0.22;
const settleScore = clamp(100 - motionNoise * 11 - tiltMagnitude * 14 - Math.abs(tiltZ) * 2.5, 0, 100);

if (fastMarkRef.current === 0 && slowMarkRef.current === 0) {
fastMarkRef.current = settleScore;
slowMarkRef.current = settleScore;
} else {
fastMarkRef.current = fastMarkRef.current * 0.56 + settleScore * 0.44;
slowMarkRef.current = slowMarkRef.current * 0.88 + settleScore * 0.12;
}

const blended = clamp(
slowMarkRef.current + (fastMarkRef.current - slowMarkRef.current) * 0.62,
0,
100,
);

if (!lockedStateRef.current && blended >= LOCK_THRESHOLD) {
lockedStateRef.current = true;
} else if (lockedStateRef.current && blended < STAY_THRESHOLD) {
lockedStateRef.current = false;
}

const finalMark = lockedStateRef.current
? Math.max(blended, STAY_THRESHOLD)
: blended;

markSeriesRef.current.push(finalMark);
if (markSeriesRef.current.length > BUFFER_SIZE) {
markSeriesRef.current.shift();
}

const pushX = clamp(tiltX / 4.5, -1, 1);
const pushY = clamp(-tiltY / 4.5, -1, 1);

latestPushVectorRef.current = { x: pushX, y: pushY };

const push = directionFromVector(pushX, pushY);

setAxisMark(Math.round(finalMark));
setAxisPush(push);
setLocked(lockedStateRef.current);

const lastMarks = markSeriesRef.current.slice(-8);
const localPeak = Math.max(...lastMarks);
const sustained = mean(lastMarks.slice(-4)) >= LOCK_THRESHOLD - 1;

if (
Math.round(finalMark) >= LOCK_THRESHOLD &&
Math.round(finalMark) >= localPeak - 1 &&
sustained
) {
captureLock(Math.round(finalMark), push);
}
}

async function enableLiveMotion() {
const Motion = DeviceMotionEvent as typeof DeviceMotionEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

try {
if (typeof Motion.requestPermission === "function") {
const result = await Motion.requestPermission();
if (result !== "granted") return;
}

if (motionHandlerRef.current) {
window.removeEventListener("devicemotion", motionHandlerRef.current, true);
motionHandlerRef.current = null;
}

const handler = (event: DeviceMotionEvent) => {
if (!running) return;

const acc = event.accelerationIncludingGravity;
const rot = event.rotationRate;

processSample({
t: Date.now(),
ax: acc?.x ?? 0,
ay: acc?.y ?? 0,
az: acc?.z ?? 0,
gx: rot?.alpha ?? 0,
gy: rot?.beta ?? 0,
gz: rot?.gamma ?? 0,
});
};

motionHandlerRef.current = handler;
window.addEventListener("devicemotion", handler, true);

setSensorReady(true);
setPermissionNeeded(false);
setMode("live");
beginCalibration();
} catch {
setPermissionNeeded(true);
}
}

function startDemo() {
if (demoTimerRef.current) {
window.clearInterval(demoTimerRef.current);
}

demoTimerRef.current = window.setInterval(() => {
if (!running || mode !== "demo") return;

const t = Date.now() / 1000;
const driftX = Math.sin(t * 0.95 + 0.5) * 0.7;
const driftY = Math.sin(t * 0.63 + 1.1) * 0.55;
const settle = Math.max(0, Math.sin(t * 1.4 + 0.9)) * 0.38;

const sample: SensorSample = {
t: Date.now(),
ax: driftX + settle * 0.12,
ay: driftY * 0.8,
az: 9.8 - settle * 0.18,
gx: driftX * 5.4,
gy: driftY * 4.6,
gz: settle * 1.8,
};

processSample(sample);
}, 50);
}

useEffect(() => {
startDemo();

const Motion = DeviceMotionEvent as typeof DeviceMotionEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

if (typeof Motion !== "undefined" && typeof Motion.requestPermission === "function") {
setPermissionNeeded(true);
}

return () => {
if (demoTimerRef.current) window.clearInterval(demoTimerRef.current);
if (motionHandlerRef.current) {
window.removeEventListener("devicemotion", motionHandlerRef.current, true);
}
if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
};
}, []);

const lineValues = useMemo(
() => resample(markSeriesRef.current.slice(-96), 84),
[axisMark, history.length, lockFlash],
);

const line = useMemo(() => linePath(lineValues, 700, 220), [lineValues]);

const pushVector = latestPushVectorRef.current;
const scopeX = 120 + pushVector.x * 62;
const scopeY = 120 - pushVector.y * 62;

const phaseLabel =
phase === "idle"
? "Idle"
: phase === "calibrating"
? "Align Axis"
: lockFlash
? "Axis Lock"
: "Live";

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
<section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.07),rgba(0,0,0,0.95)_42%)] p-5 shadow-[0_0_80px_rgba(255,255,255,0.04)_inset] sm:p-8">
<div className="text-sm uppercase tracking-[0.35em] text-lime-300/90">
Axis
</div>

<h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
Structure before action.
</h1>

<p className="mt-4 max-w-3xl text-lg leading-8 text-white/65">
Use the phone you already have as Axis Brain. Align Axis, watch Axis Mark rise,
and capture Axis Lock automatically.
</p>

<div className="mt-8 flex flex-wrap gap-4">
<button
onClick={() => {
setMode("demo");
resetAxisSession(true);
beginCalibration();
}}
className={`rounded-full px-6 py-3 text-lg font-medium transition ${
mode === "demo"
? "bg-lime-400 text-black"
: "border border-white/10 bg-black/60 text-white"
}`}
>
Demo
</button>

<button
onClick={enableLiveMotion}
className={`rounded-full px-6 py-3 text-lg font-medium transition ${
mode === "live"
? "bg-lime-400 text-black"
: "border border-white/10 bg-black/60 text-white"
}`}
>
Live Motion
</button>

<button
onClick={() => beginCalibration()}
className="rounded-full border border-white/10 bg-black/60 px-6 py-3 text-lg font-medium text-white"
>
Align Axis
</button>

<button
onClick={() => setRunning((prev) => !prev)}
className="rounded-full border border-white/10 bg-black/60 px-6 py-3 text-lg font-medium text-white"
>
{running ? "Pause" : "Start"}
</button>

<button
onClick={() => resetAxisSession(true)}
className="rounded-full border border-white/10 bg-black/60 px-6 py-3 text-lg font-medium text-white"
>
Reset
</button>
</div>

{permissionNeeded && mode === "live" && !sensorReady ? (
<div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
Motion permission is required for live phone sensing.
</div>
) : null}
</section>

<section className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
<div className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),rgba(0,0,0,0.96)_42%)] p-5 sm:p-8">
<div className="flex items-end justify-between gap-4">
<div>
<div className="text-sm uppercase tracking-[0.28em] text-white/40">
{phaseLabel}
</div>
<div className="mt-2 text-7xl font-semibold leading-none tracking-tight sm:text-[7rem]">
{axisMark}
</div>
<div className="mt-3 text-lg text-white/60">Axis Mark</div>
</div>

<div className="text-right">
<div className="text-sm uppercase tracking-[0.22em] text-white/40">
Axis Push
</div>
<div className="mt-2 text-2xl font-semibold">{axisPush}</div>
<div className="mt-3 text-sm text-white/50">
{lockFlash ? "★ Axis Lock" : locked ? "Holding lock" : "Searching"}
</div>
</div>
</div>

<div className="mt-8 rounded-[28px] border border-white/10 bg-black/50 p-5">
<div className="mb-4 text-xl font-semibold">Axis Scope</div>

<div className="mx-auto flex w-full max-w-[320px] items-center justify-center">
<svg viewBox="0 0 240 240" className="h-[260px] w-[260px]">
<circle cx="120" cy="120" r="92" fill="none" stroke="rgba(255,255,255,0.12)" />
<circle cx="120" cy="120" r="64" fill="none" stroke="rgba(255,255,255,0.10)" />
<circle cx="120" cy="120" r="36" fill="none" stroke="rgba(255,255,255,0.10)" />

<line x1="120" y1="20" x2="120" y2="220" stroke="rgba(255,255,255,0.08)" />
<line x1="20" y1="120" x2="220" y2="120" stroke="rgba(255,255,255,0.08)" />

<circle cx="120" cy="120" r="4" fill="white" opacity="0.8" />

{lockFlash ? (
<circle
cx={scopeX}
cy={scopeY}
r="18"
fill="rgba(154,240,75,0.25)"
/>
) : null}

<circle
cx={scopeX}
cy={scopeY}
r={lockFlash ? 10 : 8}
fill={lockFlash ? "#9AF04B" : "white"}
/>

{lockFlash ? (
<text
x={scopeX}
y={scopeY - 18}
textAnchor="middle"
fill="#9AF04B"
fontSize="18"
fontWeight="700"
>
*
</text>
) : null}
</svg>
</div>
</div>
</div>

<div className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),rgba(0,0,0,0.96)_42%)] p-5 sm:p-8">
<div className="flex items-end justify-between gap-4">
<div>
<h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Axis Line</h2>
<p className="mt-3 text-lg text-white/55">
Signal history of structure over time.
</p>
</div>

<div className="text-sm uppercase tracking-[0.24em] text-white/38">
{mode === "live" && sensorReady ? "Live" : "Demo"}
</div>
</div>

<div className="mt-7 overflow-hidden rounded-[28px] border border-white/10 bg-black/60 p-4 sm:p-5">
<svg viewBox="0 0 700 220" className="h-[280px] w-full" preserveAspectRatio="none">
<line x1="0" y1="48" x2="700" y2="48" stroke="rgba(154,240,75,0.18)" strokeDasharray="4 8" />
<line x1="0" y1="110" x2="700" y2="110" stroke="rgba(255,255,255,0.08)" strokeDasharray="4 8" />
<line x1="0" y1="170" x2="700" y2="170" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 8" />

{Array.from({ length: 8 }).map((_, i) => (
<line
key={i}
x1={i * 100}
y1="0"
x2={i * 100}
y2="220"
stroke="rgba(255,255,255,0.04)"
/>
))}

<path
d={line}
fill="none"
stroke="rgba(154,240,75,0.28)"
strokeWidth={lockFlash ? 10 : 8}
strokeLinecap="round"
strokeLinejoin="round"
/>
<path
d={line}
fill="none"
stroke={lockFlash ? "#9AF04B" : "white"}
strokeWidth={lockFlash ? 4 : 3}
strokeLinecap="round"
strokeLinejoin="round"
/>
</svg>
</div>

<div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
<div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
<div className="text-sm uppercase tracking-[0.22em] text-white/42">Axis Mark</div>
<div className="mt-2 text-4xl font-semibold">{axisMark}</div>
</div>

<div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
<div className="text-sm uppercase tracking-[0.22em] text-white/42">Axis Push</div>
<div className="mt-2 text-2xl font-semibold">{axisPush}</div>
</div>

<div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
<div className="text-sm uppercase tracking-[0.22em] text-white/42">Axis Lock</div>
<div className="mt-2 text-2xl font-semibold">{lockFlash ? "Live" : "Waiting"}</div>
</div>
</div>
</div>
</section>

<section className="mt-7 rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),rgba(0,0,0,0.96)_42%)] p-5 sm:p-8">
<h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Axis History</h2>
<p className="mt-3 text-lg text-white/55">
Captured Axis Lock moments.
</p>

<div className="mt-6 space-y-4">
{history.length === 0 ? (
<div className="rounded-[24px] border border-white/10 bg-black/35 p-6 text-lg text-white/55">
No locks captured yet.
</div>
) : null}

{history.map((item) => (
<div
key={item.id}
className="flex items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-black/35 px-6 py-5"
>
<div>
<div className="text-2xl font-semibold">Axis Lock</div>
<div className="mt-2 text-lg text-white/55">
{item.push} • {formatTime(item.ts)}
</div>
</div>

<div className="text-4xl font-semibold">{item.mark}</div>
</div>
))}
</div>
</section>
</div>
</main>
);
}