"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SignalType = "Clean" | "Shift" | "Drop" | "Float" | "Off Axis";

type SensorFrame = {
t: number;
ax: number;
ay: number;
az: number;
gx: number;
gy: number;
gz: number;
};

type HistoryItem = {
id: string;
score: number;
signal: SignalType;
time: string;
};

const BUFFER_SIZE = 220;
const LIVE_WINDOW = 24;
const FREEZE_MS = 1600;
const CAPTURE_COOLDOWN_MS = 2600;

const ENTER_READY_THRESHOLD = 75;
const STAY_READY_THRESHOLD = 70;
const OFF_AXIS_THRESHOLD = 49;

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
return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatClock(ts: number) {
return new Date(ts).toLocaleTimeString([], {
hour: "numeric",
minute: "2-digit",
second: "2-digit",
});
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

function classifySignal(
readySeries: number[],
lateralSeries: number[],
verticalSeries: number[],
noiseSeries: number[],
): SignalType {
const ready = readySeries.slice(-16);
const lateral = lateralSeries.slice(-16);
const vertical = verticalSeries.slice(-16);
const noise = noiseSeries.slice(-16);

const readyMean = mean(ready);
const readyStd = std(ready);
const lateralMean = mean(lateral);
const lateralRange = range(lateral);
const verticalMean = mean(vertical);
const verticalRange = range(vertical);
const noiseMean = mean(noise);

if (
readyMean < 58 ||
lateralMean > 3.9 ||
lateralRange > 3.7 ||
noiseMean > 5.6
) {
return "Off Axis";
}

if (
readyMean > 84 &&
readyStd < 2.6 &&
lateralMean < 1.15 &&
verticalMean < 1.05 &&
noiseMean < 2.8
) {
return "Float";
}

if (verticalMean > 1.45 || verticalRange > 4.5) {
return "Drop";
}

if (lateralMean > 1.35 || lateralRange > 3.1) {
return "Shift";
}

return "Clean";
}

export default function AxisClient() {
const [running, setRunning] = useState(true);
const [mode, setMode] = useState<"live" | "demo">("demo");
const [sensorReady, setSensorReady] = useState(false);
const [permissionNeeded, setPermissionNeeded] = useState(false);

const [axisReady, setAxisReady] = useState(0);
const [signalNoise, setSignalNoise] = useState(0);
const [signal, setSignal] = useState<SignalType>("Clean");

const [history, setHistory] = useState<HistoryItem[]>([]);
const [frozenScore, setFrozenScore] = useState<number | null>(null);
const [frozenSignal, setFrozenSignal] = useState<SignalType | null>(null);

const framesRef = useRef<SensorFrame[]>([]);
const readySeriesRef = useRef<number[]>([]);
const lateralSeriesRef = useRef<number[]>([]);
const verticalSeriesRef = useRef<number[]>([]);
const noiseSeriesRef = useRef<number[]>([]);

const fastReadyRef = useRef(0);
const slowReadyRef = useRef(0);
const readyStateRef = useRef(false);

const demoTimerRef = useRef<number | null>(null);
const freezeTimerRef = useRef<number | null>(null);
const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
const cooldownUntilRef = useRef<number>(0);

const chartValues = useMemo(
() => resample(readySeriesRef.current.slice(-96), 84),
[axisReady, frozenScore],
);

const chartPath = useMemo(() => linePath(chartValues, 700, 240), [chartValues]);

function clearFreeze() {
if (freezeTimerRef.current) {
window.clearTimeout(freezeTimerRef.current);
}

freezeTimerRef.current = window.setTimeout(() => {
setFrozenScore(null);
setFrozenSignal(null);
}, FREEZE_MS);
}

function captureAutomatic(nextScore: number, nextSignal: SignalType) {
const now = Date.now();
if (now < cooldownUntilRef.current) return;
if (nextSignal === "Off Axis") return;

const threshold = nextSignal === "Float" ? 72 : ENTER_READY_THRESHOLD;
if (nextScore < threshold) return;

const recent = readySeriesRef.current.slice(-10);
if (recent.length < 6) return;

const localPeak = Math.max(...recent);
const recentMean4 = mean(recent.slice(-4));
const recentMean6 = mean(recent.slice(-6));
const sustained = recentMean4 >= threshold;
const risingIntent = recentMean4 >= recentMean6 - 1;
const isPeak = nextScore >= localPeak - 1;

if (!isPeak || !sustained || !risingIntent) return;

cooldownUntilRef.current = now + CAPTURE_COOLDOWN_MS;

setFrozenScore(nextScore);
setFrozenSignal(nextSignal);
clearFreeze();

setHistory((prev) =>
[
{
id: uid(),
score: nextScore,
signal: nextSignal,
time: formatClock(now),
},
...prev,
].slice(0, 12),
);
}

function processFrame(frame: SensorFrame) {
framesRef.current.push(frame);
if (framesRef.current.length > BUFFER_SIZE) framesRef.current.shift();

const recent = framesRef.current.slice(-LIVE_WINDOW);
if (recent.length < 12) return;

const accelMag = recent.map((f) =>
Math.sqrt(f.ax * f.ax + f.ay * f.ay + f.az * f.az),
);
const gyroMag = recent.map((f) =>
Math.sqrt(f.gx * f.gx + f.gy * f.gy + f.gz * f.gz),
);
const lateral = recent.map((f) => Math.sqrt(f.ax * f.ax + f.ay * f.ay));
const vertical = recent.map((f) => Math.abs(f.az - 9.8));

const accelSmooth = smoothSeries(accelMag, 0.24);
const gyroSmooth = smoothSeries(gyroMag, 0.24);

const accelNoise = std(accelSmooth);
const gyroNoise = std(gyroSmooth);
const lateralNoise = std(lateral);
const lateralRange = range(lateral);
const verticalMove = mean(vertical);
const verticalRange = range(vertical);

const noise =
accelNoise * 2.05 +
gyroNoise * 0.12 +
lateralNoise * 0.95 +
lateralRange * 0.18;

const rawReady = clamp(
100 -
noise * 10.4 -
verticalMove * 8.2 -
verticalRange * 1.05 -
lateralNoise * 6.1,
0,
100,
);

if (fastReadyRef.current === 0 && slowReadyRef.current === 0) {
fastReadyRef.current = rawReady;
slowReadyRef.current = rawReady;
} else {
fastReadyRef.current = fastReadyRef.current * 0.55 + rawReady * 0.45;
slowReadyRef.current = slowReadyRef.current * 0.88 + rawReady * 0.12;
}

const blendedReady = clamp(
slowReadyRef.current + (fastReadyRef.current - slowReadyRef.current) * 0.6,
0,
100,
);

if (!readyStateRef.current && blendedReady >= ENTER_READY_THRESHOLD) {
readyStateRef.current = true;
} else if (readyStateRef.current && blendedReady < STAY_READY_THRESHOLD) {
readyStateRef.current = false;
}

const finalReady = readyStateRef.current
? Math.max(blendedReady, STAY_READY_THRESHOLD)
: blendedReady;

readySeriesRef.current.push(finalReady);
lateralSeriesRef.current.push(lateralNoise + lateralRange * 0.12);
verticalSeriesRef.current.push(verticalMove + verticalRange * 0.1);
noiseSeriesRef.current.push(noise);

if (readySeriesRef.current.length > BUFFER_SIZE) readySeriesRef.current.shift();
if (lateralSeriesRef.current.length > BUFFER_SIZE) lateralSeriesRef.current.shift();
if (verticalSeriesRef.current.length > BUFFER_SIZE) verticalSeriesRef.current.shift();
if (noiseSeriesRef.current.length > BUFFER_SIZE) noiseSeriesRef.current.shift();

const nextSignal = classifySignal(
readySeriesRef.current,
lateralSeriesRef.current,
verticalSeriesRef.current,
noiseSeriesRef.current,
);

setAxisReady(Math.round(finalReady));
setSignalNoise(Number(noise.toFixed(1)));
setSignal(nextSignal);

captureAutomatic(Math.round(finalReady), nextSignal);
}

function startDemo() {
if (demoTimerRef.current) {
window.clearInterval(demoTimerRef.current);
}

demoTimerRef.current = window.setInterval(() => {
if (!running || mode !== "demo") return;

const t = Date.now() / 1000;

const drift = Math.sin(t * 0.9 + 0.6) * 0.82;
const plate = Math.sin(t * 0.38) * 0.22;
const dropPulse = Math.max(0, Math.sin(t * 1.65 + 0.35)) * 0.62;
const floatPulse = Math.max(0, Math.sin(t * 0.72 + 1.4)) * 0.18;

processFrame({
t: Date.now(),
ax: drift * 1.15 + floatPulse * 0.08,
ay: plate * 0.5 + dropPulse * 0.28,
az: 9.8 + plate * 0.22 - dropPulse * 0.58 + floatPulse * 0.12,
gx: drift * 5.6 + dropPulse * 1.4,
gy: plate * 3.1 + floatPulse * 0.8,
gz: drift * 3.0,
});
}, 50);
}

function stopLiveSensor() {
if (motionHandlerRef.current) {
window.removeEventListener("devicemotion", motionHandlerRef.current, true);
motionHandlerRef.current = null;
}
setSensorReady(false);
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

stopLiveSensor();

const handler = (event: DeviceMotionEvent) => {
if (!running || mode !== "live") return;

const acc = event.accelerationIncludingGravity;
const rot = event.rotationRate;

processFrame({
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
} catch {
setPermissionNeeded(true);
}
}

function resetSession() {
framesRef.current = [];
readySeriesRef.current = [];
lateralSeriesRef.current = [];
verticalSeriesRef.current = [];
noiseSeriesRef.current = [];

fastReadyRef.current = 0;
slowReadyRef.current = 0;
readyStateRef.current = false;

cooldownUntilRef.current = 0;

setAxisReady(0);
setSignalNoise(0);
setSignal("Clean");
setHistory([]);
setFrozenScore(null);
setFrozenSignal(null);
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
if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
stopLiveSensor();
};
}, []);

const readyLabel =
axisReady >= ENTER_READY_THRESHOLD
? "Axis Ready"
: axisReady <= OFF_AXIS_THRESHOLD
? "Off Axis"
: "Axis";

const displayScore = frozenScore ?? axisReady;
const displaySignal = frozenSignal ?? signal;

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
<section className="rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),rgba(0,0,0,0.95)_42%)] p-5 shadow-[0_0_80px_rgba(255,255,255,0.04)_inset] sm:p-8">
<div className="mb-2 text-sm uppercase tracking-[0.35em] text-lime-300/90">
Axis
</div>

<h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
Structure before action.
</h1>

<p className="mt-4 max-w-3xl text-lg leading-8 text-white/65 sm:text-[1.65rem] sm:leading-[1.5]">
Axis detects favorable structure before force. It reads the body, freezes
real peaks automatically, and stores them in Axis History.
</p>

<div className="mt-8 flex flex-wrap gap-4">
<button
onClick={() => {
setMode("live");
enableLiveMotion();
}}
className={`rounded-full px-7 py-4 text-xl font-medium transition ${
mode === "live"
? "bg-lime-400 text-black"
: "border border-white/10 bg-black/60 text-white"
}`}
>
Live Motion
</button>

<button
onClick={() => setMode("demo")}
className={`rounded-full px-7 py-4 text-xl font-medium transition ${
mode === "demo"
? "bg-lime-400 text-black"
: "border border-white/10 bg-black/60 text-white"
}`}
>
Demo Signal
</button>

<button
onClick={() => setRunning((prev) => !prev)}
className="rounded-full border border-white/10 bg-black/60 px-7 py-4 text-xl font-medium text-white transition"
>
{running ? "Pause" : "Start"}
</button>

<button
onClick={resetSession}
className="rounded-full border border-white/10 bg-black/60 px-7 py-4 text-xl font-medium text-white transition"
>
Reset
</button>
</div>

{permissionNeeded && mode === "live" && !sensorReady ? (
<div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
Motion access required for Live Motion.
</div>
) : null}

<div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-[1.35fr_0.65fr]">
<div className="rounded-[28px] border border-white/10 bg-black/55 px-6 py-6 sm:px-8 sm:py-8">
<div className="text-lg uppercase tracking-[0.25em] text-white/42">
{readyLabel}
</div>
<div className="mt-3 text-7xl font-semibold leading-none tracking-tight sm:text-[7.5rem]">
{displayScore}%
</div>
</div>

<div className="grid grid-cols-1 gap-4">
<div className="rounded-[28px] border border-white/10 bg-black/55 px-6 py-5">
<div className="text-sm uppercase tracking-[0.22em] text-white/42">
Signal
</div>
<div className="mt-2 text-3xl font-semibold">{displaySignal}</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-black/55 px-6 py-5">
<div className="text-sm uppercase tracking-[0.22em] text-white/42">
Signal Noise
</div>
<div className="mt-2 text-3xl font-semibold">{signalNoise}</div>
</div>
</div>
</div>
</section>

<section className="mt-7 rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),rgba(0,0,0,0.96)_42%)] p-5 sm:p-8">
<div className="flex items-end justify-between gap-4">
<div>
<h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Axis Line</h2>
<p className="mt-3 text-xl text-white/55">
The live line of the measured axis.
</p>
</div>

<div className="text-right text-sm uppercase tracking-[0.22em] text-white/35">
{frozenScore !== null ? "Frozen" : sensorReady && mode === "live" ? "Live" : "Demo"}
</div>
</div>

<div className="mt-7 overflow-hidden rounded-[28px] border border-white/10 bg-black/60 p-4 sm:p-5">
<svg viewBox="0 0 700 240" className="h-[300px] w-full" preserveAspectRatio="none">
<defs>
<filter id="axisGlow">
<feGaussianBlur stdDeviation="2.4" result="blur" />
<feMerge>
<feMergeNode in="blur" />
<feMergeNode in="SourceGraphic" />
</feMerge>
</filter>
</defs>

<line x1="0" y1="70" x2="700" y2="70" stroke="rgba(163,230,53,0.22)" strokeDasharray="4 7" />
<line x1="0" y1="140" x2="700" y2="140" stroke="rgba(255,255,255,0.08)" strokeDasharray="4 8" />
<line x1="0" y1="190" x2="700" y2="190" stroke="rgba(239,68,68,0.18)" strokeDasharray="4 8" />

{Array.from({ length: 8 }).map((_, i) => (
<line
key={i}
x1={i * 100}
y1="0"
x2={i * 100}
y2="240"
stroke="rgba(255,255,255,0.04)"
/>
))}

<path
d={chartPath}
fill="none"
stroke="rgba(154,240,75,0.28)"
strokeWidth="9"
strokeLinecap="round"
strokeLinejoin="round"
filter="url(#axisGlow)"
/>
<path
d={chartPath}
fill="none"
stroke="#9AF04B"
strokeWidth="3.4"
strokeLinecap="round"
strokeLinejoin="round"
/>
</svg>
</div>

<div className="mt-5 space-y-1 text-lg text-white/70 sm:text-xl">
<div>75+ = Axis Ready</div>
<div>50–74 = Axis</div>
<div>0–49 = Off Axis</div>
</div>
</section>

<section className="mt-7 rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),rgba(0,0,0,0.96)_42%)] p-5 sm:p-8">
<h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Signal</h2>
<p className="mt-3 text-xl text-white/55">
Signal is detected automatically from the Axis Line.
</p>

<div className="mt-7 rounded-[28px] border border-white/10 bg-black/45 p-6 sm:p-8">
<div className="text-6xl font-light sm:text-7xl">{displaySignal}</div>
<div className="mt-5 text-2xl text-white/55">
Axis reads the current structural condition before action.
</div>
</div>

<div className="mt-7 divide-y divide-white/10 rounded-[28px] border border-white/10 bg-black/25 px-5">
{[
["Clean", "organized signal before action"],
["Shift", "structure moves through space"],
["Drop", "center lowers before force"],
["Float", "sustained control window"],
["Off Axis", "structure breaks from centerline"],
].map(([name, desc]) => (
<div key={name} className="flex items-center justify-between gap-4 py-5">
<div className="text-2xl font-semibold">{name}</div>
<div className="text-right text-lg text-white/55 sm:text-xl">{desc}</div>
</div>
))}
</div>
</section>

<section className="mt-7 rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),rgba(0,0,0,0.96)_42%)] p-5 sm:p-8">
<h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Axis History</h2>
<p className="mt-3 text-xl text-white/55">
Favorable windows captured automatically.
</p>

<div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
<div className="rounded-[28px] border border-white/10 bg-black/40 p-6">
<div className="text-lg uppercase tracking-[0.22em] text-white/45">Ready</div>
<div className="mt-4 text-6xl font-semibold">
{history.filter((item) => item.score >= ENTER_READY_THRESHOLD).length}
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-black/40 p-6">
<div className="text-lg uppercase tracking-[0.22em] text-white/45">Float</div>
<div className="mt-4 text-6xl font-semibold">
{history.filter((item) => item.signal === "Float").length}
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-black/40 p-6">
<div className="text-lg uppercase tracking-[0.22em] text-white/45">Off Axis</div>
<div className="mt-4 text-6xl font-semibold">
{history.filter((item) => item.signal === "Off Axis").length}
</div>
</div>
</div>

<div className="mt-6 space-y-4">
{history.length === 0 ? (
<div className="rounded-[28px] border border-white/10 bg-black/35 p-6 text-xl text-white/55">
Waiting for automatic capture.
</div>
) : null}

{history.map((item) => (
<div
key={item.id}
className="flex items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-black/35 px-6 py-5"
>
<div>
<div className="text-3xl font-semibold">Axis Ready</div>
<div className="mt-2 text-xl text-white/55">
{item.signal} • {item.time}
</div>
</div>

<div className="text-5xl font-semibold">{item.score}</div>
</div>
))}
</div>
</section>
</div>
</main>
);
}