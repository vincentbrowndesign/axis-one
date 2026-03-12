"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateAxis } from "@/lib/axis/axisMovementModel";

type AxisState = "aligned" | "shift" | "drop" | "recover";

const STATE_LABELS: Record<AxisState, string> = {
aligned: "ALIGNED",
shift: "SHIFT",
drop: "DROP",
recover: "RECOVER",
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function round(value: number) {
return Math.round(value);
}

export default function AxisLiveClient() {
const [started, setStarted] = useState(false);
const [permissionDenied, setPermissionDenied] = useState(false);

const [rawBeta, setRawBeta] = useState(0);
const [rawGamma, setRawGamma] = useState(0);

const [baselineBeta, setBaselineBeta] = useState<number | null>(null);
const [baselineGamma, setBaselineGamma] = useState<number | null>(null);

const [smoothTilt, setSmoothTilt] = useState(0);
const [smoothRotation, setSmoothRotation] = useState(0);

const [heldState, setHeldState] = useState<AxisState>("aligned");
const [heldStability, setHeldStability] = useState(100);

const candidateRef = useRef<AxisState>("aligned");
const candidateCountRef = useRef(0);

async function startMeasurement() {
try {
const DeviceOrientationEventAny = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

if (typeof DeviceOrientationEventAny?.requestPermission === "function") {
const response = await DeviceOrientationEventAny.requestPermission();

if (response !== "granted") {
setPermissionDenied(true);
return;
}
}

setPermissionDenied(false);
setStarted(true);
} catch {
setStarted(true);
}
}

function calibrateNow() {
setBaselineBeta(rawBeta);
setBaselineGamma(rawGamma);
setSmoothTilt(0);
setSmoothRotation(0);
setHeldState("aligned");
setHeldStability(100);
candidateRef.current = "aligned";
candidateCountRef.current = 0;
}

useEffect(() => {
if (!started) return;

function handleOrientation(e: DeviceOrientationEvent) {
const beta = typeof e.beta === "number" ? e.beta : 0;
const gamma = typeof e.gamma === "number" ? e.gamma : 0;

setRawBeta(beta);
setRawGamma(gamma);
}

window.addEventListener("deviceorientation", handleOrientation, true);

return () => {
window.removeEventListener("deviceorientation", handleOrientation, true);
};
}, [started]);

useEffect(() => {
if (!started) return;
if (baselineBeta !== null && baselineGamma !== null) return;

const ready = rawBeta !== 0 || rawGamma !== 0;
if (!ready) return;

setBaselineBeta(rawBeta);
setBaselineGamma(rawGamma);
setHeldState("aligned");
setHeldStability(100);
}, [started, rawBeta, rawGamma, baselineBeta, baselineGamma]);

const liveReading = useMemo(() => {
if (baselineBeta === null || baselineGamma === null) {
return {
state: "aligned" as AxisState,
stability: 100,
tilt: 0,
rotation: 0,
};
}

const betaDelta = rawBeta - baselineBeta;
const gammaDelta = rawGamma - baselineGamma;

const tilt = clamp(Math.abs(betaDelta) / 8, 0, 12);
const rotation = clamp(Math.abs(gammaDelta) * 1.2, 0, 90);

return evaluateAxis({
tilt,
rotation,
});
}, [rawBeta, rawGamma, baselineBeta, baselineGamma]);

useEffect(() => {
const interval = window.setInterval(() => {
setSmoothTilt((prev) => prev + (liveReading.tilt - prev) * 0.18);
setSmoothRotation((prev) => prev + (liveReading.rotation - prev) * 0.18);
}, 16);

return () => window.clearInterval(interval);
}, [liveReading.tilt, liveReading.rotation]);

const smoothedReading = useMemo(() => {
return evaluateAxis({
tilt: smoothTilt,
rotation: smoothRotation,
});
}, [smoothTilt, smoothRotation]);

useEffect(() => {
const next = smoothedReading.state;

if (candidateRef.current !== next) {
candidateRef.current = next;
candidateCountRef.current = 1;
return;
}

candidateCountRef.current += 1;

const threshold = next === "aligned" ? 3 : 5;

if (candidateCountRef.current >= threshold) {
setHeldState(next);
setHeldStability(smoothedReading.stability);
}
}, [smoothedReading.state, smoothedReading.stability]);

const stateText = STATE_LABELS[heldState];
const stabilityText = round(heldStability);
const tiltText = round(smoothTilt);
const rotationText = round(smoothRotation);

return (
<main className="min-h-screen bg-black px-6 py-10 text-white">
<div className="mx-auto max-w-4xl">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/45">
Axis Live
</div>

<h1 className="mt-2 text-3xl font-semibold tracking-[0.18em]">
HUMAN ALIGNMENT
</h1>

{!started ? (
<button
onClick={startMeasurement}
className="mt-8 rounded-2xl border border-white/20 px-6 py-3 text-lg tracking-[0.12em] text-white transition hover:border-white/40 hover:bg-white/5"
>
START MEASUREMENT
</button>
) : (
<div className="mt-8 flex flex-wrap gap-3">
<button
onClick={calibrateNow}
className="rounded-2xl border border-white/20 px-5 py-3 text-sm tracking-[0.16em] text-white transition hover:border-white/40 hover:bg-white/5"
>
CALIBRATE ALIGN
</button>

<div className="rounded-2xl border border-white/10 px-4 py-3 text-sm tracking-[0.12em] text-white/60">
{baselineBeta === null ? "WAITING FOR SENSOR..." : "BASELINE LOCKED"}
</div>
</div>
)}

{permissionDenied ? (
<div className="mt-6 rounded-3xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
Motion permission was denied.
</div>
) : null}

<div className="mt-8 grid gap-4 sm:grid-cols-2">
<Card label="State" value={stateText} />
<Card label="Stability" value={stabilityText} />
<Card label="Tilt" value={tiltText} />
<Card label="Rotation" value={rotationText} />
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