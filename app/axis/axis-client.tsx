"use client";

import React, { useEffect, useRef, useState } from "react";

type Phase = "permission" | "align" | "live" | "paused";
type AxisState = "Centered" | "Shift" | "Drop" | "Off Axis";
type Push = "Center" | "Forward" | "Back" | "Left" | "Right";
type Shape = "Settle" | "Float";

type Moment = {
id: string;
mark: number;
shape: Shape;
state: AxisState;
push: Push;
time: number;
};

type Sample = {
mark: number;
dx: number;
dy: number;
dz: number;
t: number;
};

const LINE_MAX = 100;
const MOMENT_MAX = 8;
const ALIGN_SAMPLE_MAX = 30;
const SAMPLE_WINDOW_MAX = 24;
const CAPTURE_COOLDOWN_MS = 2200;
const DUPLICATE_WINDOW_MS = 3200;

export default function AxisClient() {
const [phase, setPhase] = useState<Phase>("permission");
const [mark, setMark] = useState(0);
const [axisState, setAxisState] = useState<AxisState>("Centered");
const [push, setPush] = useState<Push>("Center");
const [countdown, setCountdown] = useState<number | null>(null);
const [moments, setMoments] = useState<Moment[]>([]);
const [dot, setDot] = useState({ x: 0, y: 0 });
const [flash, setFlash] = useState(false);

const canvasRef = useRef<HTMLCanvasElement | null>(null);
const lineWrapRef = useRef<HTMLDivElement | null>(null);

const baselineRef = useRef({ x: 0, y: 0, z: 0 });
const alignSamplesRef = useRef<{ x: number[]; y: number[]; z: number[] }>({
x: [],
y: [],
z: [],
});
const lineRef = useRef<number[]>([]);
const sampleRef = useRef<Sample[]>([]);
const lastCaptureRef = useRef(0);
const flashTimeoutRef = useRef<number | null>(null);

async function allowMotion() {
try {
const DME =
typeof window !== "undefined"
? (window as Window & {
DeviceMotionEvent?: {
requestPermission?: () => Promise<"granted" | "denied">;
};
}).DeviceMotionEvent
: undefined;

if (DME && typeof DME.requestPermission === "function") {
const result = await DME.requestPermission();
if (result !== "granted") return;
}

beginAlign();
} catch (error) {
console.error("Motion permission failed:", error);
}
}

function beginAlign() {
alignSamplesRef.current = { x: [], y: [], z: [] };
setCountdown(3);
setPhase("align");
}

function togglePause() {
setPhase((prev) => (prev === "paused" ? "live" : "paused"));
}

function resetSession() {
setMark(0);
setAxisState("Centered");
setPush("Center");
setDot({ x: 0, y: 0 });
setMoments([]);
setFlash(false);
lineRef.current = [];
sampleRef.current = [];
lastCaptureRef.current = 0;
beginAlign();
}

useEffect(() => {
if (phase !== "align" || countdown === null) return;

if (countdown === 0) {
baselineRef.current = {
x: avg(alignSamplesRef.current.x),
y: avg(alignSamplesRef.current.y),
z: avg(alignSamplesRef.current.z),
};
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
function onMotion(event: DeviceMotionEvent) {
const gx = event.accelerationIncludingGravity?.x ?? 0;
const gy = event.accelerationIncludingGravity?.y ?? 0;
const gz = event.accelerationIncludingGravity?.z ?? 0;

if (phase === "align") {
pushLimited(alignSamplesRef.current.x, gx, ALIGN_SAMPLE_MAX);
pushLimited(alignSamplesRef.current.y, gy, ALIGN_SAMPLE_MAX);
pushLimited(alignSamplesRef.current.z, gz, ALIGN_SAMPLE_MAX);
return;
}

if (phase !== "live") return;

const dx = gx - baselineRef.current.x;
const dy = gy - baselineRef.current.y;
const dz = gz - baselineRef.current.z;

const planar = Math.sqrt(dx * dx + dy * dy);
const total = Math.sqrt(dx * dx + dy * dy + dz * dz);

const nextMark = clamp(Math.round(100 - total * 8.5), 0, 100);
const nextState = classifyState(nextMark, planar, dz);
const nextPush = classifyPush(dx, dy);

setMark(nextMark);
setAxisState(nextState);
setPush(nextPush);
setDot({
x: clamp(dx * 13, -82, 82),
y: clamp(dy * 13, -82, 82),
});

pushLimited(lineRef.current, nextMark, LINE_MAX);
pushLimited(
sampleRef.current,
{
mark: nextMark,
dx,
dy,
dz,
t: Date.now(),
},
SAMPLE_WINDOW_MAX
);

maybeCapture(nextMark, nextState, nextPush);
drawLine();
}

window.addEventListener("devicemotion", onMotion, true);
return () => window.removeEventListener("devicemotion", onMotion, true);
}, [phase, moments]);

useEffect(() => {
drawLine();
}, []);

useEffect(() => {
function onResize() {
drawLine();
}

window.addEventListener("resize", onResize);
return () => window.removeEventListener("resize", onResize);
}, []);

useEffect(() => {
return () => {
if (flashTimeoutRef.current) {
window.clearTimeout(flashTimeoutRef.current);
}
};
}, []);

function triggerFlash() {
setFlash(true);
if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
flashTimeoutRef.current = window.setTimeout(() => {
setFlash(false);
}, 380);
}

function maybeCapture(nextMark: number, nextState: AxisState, nextPush: Push) {
const now = Date.now();
if (now - lastCaptureRef.current < CAPTURE_COOLDOWN_MS) return;
if (sampleRef.current.length < 8) return;

const recent = sampleRef.current.slice(-8);
const first = recent[0];
const last = recent[recent.length - 1];
const delta = last.mark - first.mark;

let shape: Shape | null = null;

if (nextMark >= 88 && delta >= 8) shape = "Settle";
else if (nextMark >= 82 && Math.abs(delta) <= 4) shape = "Float";

if (!shape) return;

const latest = moments[0];
if (
latest &&
latest.shape === shape &&
latest.state === nextState &&
latest.push === nextPush &&
now - latest.time < DUPLICATE_WINDOW_MS
) {
return;
}

lastCaptureRef.current = now;
triggerFlash();

const nextMoment: Moment = {
id: `${now}-${nextMark}`,
mark: nextMark,
shape,
state: nextState,
push: nextPush,
time: now,
};

setMoments((prev) => [nextMoment, ...prev].slice(0, MOMENT_MAX));
}

function drawLine() {
const canvas = canvasRef.current;
const wrap = lineWrapRef.current;
if (!canvas || !wrap) return;

const dpr = window.devicePixelRatio || 1;
const width = wrap.clientWidth;
const height = 124;

canvas.width = Math.floor(width * dpr);
canvas.height = Math.floor(height * dpr);
canvas.style.width = `${width}px`;
canvas.style.height = `${height}px`;

const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.setTransform(1, 0, 0, 1, 0, 0);
ctx.scale(dpr, dpr);
ctx.clearRect(0, 0, width, height);

ctx.strokeStyle = "rgba(255,255,255,0.06)";
ctx.lineWidth = 1;

for (let i = 1; i <= 3; i += 1) {
const y = (height / 4) * i;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}

for (let i = 1; i <= 5; i += 1) {
const x = (width / 6) * i;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}

const values = lineRef.current;
if (values.length === 0) return;

ctx.beginPath();
values.forEach((value, index) => {
const x =
values.length === 1 ? 0 : (index / (values.length - 1)) * width;
const y = height - (value / 100) * height;

if (index === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
});

ctx.lineWidth = 4;
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.strokeStyle = "rgba(236,248,213,0.98)";
ctx.shadowBlur = 12;
ctx.shadowColor = "rgba(226,244,204,0.34)";
ctx.stroke();
ctx.shadowBlur = 0;
}

const latest = moments[0];
const stateTitle = phase === "align" ? "Hold Still" : axisState;
const statusText =
phase === "permission"
? "Motion required"
: phase === "align"
? "Aligning"
: phase === "paused"
? "Paused"
: "Live";

const glow =
axisState === "Centered"
? "rgba(255,255,255,0.035)"
: axisState === "Shift"
? "rgba(166,224,167,0.065)"
: axisState === "Drop"
? "rgba(226,185,118,0.06)"
: "rgba(213,101,101,0.06)";

const liveDotSize = phase === "align" ? 50 : clamp(34 + mark * 0.26, 42, 60);
const scopeScale = flash ? 1.035 : 1;

return (
<main
style={{
minHeight: "100vh",
background: "#000",
color: "#fff",
fontFamily:
"Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
}}
>
<div
style={{
maxWidth: 520,
margin: "0 auto",
paddingTop: "max(18px, env(safe-area-inset-top))",
paddingRight: 18,
paddingLeft: 18,
paddingBottom: "max(140px, calc(env(safe-area-inset-bottom) + 92px))",
}}
>
<header style={{ paddingTop: 2, marginBottom: 14 }}>
<div
style={{
fontSize: 12,
letterSpacing: "0.14em",
textTransform: "uppercase",
opacity: 0.5,
marginBottom: 10,
}}
>
Axis
</div>

<div
style={{
display: "flex",
alignItems: "flex-end",
justifyContent: "space-between",
gap: 16,
}}
>
<div style={{ minWidth: 0 }}>
<h1
style={{
margin: 0,
fontSize: 46,
lineHeight: 0.96,
letterSpacing: "-0.06em",
fontWeight: 700,
}}
>
{phase === "permission" ? "Axis Instrument" : stateTitle}
</h1>

{phase !== "permission" && (
<div
style={{
marginTop: 10,
fontSize: 17,
opacity: 0.72,
letterSpacing: "-0.02em",
}}
>
Push {phase === "align" ? "Center" : push} • {statusText}
</div>
)}
</div>

<div
style={{
flexShrink: 0,
textAlign: "right",
marginBottom: 4,
}}
>
<div
style={{
fontSize: 12,
opacity: 0.5,
marginBottom: 4,
textTransform: "uppercase",
letterSpacing: "0.12em",
}}
>
Mark
</div>
<div
style={{
fontSize: 28,
fontWeight: 700,
letterSpacing: "-0.05em",
opacity: phase === "permission" ? 0.42 : 1,
}}
>
{phase === "permission" ? "—" : phase === "align" ? "—" : mark}
</div>
</div>
</div>
</header>

{phase === "permission" && (
<section
style={{
border: "1px solid rgba(255,255,255,0.08)",
background: "rgba(255,255,255,0.03)",
borderRadius: 26,
padding: 18,
marginTop: 12,
}}
>
<div
style={{
fontSize: 21,
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
lineHeight: 1.5,
opacity: 0.7,
marginBottom: 16,
}}
>
Allow motion once. Then Axis aligns, goes live, and begins
capturing structure moments automatically.
</div>

<button onClick={allowMotion} style={primaryButtonStyle}>
Allow Motion
</button>
</section>
)}

{phase !== "permission" && (
<>
<section
style={{
borderRadius: 32,
padding: "18px 16px 14px",
background: glow,
border: "1px solid rgba(255,255,255,0.07)",
boxShadow: flash
? "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(255,255,255,0.02), 0 0 36px rgba(220,255,220,0.05)"
: "inset 0 1px 0 rgba(255,255,255,0.04)",
overflow: "hidden",
transition: "box-shadow 180ms ease, background 180ms ease",
}}
>
<div
style={{
display: "flex",
alignItems: "flex-start",
justifyContent: "space-between",
marginBottom: 8,
gap: 12,
}}
>
<div>
<div style={{ fontSize: 12, opacity: 0.48, marginBottom: 6 }}>
Axis Scope
</div>

<div
style={{
fontSize: 18,
opacity: 0.78,
letterSpacing: "-0.02em",
}}
>
{phase === "align" ? "Hold Still" : `Push ${push}`}
</div>
</div>

<div style={{ textAlign: "right" }}>
<div style={{ fontSize: 12, opacity: 0.48, marginBottom: 6 }}>
{statusText}
</div>
<div
style={{
fontSize: 18,
opacity: 0.78,
letterSpacing: "-0.02em",
}}
>
{phase === "align"
? countdown === 0 || countdown === null
? "Aligned"
: `${countdown}`
: "Live"}
</div>
</div>
</div>

<div
style={{
position: "relative",
aspectRatio: "1 / 1",
width: "100%",
maxWidth: 330,
margin: "0 auto 10px",
transform: `scale(${scopeScale})`,
transition: "transform 180ms ease",
}}
>
<TargetRings />

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 16,
height: 16,
borderRadius: 999,
background: "rgba(255,255,255,0.68)",
transform: "translate(-50%, -50%)",
}}
/>

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: liveDotSize,
height: liveDotSize,
borderRadius: 999,
background: "#fff",
boxShadow: flash
? "0 0 46px rgba(255,255,255,0.26)"
: "0 0 24px rgba(255,255,255,0.14)",
transform: `translate(calc(-50% + ${dot.x}px), calc(-50% + ${dot.y}px))`,
transition:
phase === "live"
? "transform 80ms linear, width 120ms ease, height 120ms ease, box-shadow 150ms ease"
: "transform 180ms ease, width 120ms ease, height 120ms ease, box-shadow 150ms ease",
}}
/>
</div>

<div
ref={lineWrapRef}
style={{
paddingTop: 12,
borderTop: "1px solid rgba(255,255,255,0.06)",
}}
>
<div
style={{
display: "flex",
alignItems: "baseline",
justifyContent: "space-between",
gap: 12,
marginBottom: 8,
}}
>
<div>
<div style={{ fontSize: 12, opacity: 0.48, marginBottom: 3 }}>
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

<div style={{ fontSize: 13, opacity: 0.58 }}>{statusText}</div>
</div>

<canvas
ref={canvasRef}
style={{
width: "100%",
height: 124,
display: "block",
borderRadius: 18,
background: "rgba(255,255,255,0.012)",
}}
/>
</div>
</section>

<section
style={{
marginTop: 12,
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
marginTop: 16,
border: "1px solid rgba(255,255,255,0.07)",
background: "rgba(255,255,255,0.022)",
borderRadius: 24,
padding: 16,
}}
>
<div style={{ fontSize: 12, opacity: 0.48, marginBottom: 10 }}>
Latest Capture
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "1fr auto",
gap: 14,
alignItems: "center",
}}
>
<div>
<div
style={{
fontSize: 30,
fontWeight: 700,
letterSpacing: "-0.05em",
marginBottom: 4,
}}
>
{latest.shape}
</div>

<div style={{ fontSize: 15, opacity: 0.68 }}>
{latest.state} • Push {latest.push}
</div>
</div>

<div style={{ textAlign: "right" }}>
<div
style={{
fontSize: 30,
fontWeight: 700,
letterSpacing: "-0.05em",
lineHeight: 0.98,
}}
>
{latest.mark}
</div>

<div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>
{formatTime(latest.time)}
</div>
</div>
</div>
</section>
)}

<section style={{ marginTop: 16 }}>
<div
style={{
fontSize: 12,
opacity: 0.48,
marginBottom: 10,
textTransform: "uppercase",
letterSpacing: "0.16em",
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

{moments.map((moment, index) => (
<div
key={moment.id}
style={{
border: "1px solid rgba(255,255,255,0.065)",
background:
index === 0
? "rgba(255,255,255,0.028)"
: "rgba(255,255,255,0.02)",
borderRadius: 22,
padding: "13px 14px",
display: "grid",
gridTemplateColumns: "1fr auto",
gap: 12,
alignItems: "center",
}}
>
<div>
<div
style={{
fontSize: 17,
fontWeight: 650,
letterSpacing: "-0.03em",
marginBottom: 3,
}}
>
{moment.shape}
</div>

<div style={{ fontSize: 14, opacity: 0.66 }}>
{moment.state} • Push {moment.push}
</div>
</div>

<div style={{ textAlign: "right" }}>
<div
style={{
fontSize: 20,
fontWeight: 700,
letterSpacing: "-0.05em",
lineHeight: 1,
}}
>
{moment.mark}
</div>

<div style={{ fontSize: 12, opacity: 0.46, marginTop: 5 }}>
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
style={{ width: "100%", height: "100%", display: "block" }}
>
<circle
cx="200"
cy="200"
r="154"
fill="none"
stroke="rgba(255,255,255,0.09)"
strokeWidth="3"
/>
<circle
cx="200"
cy="200"
r="104"
fill="none"
stroke="rgba(255,255,255,0.09)"
strokeWidth="3"
/>
<circle
cx="200"
cy="200"
r="58"
fill="none"
stroke="rgba(255,255,255,0.09)"
strokeWidth="3"
/>
<line
x1="200"
y1="18"
x2="200"
y2="382"
stroke="rgba(255,255,255,0.08)"
strokeWidth="2"
/>
<line
x1="18"
y1="200"
x2="382"
y2="200"
stroke="rgba(255,255,255,0.08)"
strokeWidth="2"
/>
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
borderRadius: 18,
padding: "15px 16px",
background: "rgba(255,255,255,0.02)",
color: "#fff",
fontSize: 15,
fontWeight: 650,
letterSpacing: "-0.02em",
};

function classifyState(mark: number, planar: number, dz: number): AxisState {
if (mark >= 90 && planar <= 1.4) return "Centered";
if (mark >= 80 && planar <= 2.6) return "Shift";
if (mark >= 68 || dz < -1.2) return "Drop";
return "Off Axis";
}

function classifyPush(dx: number, dy: number): Push {
const absX = Math.abs(dx);
const absY = Math.abs(dy);

if (absX < 0.45 && absY < 0.45) return "Center";
if (absY >= absX) return dy > 0 ? "Forward" : "Back";
return dx > 0 ? "Right" : "Left";
}

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function avg(values: number[]) {
if (values.length === 0) return 0;
return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pushLimited<T>(arr: T[], value: T, max: number) {
arr.push(value);
if (arr.length > max) arr.shift();
}

function formatTime(time: number) {
return new Date(time).toLocaleTimeString([], {
hour: "numeric",
minute: "2-digit",
second: "2-digit",
});
}