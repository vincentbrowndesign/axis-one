"use client";

import { useEffect, useState } from "react";
import { evaluateAxis } from "@/lib/axis/axisMovementModel";

export default function AxisLiveClient() {
const [tilt, setTilt] = useState(0);
const [rotation, setRotation] = useState(0);
const [state, setState] = useState("drop");
const [stability, setStability] = useState(0);

useEffect(() => {
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
window.removeEventListener("deviceorientation", handleOrientation, true);
};
}, []);

return (
<main className="min-h-screen bg-black px-6 py-10 text-white">
<div className="mx-auto max-w-4xl">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/45">
Axis Live
</div>

<h1 className="mt-2 text-3xl font-semibold tracking-[0.18em]">
HUMAN ALIGNMENT
</h1>

<div className="mt-8 grid gap-4 sm:grid-cols-2">
<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
<div className="text-[10px] uppercase tracking-[0.3em] text-white/45">
State
</div>
<div className="mt-3 text-3xl font-semibold tracking-[0.16em]">
{String(state).toUpperCase()}
</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
<div className="text-[10px] uppercase tracking-[0.3em] text-white/45">
Stability
</div>
<div className="mt-3 text-3xl font-semibold tracking-[0.16em]">
{Math.round(stability)}
</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
<div className="text-[10px] uppercase tracking-[0.3em] text-white/45">
Tilt
</div>
<div className="mt-3 text-3xl font-semibold tracking-[0.16em]">
{Math.round(tilt)}
</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
<div className="text-[10px] uppercase tracking-[0.3em] text-white/45">
Rotation
</div>
<div className="mt-3 text-3xl font-semibold tracking-[0.16em]">
{Math.round(rotation)}
</div>
</div>
</div>
</div>
</main>
);
}