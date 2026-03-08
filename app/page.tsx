"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AxisState = "READY" | "ALMOST" | "OFF_AXIS";
type AxisShape = "Rise" | "Load" | "Break" | "Drop" | "Float" | "Unknown";

type SamplePoint = {
t: number;
value: number;
};

type CapturedMoment = {
id: number;
score: number;
state: AxisState;
shape: AxisShape;
ts: string;
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[]) {
if (values.length < 2) return 0;
const mean = average(values);
const variance =
values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
return Math.sqrt(variance);
}

function getAxisState(score: number): AxisState {
if (score >= 75) return "READY";
if (score >= 50) return "ALMOST";
return "OFF_AXIS";
}

function detectAxisShape(points: SamplePoint[]): AxisShape {
if (points.length < 12) return "Unknown";

const values = points.map((p) => p.value);
const third = Math.floor(values.length / 3);

const first = values.slice(0, third);
const middle = values.slice(third, third * 2);
const last = values.slice(third * 2);

const a = average(first);
const b = average(middle);
const c = average(last);

const min = Math.min(...values);
const max = Math.max(...values);
const range = max - min;

if (range < 6) return "Float";
if (a < b && b < c) return "Rise";
if (a < b && Math.abs(c - b) <= 3) return "Load";
if (a > b && c > b + 6) return "Break";
if (a <= b && c < b - 6) return "Drop";
if (Math.abs(a - b) < 4 && c > b + 6) return "Float";

return "Unknown";
}

function formatStateLabel(state: AxisState) {
if (state === "READY") return "Axis Ready";
if (state === "ALMOST") return "Almost";
return "Off Axis";
}

function getStateClass(state: AxisState) {
if (state === "READY") return "state ready";
if (state === "ALMOST") return "state almost";
return "state off";
}

function getShapeExplanation(shape: AxisShape) {
switch (shape) {
case "Rise":
return "Body stabilized upward into release.";
case "Load":
return "Body loaded into action with control.";
case "Break":
return "Quick instability followed by re-control.";
case "Drop":
return "Control dipped before recovery or rushed release.";
case "Float":
return "Sustained control window.";
default:
return "Not enough signal yet.";
}
}

export default function Page() {
const [permissionState, setPermissionState] = useState<
"idle" | "granted" | "denied" | "unsupported"
>("idle");

const [isListening, setIsListening] = useState(false);
const [mode, setMode] = useState<"live" | "demo">("live");

const [stabilityScore, setStabilityScore] = useState(0);
const [axisState, setAxisState] = useState<AxisState>("OFF_AXIS");
const [axisShape, setAxisShape] = useState<AxisShape>("Unknown");
const [rawMotion, setRawMotion] = useState(0);
const [timeline, setTimeline] = useState<SamplePoint[]>([]);
const [capturedMoments, setCapturedMoments] = useState<CapturedMoment[]>([]);

const motionBufferRef = useRef<number[]>([]);
const sampleIdRef = useRef(0);
const demoFrameRef = useRef<number | null>(null);

const requestMotionPermission = async () => {
try {
if (typeof window === "undefined") return;

const DeviceMotionEventWithPermission = DeviceMotionEvent as typeof DeviceMotionEvent & {
requestPermission?: () => Promise<string>;
};

if (typeof DeviceMotionEventWithPermission.requestPermission === "function") {
const result = await DeviceMotionEventWithPermission.requestPermission();
if (result === "granted") {
setPermissionState("granted");
} else {
setPermissionState("denied");
}
} else {
setPermissionState("granted");
}
} catch {
setPermissionState("denied");
}
};

useEffect(() => {
if (typeof window === "undefined") return;
if (!("DeviceMotionEvent" in window)) {
setPermissionState("unsupported");
}
}, []);

useEffect(() => {
if (mode !== "live" || permissionState !== "granted" || !isListening) return;

const onMotion = (event: DeviceMotionEvent) => {
const ax = event.accelerationIncludingGravity?.x ?? 0;
const ay = event.accelerationIncludingGravity?.y ?? 0;
const az = event.accelerationIncludingGravity?.z ?? 0;

const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
const normalizedNoise = clamp(Math.abs(magnitude - 9.8) * 8, 0, 100);

pushSignal(normalizedNoise);
};

window.addEventListener("devicemotion", onMotion);

return () => {
window.removeEventListener("devicemotion", onMotion);
};
}, [permissionState, isListening, mode]);

useEffect(() => {
if (mode !== "demo" || !isListening) return;

const start = performance.now();

const tick = (now: number) => {
const t = (now - start) / 1000;

const wave =
28 +
Math.sin(t * 1.2) * 10 +
Math.sin(t * 3.1) * 5 +
(Math.sin(t * 7) > 0.9 ? 18 : 0);

const simulatedNoise = clamp(wave, 0, 100);
pushSignal(simulatedNoise);

demoFrameRef.current = requestAnimationFrame(tick);
};

demoFrameRef.current = requestAnimationFrame(tick);

return () => {
if (demoFrameRef.current !== null) {
cancelAnimationFrame(demoFrameRef.current);
}
};
}, [mode, isListening]);

function pushSignal(noiseValue: number) {
setRawMotion(noiseValue);

motionBufferRef.current.push(noiseValue);
if (motionBufferRef.current.length > 20) {
motionBufferRef.current.shift();
}

const variability = stdDev(motionBufferRef.current);
const newScore = clamp(
Math.round(100 - variability * 8 - noiseValue * 0.35),
0,
100
);
const newState = getAxisState(newScore);

setStabilityScore(newScore);
setAxisState(newState);

const nextPoint: SamplePoint = {
t: sampleIdRef.current++,
value: newScore,
};

setTimeline((prev) => {
const next = [...prev, nextPoint].slice(-60);
const detectedShape = detectAxisShape(next.slice(-24));
setAxisShape(detectedShape);
return next;
});
}

function handleStart() {
setIsListening(true);
}

function handleStop() {
setIsListening(false);
}

function handleCaptureMoment() {
const entry: CapturedMoment = {
id: Date.now(),
score: stabilityScore,
state: axisState,
shape: axisShape,
ts: new Date().toLocaleTimeString(),
};

setCapturedMoments((prev) => [entry, ...prev].slice(0, 8));
}

function handleReset() {
setStabilityScore(0);
setAxisState("OFF_AXIS");
setAxisShape("Unknown");
setRawMotion(0);
setTimeline([]);
setCapturedMoments([]);
motionBufferRef.current = [];
sampleIdRef.current = 0;
}

const chartPoints = useMemo(() => {
if (!timeline.length) return "";
const width = 100;
const height = 36;

return timeline
.map((p, index) => {
const x = (index / Math.max(timeline.length - 1, 1)) * width;
const y = height - (p.value / 100) * height;
return `${x},${y}`;
})
.join(" ");
}, [timeline]);

const readyCount = capturedMoments.filter((m) => m.state === "READY").length;
const almostCount = capturedMoments.filter((m) => m.state === "ALMOST").length;
const offCount = capturedMoments.filter((m) => m.state === "OFF_AXIS").length;

return (
<main className="page">
<section className="hero">
<div className="eyebrow">AXIS</div>
<h1>Structure before action.</h1>
<p className="hero-text">
Axis highlights favorable structure. It detects when the body is stable,
aligned, and ready before the shot, pass, drive, or catch.
</p>

<div className="mode-row">
<button
className={mode === "live" ? "chip active" : "chip"}
onClick={() => setMode("live")}
type="button"
>
Live Motion
</button>

<button
className={mode === "demo" ? "chip active" : "chip"}
onClick={() => setMode("demo")}
type="button"
>
Demo Signal
</button>
</div>

<div className="controls">
{mode === "live" &&
permissionState !== "granted" &&
permissionState !== "unsupported" && (
<button className="primary" onClick={requestMotionPermission} type="button">
Enable Motion
</button>
)}

<button className="primary" onClick={handleStart} type="button">
Start
</button>

<button className="secondary" onClick={handleStop} type="button">
Stop
</button>

<button className="secondary" onClick={handleCaptureMoment} type="button">
Capture Moment
</button>

<button className="secondary" onClick={handleReset} type="button">
Reset
</button>
</div>

<div className="status-row">
<div className={getStateClass(axisState)}>
<span className="dot" />
{formatStateLabel(axisState)}
</div>

<div className="mini-stat">
<span className="mini-label">Stability</span>
<strong>{stabilityScore}</strong>
</div>

<div className="mini-stat">
<span className="mini-label">Axis Shape</span>
<strong>{axisShape}</strong>
</div>

<div className="mini-stat">
<span className="mini-label">Signal Noise</span>
<strong>{rawMotion.toFixed(1)}</strong>
</div>
</div>
</section>

<section className="grid">
<div className="card">
<div className="card-header">
<h2>Axis Timeline</h2>
<p>The score rises as structure becomes controlled.</p>
</div>

<div className="chart-wrap">
<svg viewBox="0 0 100 36" className="chart" preserveAspectRatio="none">
<line x1="0" y1="9" x2="100" y2="9" className="threshold-line ready-line" />
<line x1="0" y1="18" x2="100" y2="18" className="threshold-line almost-line" />
{chartPoints ? (
<polyline fill="none" points={chartPoints} className="chart-line" />
) : null}
</svg>
</div>

<div className="legend">
<span>75+ = Axis Ready</span>
<span>50–74 = Almost</span>
<span>0–49 = Off Axis</span>
</div>
</div>

<div className="card">
<div className="card-header">
<h2>Axis Shape</h2>
<p>{getShapeExplanation(axisShape)}</p>
</div>

<div className="shape-box">
<div className="shape-name">{axisShape}</div>
<div className="shape-copy">
Axis Shape is the body’s stability pattern before action.
</div>
</div>

<div className="shape-list">
<div>
<strong>Rise</strong>
<span>balanced into release</span>
</div>
<div>
<strong>Load</strong>
<span>stabilize then attack</span>
</div>
<div>
<strong>Break</strong>
<span>shift then recover</span>
</div>
<div>
<strong>Drop</strong>
<span>loss of control before action</span>
</div>
<div>
<strong>Float</strong>
<span>sustained control window</span>
</div>
</div>
</div>

<div className="card">
<div className="card-header">
<h2>Session Summary</h2>
<p>Capture good windows as they happen.</p>
</div>

<div className="summary-stats">
<div className="summary-item">
<span>Ready</span>
<strong>{readyCount}</strong>
</div>
<div className="summary-item">
<span>Almost</span>
<strong>{almostCount}</strong>
</div>
<div className="summary-item">
<span>Off Axis</span>
<strong>{offCount}</strong>
</div>
</div>

<div className="moments">
{capturedMoments.length === 0 ? (
<div className="empty">No moments captured yet.</div>
) : (
capturedMoments.map((moment) => (
<div key={moment.id} className="moment-row">
<div>
<div className="moment-title">{formatStateLabel(moment.state)}</div>
<div className="moment-sub">
{moment.shape} • {moment.ts}
</div>
</div>
<div className="moment-score">{moment.score}</div>
</div>
))
)}
</div>
</div>
</section>
</main>
);
}