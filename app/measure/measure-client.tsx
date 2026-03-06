"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type FormState = "Out of Control" | "In Rhythm" | "In Control";
type SignalState = "Chaotic" | "Reactive" | "Clean";
type EnergyState = "Off" | "On" | "High";

type Reading = {
form: FormState;
signal: SignalState;
energy: EnergyState;
transitions: number;
windows: number;
charge: number;
};

const CHARGE_KEY = "axis_charge_v1";

function getPyronStage(charge: number) {
if (charge < 50) return "Seed";
if (charge < 150) return "Core";
if (charge < 400) return "Pulse";
if (charge < 1000) return "Nova";
return "Titan";
}

function getPyronSize(stage: string) {
if (stage === "Seed") return 50;
if (stage === "Core") return 70;
if (stage === "Pulse") return 100;
if (stage === "Nova") return 140;
return 180;
}

function average(values: number[]) {
if (!values.length) return 0;
return values.reduce((a, b) => a + b, 0) / values.length;
}

function smoothSeries(values: number[], windowSize = 4) {
if (!values.length) return [];
const out: number[] = [];

for (let i = 0; i < values.length; i++) {
const start = Math.max(0, i - windowSize + 1);
const slice = values.slice(start, i + 1);
out.push(average(slice));
}

return out;
}

export default function MeasureClient() {
const [running, setRunning] = useState(false);
const [isCalibrating, setIsCalibrating] = useState(false);
const [time, setTime] = useState(0);
const [storedCharge, setStoredCharge] = useState(0);

const [reading, setReading] = useState<Reading>({
form: "In Control",
signal: "Clean",
energy: "Off",
transitions: 0,
windows: 0,
charge: 0,
});

const samplesRef = useRef<number[]>([]);
const baselineSamplesRef = useRef<number[]>([]);
const baselineRef = useRef<number>(0);
const startTimeRef = useRef<number>(0);
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
const motionEnabledRef = useRef(false);

useEffect(() => {
const raw = localStorage.getItem(CHARGE_KEY);
setStoredCharge(raw ? Number(raw) || 0 : 0);

return () => {
window.removeEventListener("devicemotion", handleMotion);
if (timerRef.current) clearInterval(timerRef.current);
};
}, []);

function saveCharge(next: number) {
localStorage.setItem(CHARGE_KEY, String(next));
setStoredCharge(next);
}

function resetCharge() {
localStorage.removeItem(CHARGE_KEY);
setStoredCharge(0);
setReading({
form: "In Control",
signal: "Clean",
energy: "Off",
transitions: 0,
windows: 0,
charge: 0,
});
samplesRef.current = [];
baselineSamplesRef.current = [];
baselineRef.current = 0;
setTime(0);
setRunning(false);
setIsCalibrating(false);

if (timerRef.current) {
clearInterval(timerRef.current);
timerRef.current = null;
}
}

function magnitude(x: number, y: number, z: number) {
return Math.sqrt(x * x + y * y + z * z);
}

function handleMotion(e: DeviceMotionEvent) {
const ax = e.acceleration?.x ?? 0;
const ay = e.acceleration?.y ?? 0;
const az = e.acceleration?.z ?? 0;

const gx = e.rotationRate?.alpha ?? 0;
const gy = e.rotationRate?.beta ?? 0;
const gz = e.rotationRate?.gamma ?? 0;

const accel = magnitude(ax, ay, az);
const gyro = magnitude(gx, gy, gz) / 50;
const rawMotion = accel + gyro;

if (isCalibrating) {
baselineSamplesRef.current.push(rawMotion);
if (baselineSamplesRef.current.length > 80) {
baselineSamplesRef.current.shift();
}
return;
}

const adjusted = Math.max(0, rawMotion - baselineRef.current);
const deadZone = 0.08;
const motion = adjusted < deadZone ? 0 : adjusted;

samplesRef.current.push(motion);

if (samplesRef.current.length > 120) {
samplesRef.current.shift();
}
}

async function enableMotion() {
if (
typeof DeviceMotionEvent !== "undefined" &&
typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
.requestPermission === "function"
) {
const res = await (
DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
).requestPermission();

if (res !== "granted") return false;
}

if (!motionEnabledRef.current) {
window.addEventListener("devicemotion", handleMotion);
motionEnabledRef.current = true;
}

return true;
}

function computeReading() {
const rawValues = samplesRef.current;
const values = smoothSeries(rawValues, 4);

if (values.length < 8) {
setReading({
form: "In Control",
signal: "Clean",
energy: "Off",
transitions: 0,
windows: 0,
charge: 0,
});
return;
}

const total = values.reduce((a, b) => a + b, 0);
const avg = total / values.length;

let signal: SignalState = "Clean";
let energy: EnergyState = "Off";
let form: FormState = "In Control";

if (avg < 0.12) {
signal = "Clean";
energy = "Off";
form = "In Control";
} else if (avg < 0.55) {
signal = "Reactive";
energy = "On";
form = "In Rhythm";
} else {
signal = "Chaotic";
energy = "High";
form = "Out of Control";
}

const transitions = values.filter((v) => v > 0.8).length;
const windows = Math.max(0, Math.floor(time / 5));
const charge = running ? Math.max(1, Math.floor(total * 0.35)) : 0;

setReading({
form,
signal,
energy,
transitions,
windows,
charge,
});

if (running && charge > 0) {
const raw = localStorage.getItem(CHARGE_KEY);
const current = raw ? Number(raw) || 0 : 0;
const next = current + charge;
saveCharge(next);
}
}

async function start() {
const ok = await enableMotion();
if (!ok) return;

samplesRef.current = [];
baselineSamplesRef.current = [];
baselineRef.current = 0;
setTime(0);
setRunning(false);
setIsCalibrating(true);

setTimeout(() => {
baselineRef.current = average(baselineSamplesRef.current);
samplesRef.current = [];
startTimeRef.current = Date.now();
setTime(0);
setIsCalibrating(false);
setRunning(true);

if (timerRef.current) clearInterval(timerRef.current);

timerRef.current = setInterval(() => {
const t = Math.floor((Date.now() - startTimeRef.current) / 1000);
setTime(t);
computeReading();
}, 1000);
}, 1500);
}

function stop() {
setRunning(false);

if (timerRef.current) {
clearInterval(timerRef.current);
timerRef.current = null;
}

computeReading();
}

const batteryFill = useMemo(() => {
return Math.min(100, Math.round((storedCharge / 2000) * 100));
}, [storedCharge]);

const linePoints = useMemo(() => {
const values = smoothSeries(samplesRef.current, 4);
const width = 100;
const height = 44;

if (!values.length) return "";

const max = Math.max(...values, 1);

return values
.map((v, i) => {
const x = (i / Math.max(values.length - 1, 1)) * width;
const y = height - (v / max) * height;
return `${x},${y}`;
})
.join(" ");
}, [time, running, reading.charge]);

const pyronStage = getPyronStage(storedCharge);
const pyronSize = getPyronSize(pyronStage);

return (
<div
style={{
display: "grid",
gap: 18,
}}
>
<section
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 28,
background: "rgba(255,255,255,0.02)",
padding: 22,
}}
>
<div
style={{
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 16,
marginBottom: 18,
}}
>
<div>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
Machine
</div>
<div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.04em" }}>
{isCalibrating ? "Calibrating" : running ? "Live" : "Ready"}
</div>
</div>

<div style={{ minWidth: 92, textAlign: "right" }}>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
Time
</div>
<div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.04em" }}>
{time}s
</div>
</div>
</div>

<div style={{ marginBottom: 18 }}>
<div
style={{
display: "flex",
justifyContent: "space-between",
alignItems: "center",
marginBottom: 10,
}}
>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>Stored Charge</div>
<div style={{ fontSize: 16, fontWeight: 700 }}>{storedCharge}</div>
</div>

<div
style={{
width: "100%",
height: 30,
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.12)",
background: "#0a0a0a",
padding: 4,
boxSizing: "border-box",
}}
>
<div
style={{
width: `${batteryFill}%`,
height: "100%",
borderRadius: 999,
background:
"linear-gradient(90deg, rgba(0,212,166,0.55) 0%, rgba(0,212,166,1) 100%)",
boxShadow: "0 0 24px rgba(0,212,166,0.35)",
transition: "width 200ms ease",
}}
/>
</div>
</div>

<div style={{ marginBottom: 18 }}>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>
Axis Line
</div>

<div
style={{
width: "100%",
height: 96,
borderRadius: 20,
border: "1px solid rgba(255,255,255,0.08)",
background: "rgba(255,255,255,0.02)",
padding: 10,
boxSizing: "border-box",
}}
>
<svg viewBox="0 0 100 44" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
<polyline
fill="none"
stroke="rgba(0,212,166,1)"
strokeWidth="1.6"
points={linePoints || "0,44 100,44"}
/>
</svg>
</div>
</div>

<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
{!running && !isCalibrating ? (
<button
onClick={start}
style={{
border: "1px solid rgba(0,212,166,0.35)",
background: "rgba(0,212,166,0.12)",
color: "#f5f7fa",
borderRadius: 18,
padding: "16px 26px",
fontSize: 18,
fontWeight: 700,
cursor: "pointer",
}}
>
On
</button>
) : (
<button
onClick={stop}
disabled={isCalibrating}
style={{
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.06)",
color: "#f5f7fa",
borderRadius: 18,
padding: "16px 26px",
fontSize: 18,
fontWeight: 700,
cursor: isCalibrating ? "not-allowed" : "pointer",
opacity: isCalibrating ? 0.5 : 1,
}}
>
Off
</button>
)}

<button
onClick={resetCharge}
style={{
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.04)",
color: "#f5f7fa",
borderRadius: 18,
padding: "16px 26px",
fontSize: 18,
fontWeight: 700,
cursor: "pointer",
}}
>
Reset
</button>
</div>
</section>

<section
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 28,
background: "rgba(255,255,255,0.02)",
padding: 22,
textAlign: "center",
}}
>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>
Pyron
</div>

<div style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>{pyronStage}</div>

<div
style={{
width: pyronSize,
height: pyronSize,
margin: "20px auto",
borderRadius: "50%",
background: "radial-gradient(circle, #00ffcc 0%, #007777 70%, #001111 100%)",
boxShadow: "0 0 80px rgba(0,255,200,0.55)",
transition: "all .4s ease",
}}
/>

<div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>
Generated from Axis Charge
</div>
</section>

<section
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 28,
background: "rgba(255,255,255,0.02)",
padding: 22,
}}
>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>
Output
</div>

<div
style={{
fontSize: 26,
fontWeight: 700,
letterSpacing: "-0.04em",
marginBottom: 18,
}}
>
Reading
</div>

<div style={{ display: "grid", gap: 12 }}>
<MetricRow label="Form" value={reading.form} />
<MetricRow label="Signal" value={reading.signal} />
<MetricRow label="Energy" value={reading.energy} />
<MetricRow label="Transitions" value={String(reading.transitions)} />
<MetricRow label="Windows" value={String(reading.windows)} />
<MetricRow label="Charge" value={`+${reading.charge}`} />
<MetricRow label="Stored Charge" value={String(storedCharge)} />
</div>
</section>
</div>
);
}

function MetricRow({ label, value }: { label: string; value: string }) {
return (
<div
style={{
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 16,
border: "1px solid rgba(255,255,255,0.06)",
background: "rgba(255,255,255,0.02)",
borderRadius: 18,
padding: "16px 18px",
}}
>
<div style={{ color: "rgba(255,255,255,0.62)", fontSize: 15 }}>{label}</div>
<div
style={{
color: "#ffffff",
fontSize: 17,
fontWeight: 700,
textAlign: "right",
}}
>
{value}
</div>
</div>
);
}