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

const STORAGE_KEY = "axis_sessions_v1";
const CHARGE_KEY = "axis_stored_charge_v1";

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

const liveGlow = useMemo(() => {
if (!isLive) return "rgba(255,255,255,0.08)";
return "rgba(0,212,166,0.35)";
}, [isLive]);

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
boxShadow: `0 0 0 1px rgba(255,255,255,0.01) inset, 0 0 32px ${liveGlow}`,
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
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.6)",
marginBottom: 6,
}}
>
Machine
</div>
<div
style={{
fontSize: 30,
fontWeight: 700,
letterSpacing: "-0.04em",
}}
>
{isLive ? "Live" : "Ready"}
</div>
</div>

<div
style={{
minWidth: 92,
textAlign: "right",
}}
>
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.6)",
marginBottom: 6,
}}
>
Time
</div>
<div
style={{
fontSize: 28,
fontWeight: 700,
letterSpacing: "-0.04em",
}}
>
{formatElapsed(elapsed)}
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
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.6)",
}}
>
Stored Charge
</div>
<div
style={{
fontSize: 16,
fontWeight: 700,
}}
>
{storedCharge}
</div>
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

<div
style={{
display: "flex",
gap: 12,
flexWrap: "wrap",
}}
>
{!isLive ? (
<button
onClick={startLive}
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
onClick={stopLive}
style={{
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.06)",
color: "#f5f7fa",
borderRadius: 18,
padding: "16px 26px",
fontSize: 18,
fontWeight: 700,
cursor: "pointer",
}}
>
Off
</button>
)}
</div>

{error ? (
<div
style={{
marginTop: 16,
fontSize: 15,
color: "#ff8b8b",
}}
>
{error}
</div>
) : null}
</section>

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
fontSize: 14,
color: "rgba(255,255,255,0.6)",
marginBottom: 8,
}}
>
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

{!reading ? (
<div
style={{
color: "rgba(255,255,255,0.55)",
fontSize: 16,
}}
>
Turn Axis on. Go live. Turn it off. The reading appears here.
</div>
) : (
<div
style={{
display: "grid",
gap: 12,
}}
>
<MetricRow label="Form" value={reading.form} />
<MetricRow label="Signal" value={reading.signal} />
<MetricRow label="Energy" value={reading.energy} />
<MetricRow label="Transitions" value={String(reading.transitions)} />
<MetricRow label="Windows" value={String(reading.windows)} />
<MetricRow label="Charge" value={`+${reading.charge}`} />
<MetricRow label="Stored Charge" value={String(reading.storedCharge)} />
</div>
)}
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
<div
style={{
color: "rgba(255,255,255,0.62)",
fontSize: 15,
}}
>
{label}
</div>
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