"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type CameraState = "IDLE" | "ALIGNING" | "LOCKED" | "UNSTABLE";

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function getCameraState(stability: number): CameraState {
if (stability >= 86) return "LOCKED";
if (stability >= 68) return "ALIGNING";
if (stability >= 40) return "IDLE";
return "UNSTABLE";
}

const STATE_COLORS: Record<CameraState, string> = {
IDLE: "#7AB8FF",
ALIGNING: "#FFE27A",
LOCKED: "#8CFFB5",
UNSTABLE: "#FF7A7A",
};

export default function AxisCameraInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const streamRef = useRef<MediaStream | null>(null);

const [enabled, setEnabled] = useState(false);
const [error, setError] = useState<string>("");
const [tiltX, setTiltX] = useState(0);
const [tiltY, setTiltY] = useState(0);
const [stability, setStability] = useState(82);

const state = useMemo(() => getCameraState(stability), [stability]);
const stateColor = STATE_COLORS[state];

async function startCamera() {
try {
setError("");

const stream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: "environment",
},
audio: false,
});

streamRef.current = stream;

if (videoRef.current) {
videoRef.current.srcObject = stream;
await videoRef.current.play();
}

setEnabled(true);
} catch (err) {
setError("Camera access failed. Check permissions and try again.");
setEnabled(false);
}
}

function stopCamera() {
if (streamRef.current) {
for (const track of streamRef.current.getTracks()) {
track.stop();
}
streamRef.current = null;
}

if (videoRef.current) {
videoRef.current.srcObject = null;
}

setEnabled(false);
}

useEffect(() => {
const onMotion = (event: DeviceMotionEvent) => {
const ax = event.accelerationIncludingGravity?.x ?? 0;
const ay = event.accelerationIncludingGravity?.y ?? 0;

const nx = clamp(ax / 12, -1, 1);
const ny = clamp(ay / 12, -1, 1);

setTiltX(nx);
setTiltY(ny);

const magnitude = Math.sqrt(nx * nx + ny * ny);
const nextStability = clamp(100 - magnitude * 65, 12, 100);
setStability(nextStability);
};

window.addEventListener("devicemotion", onMotion);

return () => {
window.removeEventListener("devicemotion", onMotion);
stopCamera();
};
}, []);

return (
<main className="min-h-screen bg-[#030405] text-white">
<div className="mx-auto max-w-[1200px] px-4 py-4 sm:px-6 sm:py-6">
<div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:p-6">
<div className="mb-6 flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-center lg:justify-between">
<div>
<div className="mb-2 flex items-center gap-3">
<span
className="inline-block h-2.5 w-2.5 rounded-full"
style={{
backgroundColor: stateColor,
boxShadow: `0 0 20px ${stateColor}`,
}}
/>
<span className="text-[11px] tracking-[0.28em] text-white/45">
AXIS CAMERA INSTRUMENT
</span>
</div>

<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
Camera. Frame. Stability.
</h1>
<p className="mt-2 max-w-2xl text-sm text-white/55 sm:text-base">
Live camera shell for Axis. Clean replacement file to remove the broken import path.
</p>
</div>

<div className="flex flex-wrap gap-3">
{!enabled ? (
<button
type="button"
onClick={startCamera}
className="rounded-2xl border border-white/15 bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90"
>
Start Camera
</button>
) : (
<button
type="button"
onClick={stopCamera}
className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
>
Stop Camera
</button>
)}
</div>
</div>

{error ? (
<div className="mb-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
{error}
</div>
) : null}

<div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
<div className="rounded-[2rem] border border-white/10 bg-black/25 p-4 sm:p-5">
<div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="aspect-[3/4] w-full object-cover"
/>

<div className="pointer-events-none absolute inset-0">
<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.35)_100%)]" />

<div className="absolute left-1/2 top-1/2 h-[58%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-[1.25rem] border border-white/20" />

<div className="absolute left-1/2 top-1/2 h-[74%] w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-white/10" />

<div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/15" />
<div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/15" />

<div
className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
style={{
backgroundColor: stateColor,
boxShadow: `0 0 24px ${stateColor}`,
}}
/>
</div>

{!enabled ? (
<div className="absolute inset-0 flex items-center justify-center bg-[#05070a]">
<div className="text-center">
<div className="text-sm tracking-[0.24em] text-white/40">CAMERA OFFLINE</div>
<div className="mt-3 text-white/70">Start camera to begin live framing.</div>
</div>
</div>
) : null}
</div>
</div>

<div className="grid gap-5">
<div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
<div className="mb-3 text-[11px] tracking-[0.22em] text-white/45">LIVE STATE</div>

<div className="grid gap-3 sm:grid-cols-2">
<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">State</div>
<div className="mt-2 text-2xl font-semibold" style={{ color: stateColor }}>
{state}
</div>
</div>

<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">Stability</div>
<div className="mt-2 text-2xl font-semibold text-white">
{Math.round(stability)}%
</div>
</div>

<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">Tilt X</div>
<div className="mt-2 text-2xl font-semibold text-white">
{tiltX.toFixed(2)}
</div>
</div>

<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">Tilt Y</div>
<div className="mt-2 text-2xl font-semibold text-white">
{tiltY.toFixed(2)}
</div>
</div>
</div>
</div>

<div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
<div className="mb-3 text-[11px] tracking-[0.22em] text-white/45">READ</div>
<div
className="text-3xl font-semibold tracking-tight"
style={{ color: stateColor }}
>
{state === "LOCKED"
? "Frame stable"
: state === "ALIGNING"
? "Frame aligning"
: state === "UNSTABLE"
? "Frame unstable"
: "Awaiting lock"}
</div>
<p className="mt-3 text-sm text-white/55">
This is a safe self-contained replacement so the build stops failing on the broken
component reference.
</p>
</div>
</div>
</div>
</div>
</div>
</main>
);
}