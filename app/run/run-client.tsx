"use client";

import { useEffect, useRef, useState } from "react";

type AxisState =
| "Centered"
| "Shift"
| "Drop"
| "Off Axis";

type AxisMoment = {
mark: number;
state: AxisState;
time: number;
};

export default function RunClient() {

const [permission, setPermission] = useState(false);
const [aligned, setAligned] = useState(false);
const [live, setLive] = useState(false);

const [axisMark, setAxisMark] = useState(0);
const [state, setState] = useState<AxisState>("Centered");

const [history, setHistory] = useState<AxisMoment[]>([]);

const lineRef = useRef<number[]>([]);
const canvasRef = useRef<HTMLCanvasElement>(null);

let lastCapture = useRef<number>(0);

// request motion permission
async function enableMotion() {
try {
if (
typeof DeviceMotionEvent !== "undefined" &&
typeof (DeviceMotionEvent as any).requestPermission === "function"
) {
const res = await (DeviceMotionEvent as any).requestPermission();
if (res === "granted") {
setPermission(true);
}
} else {
setPermission(true);
}
} catch (e) {
console.log(e);
}
}

// alignment phase
function startAlign() {
setAligned(false);

setTimeout(() => {
setAligned(true);
setLive(true);
}, 2000);
}

// reset session
function resetSession() {
setHistory([]);
lineRef.current = [];
setAxisMark(0);
}

// motion listener
useEffect(() => {
if (!permission) return;

function motion(e: DeviceMotionEvent) {
const x = e.accelerationIncludingGravity?.x || 0;
const y = e.accelerationIncludingGravity?.y || 0;
const z = e.accelerationIncludingGravity?.z || 0;

const mag = Math.sqrt(x * x + y * y + z * z);
const mark = Math.max(0, 100 - Math.abs(mag - 9.8) * 12);

const rounded = Math.round(mark);
setAxisMark(rounded);

lineRef.current.push(rounded);
if (lineRef.current.length > 120) {
lineRef.current.shift();
}

let newState: AxisState = "Centered";

if (rounded < 75) newState = "Off Axis";
else if (rounded < 82) newState = "Drop";
else if (rounded < 90) newState = "Shift";
else newState = "Centered";

setState(newState);

const now = Date.now();

if (rounded > 82 && now - lastCapture.current > 1200) {
lastCapture.current = now;

setHistory((prev) => [
{
mark: rounded,
state: newState,
time: now,
},
...prev.slice(0, 10),
]);
}

drawLine();
}

window.addEventListener("devicemotion", motion);

return () => window.removeEventListener("devicemotion", motion);
}, [permission]);

// draw axis line
function drawLine() {
const canvas = canvasRef.current;
if (!canvas) return;

const ctx = canvas.getContext("2d");
if (!ctx) return;

const width = canvas.width;
const height = canvas.height;

ctx.clearRect(0, 0, width, height);

ctx.beginPath();

lineRef.current.forEach((v, i) => {
const x = (i / 120) * width;
const y = height - (v / 100) * height;

if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
});

ctx.lineWidth = 3;
ctx.strokeStyle = "#9effa1";
ctx.stroke();
}

useEffect(() => {
drawLine();
}, []);

return (
<main className="axis-root">

<header className="axis-header">
<div className="axis-status">
{permission ? "Live" : "Motion Off"}
</div>
<h1>Structure before action</h1>
</header>

{!permission && (
<button className="axis-primary" onClick={enableMotion}>
Allow Motion
</button>
)}

{permission && !aligned && (
<button className="axis-primary" onClick={startAlign}>
Align Axis
</button>
)}

{aligned && (
<>
<section className="axis-scope">

<div className="axis-target">
<div className="axis-dot" />
</div>

<div className="axis-read">
{axisMark}
</div>

<div className="axis-state">
{state}
</div>

</section>

<canvas
ref={canvasRef}
width={350}
height={120}
className="axis-line"
/>

<section className="axis-history">

<h3>Captured Moments</h3>

{history.map((m, i) => (
<div key={i} className="axis-card">
<div className="axis-card-state">
{m.state}
</div>

<div className="axis-card-mark">
Mark {m.mark}
</div>

<div className="axis-card-time">
{new Date(m.time).toLocaleTimeString()}
</div>
</div>
))}

</section>

<div className="axis-controls">
<button onClick={resetSession}>
Reset
</button>
</div>

</>
)}
</main>
);
}