"use client";

import { useEffect, useState } from "react";
import { evaluateAxis } from "@/lib/axis/axisMovementModel";

export default function AxisLiveClient() {
const [tilt, setTilt] = useState(0);
const [rotation, setRotation] = useState(0);
const [state, setState] = useState("drop");
const [stability, setStability] = useState(0);
const [started, setStarted] = useState(false);

async function startMeasurement() {
try {
const DeviceOrientationEventAny = DeviceOrientationEvent as any;

if (DeviceOrientationEventAny?.requestPermission) {
const response = await DeviceOrientationEventAny.requestPermission();

if (response !== "granted") {
alert("Motion permission denied");
return;
}
}

setStarted(true);
} catch {
setStarted(true);
}
}

useEffect(() => {
if (!started) return;

function handleOrientation(e: DeviceOrientationEvent) {
const beta = e.beta ?? 0;
const gamma = e.gamma ?? 0;

const reading = evaluateAxis({
tilt: Math.abs(beta / 10),
rotation: Math.abs(gamma * 2),
});

setTilt(reading.tilt);
setRotation(reading.rotation);
setState(reading.state);
setStability(reading.stability);
}

window.addEventListener("deviceorientation", handleOrientation, true);

return () => {
window.removeEventListener("deviceorientation", handleOrientation);
};
}, [started]);

return (
<main className="min-h-screen bg-black px-6 py-10 text-white">
<div className="mx-auto max-w-4xl">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/45">
Axis Live
</div>

<h1 className="mt-2 text-3xl font-semibold tracking-[0.18em]">
HUMAN ALIGNMENT
</h1>

{!started && (
<button
onClick={startMeasurement}
className="mt-8 rounded-2xl border border-white/20 px-6 py-3 text-lg"
>
Start Measurement
</button>
)}

<div className="mt-8 grid gap-4 sm:grid-cols-2">
<Card label="State" value={state.toUpperCase()} />
<Card label="Stability" value={Math.round(stability)} />
<Card label="Tilt" value={Math.round(tilt)} />
<Card label="Rotation" value={Math.round(rotation)} />
</div>
</div>
</main>
);
}

function Card({ label, value }: { label: string; value: string | number }) {
return (
<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
<div className="text-[10px] uppercase tracking-[0.3em] text-white/45">
{label}
</div>

<div className="mt-3 text-3xl font-semibold tracking-[0.16em]">
{value}
</div>
</div>
);
}