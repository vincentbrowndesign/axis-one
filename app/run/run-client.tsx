"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UiPhase = "permission" | "align" | "live" | "paused";

type AxisState = "Centered" | "Shift" | "Drop" | "Off Axis";

type PushDirection =
| "Center"
| "Forward"
| "Back"
| "Left"
| "Right";

type AxisMoment = {
id: string;
mark: number;
shape: "Settle" | "Float";
state: AxisState;
push: PushDirection;
time: number;
};

type Sample = {
mark: number;
x: number;
y: number;
t: number;
};

const LINE_MAX = 96;
const HISTORY_MAX = 8;

export default function RunClient() {
const [phase, setPhase] = useState<UiPhase>("permission");
const [permissionGranted, setPermissionGranted] = useState(false);

const [axisMark, setAxisMark] = useState(0);
const [axisState, setAxisState] = useState<AxisState>("Centered");
const [push, setPush] = useState<PushDirection>("Center");

const [countdown, setCountdown] = useState<number | null>(null);
const [moments, setMoments] = useState<AxisMoment[]>([]);

const [dot, setDot] = useState({ x: 0, y: 0 });
const [baseline, setBaseline] = useState({ x: 0, y: 0, z: 0 });

const canvasRef = useRef<HTMLCanvasElement | null>(null);
const wrapRef = useRef<HTMLDivElement | null>(null);

const lineRef = useRef<number[]>([]);
const samplesRef = useRef<Sample[]>([]);
const lastCaptureRef = useRef<number>(0);
const alignedWindowRef = useRef<{ x: number[]; y: number[]; z: number[] }>({
x: [],
y: [],
z: [],
});

const glow = useMemo(() => {
if (axisState === "Centered") return "rgba(255,255,255,0.16)";
if (axisState === "Shift") return "rgba(210,255,210,0.16)";
if (axisState === "Drop") return "rgba(255,225,160,0.14)";
return "rgba(255,140,140,0.14)";
}, [axisState]);

async function requestMotionPermission() {
try {
const DME = typeof window !== "undefined" ? (window as any).DeviceMotionEvent : undefined;

if (DME && typeof DME.requestPermission === "function") {
const result = await DME.requestPermission();
if (result !== "granted") return;
}

setPermissionGranted(true);
setPhase("align");
startAlignment();
} catch (error) {
console.error("Motion permission error:", error);
}
}

function startAlignment() {
alignedWindowRef.current = { x: [], y: [], z: [] };
setCountdown(3);
}

function resetSession() {
setAxisMark(0);
setAxisState("Centered");
setPush("Center");
setDot({ x: 0, y: 0 });
setMoments([]);
lineRef.current = [];
samplesRef.current = [];
lastCaptureRef.current = 0;
setPhase(permissionGranted ? "align" : "permission");
if (permissionGranted) startAlignment();
}

function togglePause() {
setPhase((prev) => (prev === "paused" ? "live" : "paused"));
}

useEffect(() => {
if (phase !== "align" || countdown === null) return;
if (countdown === 0) {
const bx = average(alignedWindowRef.current.x);
const by = average(alignedWindowRef.current.y);
const bz = average(alignedWindowRef.current.z);

setBaseline({
x: Number.isFinite(bx) ? bx : 0,
y: Number.isFinite(by) ? by : 0,
z: Number.isFinite(bz) ? bz : 0,
});

setCountdown(null);
setPhase("live");
return;
}

const timer = window.setTimeout(() => {
setCountdown((prev) => (prev === null ? null : prev - 1));
}, 700);

return () => window.clearTimeout(timer);
}, [phase, countdown]);

useEffect(() => {
if (!permissionGranted) return;

function onMotion(event: DeviceMotionEvent) {
const gx = event.accelerationIncludingGravity?.x ?? 0;
const gy = event.accelerationIncludingGravity?.y ?? 0;
const gz = event.accelerationIncludingGravity?.z ?? 0;

if (phase === "align") {
alignedWindowRef.current.x.push(gx);
alignedWindowRef.current.y.push(gy);
alignedWindowRef.current.z.push(gz);

if (alignedWindowRef.current.x.length > 30) alignedWindowRef.current.x.shift();
if (alignedWindowRef.current.y.length > 30) alignedWindowRef.current.y.shift();
if (alignedWindowRef.current.z.length > 30) alignedWindowRef.current.z.shift();
return;
}

if (phase !== "live") return;

const dx = gx - baseline.x;
const dy = gy - baseline.y;
const dz = gz - baseline.z;

const planar = Math.sqrt(dx * dx + dy * dy);
const total = Math.sqrt(dx * dx + dy * dy + dz * dz);

const mark = clamp(Math.round(100 - total * 8.5), 0, 100);
setAxisMark(mark);

const nextState = classifyState(mark, planar, dz);
setAxisState(nextState);

const nextPush = classifyPush(dx, dy);
setPush(nextPush);

const nextDot = {
x: clamp(dx * 14, -92, 92),
y: clamp(dy * 14, -92, 92),
};
setDot(nextDot);

lineRef.current.push(mark);
if (lineRef.current.length > LINE_MAX) lineRef.current.shift();

samplesRef.current.push({
mark,
x: dx,
y: dy,
t: Date.now(),
});
if (samplesRef.current.length > 24) samplesRef.current.shift();

maybeCapture(mark, nextState, nextPush);
drawLine();
}

window.addEventListener("devicemotion", onMotion, true);
return () => window.removeEventListener("devicemotion", onMotion, true);
}, [permissionGranted, phase, baseline]);

useEffect(() => {
drawLine();
}, []);

useEffect(() => {
function handleResize() {
drawLine();
}

window.addEventListener("resize", handleResize);
return () => window.removeEventListener("resize", handleResize);
}, []);

function maybeCapture(mark: number, state: AxisState, nextPush: PushDirection) {
const now = Date.now();
if (now - lastCaptureRef.current < 1400) return;
if (samplesRef.current.length < 8) return;

const recent = samplesRef.current.slice(-8);
const first = recent[0];
const last = recent[recent.length - 1];
const delta = last.mark - first.mark;

let shape: "Settle" | "Float" | null = null;

if (mark >= 88 && delta >= 8) shape = "Settle";
else if (mark >= 82 && Math.abs(delta) <= 4) shape = "Float";

if (!shape) return;

lastCaptureRef.current = now;

const moment: AxisMoment = {
id: `${now}-${mark}`,
mark,
shape,
state,
push: nextPush,
time: now,
};

setMoments((prev) => [moment, ...prev].slice(0, HISTORY_MAX));
}

function drawLine() {
const canvas = canvasRef.current;
const wrap = wrapRef.current;
if (!canvas || !wrap) return;

const dpr = window.devicePixelRatio || 1;
const width = wrap.clientWidth;
const height = 132;

canvas.width = Math.floor(width * dpr);
canvas.height = Math.floor(height * dpr);
canvas.style.width = `${width}px`;
canvas.style.height = `${height}px`;

const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.scale(dpr, dpr);
ctx.clearRect(0, 0, width, height);

// grid
ctx.strokeStyle = "rgba(255,255,255,0.06)";
ctx.lineWidth = 1;

for (let i = 1; i <= 4; i++) {
const y = (height / 5) * i;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}

for (let i = 1; i <= 5; i++) {
const x = (width / 6) * i;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}

const values = lineRef.current;
if (!values.length) return;

ctx.beginPath();
values.forEach((value, i) => {
const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
const y = height - (value / 100) * height;
if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
});

ctx.lineWidth = 4;
ctx.strokeStyle = "rgba(226,244,204,0.98)";
ctx.shadowBlur = 10;
ctx.shadowColor = "rgba(226,244,204,0.38)";
ctx.stroke();

ctx.shadowBlur = 0;
}

const latest = moments[0];

return (
<main
style={{
minHeight: "100vh",
background: "#000",
color: "#fff",
fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
paddingBottom: 40,
}}
>
<div
style={{
maxWidth: 520,
margin: "0 auto",
padding: "18px 18px 120px",
}}
>
<header
style={{
paddingTop: 6,
marginBottom: 18,
}}
>
<div
style={{
fontSize: 12,
letterSpacing: "0.12em",
textTransform: "uppercase",
opacity: 0.55,
marginBottom: 8,
}}
>
Axis
</div>

<div
style={{
display: "flex",
alignItems: "baseline",
justifyContent: "space-between",
gap: 16,
}}
>
<h1
style={{
margin: 0,
fontSize: 42,
lineHeight: 0.96,
letterSpacing: "-0.05em",
fontWeight: 700,
}}
>
Structure before action.
</h1>

<div
style={{
flexShrink: 0,
fontSize: 13,
opacity: 0.68,
textAlign: "right",
}}
>
{phase === "permission" && "Motion required"}
{phase === "align" && "Aligning"}
{phase === "live" && "Live"}
{phase === "paused" && "Paused"}
</div>
</div>
</header>

{phase === "permission" && (
<section
style={{
border: "1px solid rgba(255,255,255,0.08)",
background: "rgba(255,255,255,0.03)",
borderRadius: 24,
padding: 18,
marginBottom: 18,
}}
>
<div
style={{
fontSize: 22,
fontWeight: 600,
marginBottom: 8,
letterSpacing: "-0.03em",
}}
>
Turn your phone into Axis Brain.
</div>
<div
style={{
fontSize: 15,
lineHeight: 1.45,
opacity: 0.7,
marginBottom: 16,
}}
>
Allow motion once. Axis will align, enter live mode, and begin capturing shape moments automatically.
</div>

<button
onClick={requestMotionPermission}
style={primaryButtonStyle}
>
Allow Motion
</button>
</section>
)}

{phase !== "permission" && (
<>
<section
style={{
borderRadius: 32,
padding: "22px 18px 18px",
background: glow,
border: "1px solid rgba(255,255,255,0.07)",
boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
overflow: "hidden",
}}
>
<div
style={{
display: "flex",
alignItems: "center",
justifyContent: "space-between",
marginBottom: 12,
}}
>
<div>
<div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>
Axis Scope
</div>
<div
style={{
fontSize: 28,
fontWeight: 700,
letterSpacing: "-0.04em",
}}
>
{phase === "align" ? "Hold Still" : axisState}
</div>
</div>

<div
style={{
textAlign: "right",
}}
>
<div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>
Axis Mark
</div>
<div
style={{
fontSize: 34,
fontWeight: 700,
letterSpacing: "-0.05em",
}}
>
{phase === "align" ? "—" : axisMark}
</div>
</div>
</div>

<div
style={{
fontSize: 13,
opacity: 0.62,
marginBottom: 14,
display: "flex",
justifyContent: "space-between",
gap: 12,
}}
>
<span>Push {phase === "align" ? "Center" : push}</span>
<span>
{phase === "align"
? countdown === 0 || countdown === null
? "Aligned"
: `${countdown}`
: phase === "paused"
? "Paused"
: "Live"}
</span>
</div>

<div
style={{
position: "relative",
aspectRatio: "1 / 1",
width: "100%",
maxWidth: 390,
margin: "0 auto 18px",
}}
>
<TargetRings />

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 18,
height: 18,
borderRadius: 999,
background: "rgba(255,255,255,0.75)",
transform: "translate(-50%, -50%)",
}}
/>

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 56,
height: 56,
borderRadius: 999,
background: "#fff",
boxShadow: "0 0 32px rgba(255,255,255,0.16)",
transform: `translate(calc(-50% + ${dot.x}px), calc(-50% + ${dot.y}px))`,
transition: phase === "live" ? "transform 80ms linear" : "transform 180ms ease",
}}
/>
</div>

<div
ref={wrapRef}
style={{
paddingTop: 6,
borderTop: "1px solid rgba(255,255,255,0.06)",
}}
>
<div
style={{
display: "flex",
alignItems: "baseline",
justifyContent: "space-between",
gap: 12,
marginBottom: 10,
}}
>
<div>
<div style={{ fontSize: 12, opacity: 0.5, marginBottom: 2 }}>
Axis Line
</div>
<div
style={{
fontSize: 15,
fontWeight: 600,
letterSpacing: "-0.02em",
}}
>
Signal history of structure over time.
</div>
</div>

<div style={{ fontSize: 13, opacity: 0.6 }}>
{phase === "live" ? "Live" : phase === "paused" ? "Paused" : "Aligning"}
</div>
</div>

<canvas
ref={canvasRef}
style={{
width: "100%",
height: 132,
display: "block",
borderRadius: 18,
background: "rgba(255,255,255,0.01)",
}}
/>
</div>
</section>

<section
style={{
marginTop: 14,
display: "flex",
gap: 10,
}}
>
<button
onClick={togglePause}
style={{
...secondaryButtonStyle,
flex: 1,
}}
>
{phase === "paused" ? "Resume" : "Pause"}
</button>

<button
onClick={resetSession}
style={{
...secondaryButtonStyle,
flex: 1,
}}
>
Reset
</button>
</section>

{latest && (
<section
style={{
marginTop: 18,
border: "1px solid rgba(255,255,255,0.07)",
background: "rgba(255,255,255,0.03)",
borderRadius: 24,
padding: 16,
}}
>
<div style={{ fontSize: 12, opacity: 0.5, marginBottom: 8 }}>
Latest Capture
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "1.1fr 0.9fr",
gap: 12,
alignItems: "center",
}}
>
<div>
<div
style={{
fontSize: 28,
fontWeight: 700,
letterSpacing: "-0.04em",
marginBottom: 4,
}}
>
{latest.shape}
</div>
<div style={{ fontSize: 14, opacity: 0.7 }}>
{latest.state} • Push {latest.push}
</div>
</div>

<div style={{ textAlign: "right" }}>
<div
style={{
fontSize: 28,
fontWeight: 700,
letterSpacing: "-0.05em",
}}
>
{latest.mark}
</div>
<div style={{ fontSize: 13, opacity: 0.6 }}>
{formatTime(latest.time)}
</div>
</div>
</div>
</section>
)}

<section
style={{
marginTop: 18,
}}
>
<div
style={{
fontSize: 12,
opacity: 0.5,
marginBottom: 10,
textTransform: "uppercase",
letterSpacing: "0.12em",
}}
>
Axis History
</div>

<div
style={{
display: "grid",
gap: 10,
}}
>
{moments.length === 0 && (
<div
style={{
border: "1px solid rgba(255,255,255,0.07)",
background: "rgba(255,255,255,0.02)",
borderRadius: 20,
padding: 16,
fontSize: 14,
opacity: 0.62,
}}
>
Captured Axis Shape moments will appear here.
</div>
)}

{moments.map((moment) => (
<div
key={moment.id}
style={{
border: "1px solid rgba(255,255,255,0.07)",
background: "rgba(255,255,255,0.025)",
borderRadius: 20,
padding: 14,
display: "grid",
gridTemplateColumns: "1fr auto",
gap: 12,
alignItems: "center",
}}
>
<div>
<div
style={{
fontSize: 18,
fontWeight: 600,
letterSpacing: "-0.03em",
marginBottom: 4,
}}
>
{moment.shape}
</div>
<div style={{ fontSize: 14, opacity: 0.72 }}>
{moment.state} • Push {moment.push}
</div>
</div>

<div style={{ textAlign: "right" }}>
<div
style={{
fontSize: 22,
fontWeight: 700,
letterSpacing: "-0.05em",
}}
>
{moment.mark}
</div>
<div style={{ fontSize: 12, opacity: 0.56 }}>
{formatTime(moment.time)}
</div>
</div>
</div>
))}
</div>
</section>
</>
)}
</div>
</main>
);
}

function TargetRings() {
return (
<svg
viewBox="0 0 400 400"
style={{
width: "100%",
height: "100%",
display: "block",
}}
>
<circle cx="200" cy="200" r="154" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
<circle cx="200" cy="200" r="104" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
<circle cx="200" cy="200" r="58" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
<line x1="200" y1="18" x2="200" y2="382" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
<line x1="18" y1="200" x2="382" y2="200" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
</svg>
);
}

const primaryButtonStyle: React.CSSProperties = {
width: "100%",
border: "none",
borderRadius: 18,
padding: "16px 18px",
background: "#fff",
color: "#000",
fontSize: 16,
fontWeight: 700,
letterSpacing: "-0.02em",
};

const secondaryButtonStyle: React.CSSProperties = {
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 16,
padding: "14px 16px",
background: "rgba(255,255,255,0.04)",
color: "#fff",
fontSize: 15,
fontWeight: 600,
letterSpacing: "-0.02em",
};

function classifyState(mark: number, planar: number, dz: number): AxisState {
if (mark >= 90 && planar <= 1.4) return "Centered";
if (mark >= 80 && planar <= 2.6) return "Shift";
if (mark >= 68 || dz < -1.2) return "Drop";
return "Off Axis";
}

function classifyPush(dx: number, dy: number): PushDirection {
const absX = Math.abs(dx);
const absY = Math.abs(dy);

if (absX < 0.45 && absY < 0.45) return "Center";
if (absY >= absX) return dy > 0 ? "Forward" : "Back";
return dx > 0 ? "Right" : "Left";
}

function average(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function formatTime(time: number) {
return new Date(time).toLocaleTimeString([], {
hour: "numeric",
minute: "2-digit",
second: "2-digit",
});
}