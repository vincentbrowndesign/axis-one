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

const BANK_KEY = "axis_shared_charge_v1";

function getPyronStage(charge: number) {
if (charge < 50) return "Seed";
if (charge < 150) return "Core";
if (charge < 400) return "Pulse";
if (charge < 1000) return "Nova";
return "Titan";
}

function getPyronSize(stage: string) {
if (stage === "Seed") return 54;
if (stage === "Core") return 72;
if (stage === "Pulse") return 96;
if (stage === "Nova") return 122;
return 146;
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

function magnitude(x: number, y: number, z: number) {
return Math.sqrt(x * x + y * y + z * z);
}

export default function MeasureClient() {
const [running, setRunning] = useState(false);
const [isCalibrating, setIsCalibrating] = useState(false);
const [time, setTime] = useState(0);
const [bank, setBank] = useState(0);

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
const baselineRef = useRef(0);
const startTimeRef = useRef(0);
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
const motionEnabledRef = useRef(false);

useEffect(() => {
const raw = localStorage.getItem(BANK_KEY);
setBank(raw ? Number(raw) || 0 : 0);

return () => {
window.removeEventListener("devicemotion", handleMotion);
if (timerRef.current) clearInterval(timerRef.current);
};
}, []);

function writeBank(next: number) {
localStorage.setItem(BANK_KEY, String(next));
setBank(next);
window.dispatchEvent(
new CustomEvent("axis-charge-updated", {
detail: next,
})
);
}

function resetAll() {
localStorage.removeItem(BANK_KEY);
setBank(0);

window.dispatchEvent(
new CustomEvent("axis-charge-updated", {
detail: 0,
})
);

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

function computeReading(currentTime: number) {
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
const windows = Math.max(0, Math.floor(currentTime / 5));
const sessionCharge = running ? Math.max(1, Math.floor(total * 0.35)) : 0;

setReading({
form,
signal,
energy,
transitions,
windows,
charge: sessionCharge,
});

if (running && sessionCharge > 0) {
const raw = localStorage.getItem(BANK_KEY);
const currentBank = raw ? Number(raw) || 0 : 0;
writeBank(currentBank + sessionCharge);
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
const nextTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
setTime(nextTime);
computeReading(nextTime);
}, 1000);
}, 1500);
}

function stop() {
setRunning(false);

if (timerRef.current) {
clearInterval(timerRef.current);
timerRef.current = null;
}

computeReading(time);
}

const bankFill = useMemo(() => {
return Math.min(100, Math.round((bank / 2000) * 100));
}, [bank]);

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

const pyronStage = getPyronStage(bank);
const pyronSize = getPyronSize(pyronStage);

return (
<div
style={{
border: "1px solid rgba(255,255,255,0.08)",
background: "#050505",
borderRadius: 30,
padding: 22,
display: "grid",
gap: 24,
}}
>
<div
style={{
display: "flex",
alignItems: "flex-start",
justifyContent: "space-between",
gap: 16,
flexWrap: "wrap",
}}
>
<div>
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.58)",
marginBottom: 6,
}}
>
Axis
</div>
<div
style={{
fontSize: 34,
fontWeight: 700,
letterSpacing: "-0.05em",
}}
>
{isCalibrating ? "Calibrating" : running ? "Live" : "Off"}
</div>
</div>

<div
style={{
display: "flex",
gap: 12,
flexWrap: "wrap",
}}
>
{!running && !isCalibrating ? (
<button onClick={start} style={machineButton(true)}>
Start
</button>
) : (
<button onClick={stop} disabled={isCalibrating} style={machineButton(false, isCalibrating)}>
Off
</button>
)}

<button onClick={resetAll} style={secondaryButton()}>
Reset
</button>
</div>
</div>

<div style={{ display: "grid", gap: 10 }}>
<div
style={{
display: "flex",
justifyContent: "space-between",
gap: 12,
alignItems: "center",
}}
>
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.58)",
}}
>
Bank
</div>

<div
style={{
fontSize: 18,
fontWeight: 700,
}}
>
{bank}
</div>
</div>

<div
style={{
width: "100%",
height: 24,
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.1)",
background: "#0a0a0a",
padding: 3,
boxSizing: "border-box",
}}
>
<div
style={{
width: `${bankFill}%`,
height: "100%",
borderRadius: 999,
background:
"linear-gradient(90deg, rgba(0,212,166,0.55) 0%, rgba(0,212,166,1) 100%)",
boxShadow: "0 0 22px rgba(0,212,166,0.35)",
transition: "width 200ms ease",
}}
/>
</div>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 22,
padding: 14,
background: "rgba(255,255,255,0.015)",
}}
>
<div
style={{
fontSize: 13,
color: "rgba(255,255,255,0.55)",
marginBottom: 10,
}}
>
Axis Line
</div>

<div style={{ width: "100%", height: 120 }}>
<svg
viewBox="0 0 100 44"
preserveAspectRatio="none"
style={{ width: "100%", height: "100%" }}
>
<polyline
fill="none"
stroke="rgba(0,212,166,1)"
strokeWidth="1.8"
points={linePoints || "0,44 100,44"}
/>
</svg>
</div>
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "1fr auto",
gap: 18,
alignItems: "center",
borderTop: "1px solid rgba(255,255,255,0.06)",
borderBottom: "1px solid rgba(255,255,255,0.06)",
padding: "20px 0",
}}
>
<div>
<div
style={{
fontSize: 13,
color: "rgba(255,255,255,0.55)",
marginBottom: 6,
}}
>
Pyron
</div>
<div
style={{
fontSize: 22,
fontWeight: 700,
marginBottom: 6,
}}
>
{pyronStage}
</div>
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.58)",
}}
>
Live from Bank
</div>
</div>

<div
style={{
width: pyronSize,
height: pyronSize,
borderRadius: "50%",
background: "radial-gradient(circle, #9fe8ff 0%, #4a8cff 30%, #12306f 70%, #08111f 100%)",
boxShadow: "0 0 70px rgba(74,140,255,0.4)",
transition: "all .35s ease",
}}
/>
</div>

<div
style={{
display: "grid",
gap: 12,
}}
>
<Readout label="Form" value={reading.form} />
<Readout label="Signal" value={reading.signal} />
<Readout label="Energy" value={reading.energy} />
<Readout label="Transitions" value={String(reading.transitions)} />
<Readout label="Windows" value={String(reading.windows)} />
<Readout label="Session Charge" value={`+${reading.charge}`} />
<Readout label="Time" value={`${time}s`} />
</div>
</div>
);
}

function machineButton(primary: boolean, disabled = false): React.CSSProperties {
return {
border: primary
? "1px solid rgba(0,212,166,0.35)"
: "1px solid rgba(255,255,255,0.12)",
background: primary
? "rgba(0,212,166,0.12)"
: "rgba(255,255,255,0.05)",
color: "#f5f7fa",
borderRadius: 18,
padding: "14px 24px",
fontSize: 18,
fontWeight: 700,
cursor: disabled ? "not-allowed" : "pointer",
opacity: disabled ? 0.5 : 1,
};
}

function secondaryButton(): React.CSSProperties {
return {
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.04)",
color: "#f5f7fa",
borderRadius: 18,
padding: "14px 24px",
fontSize: 18,
fontWeight: 700,
cursor: "pointer",
};
}

function Readout({ label, value }: { label: string; value: string }) {
return (
<div
style={{
display: "grid",
gridTemplateColumns: "120px 1fr",
gap: 16,
alignItems: "center",
borderBottom: "1px solid rgba(255,255,255,0.05)",
paddingBottom: 10,
}}
>
<div
style={{
fontSize: 13,
color: "rgba(255,255,255,0.55)",
}}
>
{label}
</div>

<div
style={{
fontSize: 18,
fontWeight: 700,
textAlign: "right",
color: "#fff",
}}
>
{value}
</div>
</div>
);
}