"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type FormState = "Out of Control" | "In Rhythm" | "In Control";
type SignalState = "Chaotic" | "Reactive" | "Clean";
type EnergyState = "Off" | "On" | "High";

type MotionSample = {
t: number;
motion: number;
};

type Reading = {
form: FormState;
signal: SignalState;
energy: EnergyState;
transitions: number;
windows: number;
charge: number;
storedCharge: number;
startedAt: number;
endedAt: number;
};

const STORAGE_KEY = "axis_sessions";
const CHARGE_KEY = "axis_charge";

function magnitude(x: number, y: number, z: number) {
return Math.sqrt(x * x + y * y + z * z);
}

function variance(values: number[]) {
if (!values.length) return 0;
const mean = values.reduce((a, b) => a + b, 0) / values.length;
return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

function getStoredCharge() {
if (typeof window === "undefined") return 0;
const raw = window.localStorage.getItem(CHARGE_KEY);
return raw ? Number(raw) || 0 : 0;
}

function setStoredChargeValue(value: number) {
if (typeof window === "undefined") return;
window.localStorage.setItem(CHARGE_KEY, String(value));
}

function saveSession(reading: Reading) {
if (typeof window === "undefined") return;
const raw = window.localStorage.getItem(STORAGE_KEY);
const sessions = raw ? JSON.parse(raw) : [];
sessions.unshift(reading);
window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 100)));
}

function computeReading(samples: MotionSample[], started: number, ended: number): Reading {
const motions = samples.map((s) => s.motion);
const totalMotion = motions.reduce((a, b) => a + b, 0);
const avgMotion = motions.length ? totalMotion / motions.length : 0;

let transitions = 0;
let windows = 0;

const threshold = Math.max(2, avgMotion * 1.4);
let prevAbove = false;
let lastWindow = -9999;

for (const s of samples) {
const above = s.motion > threshold;

if (above && !prevAbove) {
transitions += 1;

if (s.t - lastWindow > 400) {
windows += 1;
}

lastWindow = s.t;
}

prevAbove = above;
}

const motionVar = variance(motions);

let energy: EnergyState = "Off";
if (totalMotion > 2000) energy = "High";
else if (totalMotion > 500) energy = "On";

let form: FormState = "In Rhythm";
if (motionVar > 15) form = "Out of Control";
else if (motionVar < 5 && transitions > 3) form = "In Control";

let signal: SignalState = "Reactive";
if (windows === 0) signal = "Chaotic";
else if (motionVar < 6 && windows > 2) signal = "Clean";

const base = totalMotion * 0.02 + transitions * 0.8 + windows * 0.6;

const formMult =
form === "Out of Control" ? 0.9 : form === "In Rhythm" ? 1 : 1.1;

const signalMult =
signal === "Chaotic" ? 0.9 : signal === "Reactive" ? 1 : 1.1;

const charge = Math.max(1, Math.round(base * formMult * signalMult));
const storedCharge = getStoredCharge() + charge;

return {
form,
signal,
energy,
transitions,
windows,
charge,
storedCharge,
startedAt: started,
endedAt: ended,
};
}

export default function MeasureClient() {
const [isLive, setIsLive] = useState(false);
const [reading, setReading] = useState<Reading | null>(null);
const [storedCharge, setStoredCharge] = useState(0);
const [elapsed, setElapsed] = useState(0);
const [error, setError] = useState("");

const samplesRef = useRef<MotionSample[]>([]);
const startedRef = useRef<number>(0);
const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

useEffect(() => {
setStoredCharge(getStoredCharge());
}, []);

useEffect(() => {
if (!isLive) return;

const timer = window.setInterval(() => {
setElapsed(Date.now() - startedRef.current);
}, 100);

return () => {
window.clearInterval(timer);
};
}, [isLive]);

async function startLive() {
try {
setError("");
setReading(null);
samplesRef.current = [];
startedRef.current = Date.now();
setElapsed(0);

if (
typeof DeviceMotionEvent !== "undefined" &&
typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
.requestPermission === "function"
) {
const result = await (
DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
).requestPermission();

if (result !== "granted") {
setError("Motion permission was not granted.");
return;
}
}

motionHandlerRef.current = (e: DeviceMotionEvent) => {
const ax = e.accelerationIncludingGravity?.x ?? 0;
const ay = e.accelerationIncludingGravity?.y ?? 0;
const az = e.accelerationIncludingGravity?.z ?? 0;

const gx = e.rotationRate?.alpha ?? 0;
const gy = e.rotationRate?.beta ?? 0;
const gz = e.rotationRate?.gamma ?? 0;

const aMag = magnitude(ax, ay, az);
const gMag = magnitude(gx, gy, gz) / 50;
const motion = aMag + gMag;

samplesRef.current.push({
t: Date.now() - startedRef.current,
motion,
});
};

window.addEventListener("devicemotion", motionHandlerRef.current, true);
setIsLive(true);
} catch (err) {
console.error(err);
setError("Unable to start motion capture.");
}
}

function stopLive() {
if (motionHandlerRef.current) {
window.removeEventListener("devicemotion", motionHandlerRef.current, true);
}

const ended = Date.now();
const nextReading = computeReading(samplesRef.current, startedRef.current, ended);

setStoredChargeValue(nextReading.storedCharge);
saveSession(nextReading);

setStoredCharge(nextReading.storedCharge);
setReading(nextReading);
setIsLive(false);
}

function formatElapsed(ms: number) {
const totalSeconds = Math.floor(ms / 1000);
const mm = Math.floor(totalSeconds / 60)
.toString()
.padStart(2, "0");
const ss = (totalSeconds % 60).toString().padStart(2, "0");
return `${mm}:${ss}`;
}

const batteryFill = useMemo(() => {
return Math.min(100, Math.round((storedCharge / 500) * 100));
}, [storedCharge]);

return (
<div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 480 }}>
<h1>Axis Measure</h1>

<div style={{ marginBottom: 24 }}>
<h3>Stored Charge</h3>
<div
style={{
width: 220,
height: 22,
border: "1px solid black",
position: "relative",
marginBottom: 8,
}}
>
<div
style={{
width: `${batteryFill}%`,
height: "100%",
background: "limegreen",
}}
/>
</div>
<p>{storedCharge}</p>
</div>

{!isLive && (
<button onClick={startLive} style={{ padding: "12px 18px" }}>
On
</button>
)}

{isLive && (
<div style={{ marginBottom: 24 }}>
<p>LIVE</p>
<p>{formatElapsed(elapsed)}</p>
<button onClick={stopLive} style={{ padding: "12px 18px" }}>
Off
</button>
</div>
)}

{reading && (
<div style={{ marginTop: 24 }}>
<h2>Reading</h2>

<p>Form: {reading.form}</p>
<p>Signal: {reading.signal}</p>
<p>Energy: {reading.energy}</p>
<p>Transitions: {reading.transitions}</p>
<p>Windows: {reading.windows}</p>
<p>Charge +{reading.charge}</p>
<p>Stored Charge {reading.storedCharge}</p>
</div>
)}

{error && <p style={{ color: "red", marginTop: 16 }}>{error}</p>}
</div>
);
}