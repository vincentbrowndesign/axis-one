"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
evaluateAxis,
type AxisSample,
type AxisState,
} from "@/lib/axis/axisMovementModel";

type PermissionState = "idle" | "granted" | "denied" | "unsupported";

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

export default function AxisCameraInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const streamRef = useRef<MediaStream | null>(null);

const [cameraOn, setCameraOn] = useState(false);
const [permission, setPermission] = useState<PermissionState>("idle");
const [error, setError] = useState("");

const [rawTilt, setRawTilt] = useState(0);
const [rawRotation, setRawRotation] = useState(0);

const [smoothTilt, setSmoothTilt] = useState(0);
const [smoothRotation, setSmoothRotation] = useState(0);

const [heldState, setHeldState] = useState<AxisState>("drop");
const [heldScore, setHeldScore] = useState(0);

const candidateRef = useRef<AxisState>("drop");
const candidateCountRef = useRef(0);

useEffect(() => {
const interval = window.setInterval(() => {
setSmoothTilt((prev) => prev + (rawTilt - prev) * 0.18);
setSmoothRotation((prev) => prev + (rawRotation - prev) * 0.18);
}, 16);

return () => window.clearInterval(interval);
}, [rawTilt, rawRotation]);

const sample: AxisSample = useMemo(() => {
return {
tilt: Math.abs(smoothTilt),
rotation: Math.abs(smoothRotation),
};
}, [smoothTilt, smoothRotation]);

const reading = useMemo(() => evaluateAxis(sample), [sample]);

useEffect(() => {
const next = reading.state;

if (candidateRef.current !== next) {
candidateRef.current = next;
candidateCountRef.current = 1;
return;
}

candidateCountRef.current += 1;

const threshold = next === "aligned" ? 4 : 6;

if (candidateCountRef.current >= threshold) {
setHeldState(next);
setHeldScore(reading.stability);
}
}, [reading.state, reading.stability]);

useEffect(() => {
return () => {
stopCamera();
};
}, []);

useEffect(() => {
if (typeof window === "undefined") return;

const onOrientation = (event: DeviceOrientationEvent) => {
const beta = typeof event.beta === "number" ? event.beta : 0;
const gamma = typeof event.gamma === "number" ? event.gamma : 0;

setRawTilt(clamp(beta / 10, -12, 12));
setRawRotation(clamp(gamma * 2, -90, 90));
};

window.addEventListener("deviceorientation", onOrientation, true);

return () => {
window.removeEventListener("deviceorientation", onOrientation, true);
};
}, []);

async function requestMotionPermission() {
try {
if (typeof window === "undefined") return;

const DeviceMotionEventAny = DeviceMotionEvent as typeof DeviceMotionEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

const DeviceOrientationEventAny =
DeviceOrientationEvent as typeof DeviceOrientationEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

const motionNeedsPermission =
typeof DeviceMotionEventAny !== "undefined" &&
typeof DeviceMotionEventAny.requestPermission === "function";

const orientationNeedsPermission =
typeof DeviceOrientationEventAny !== "undefined" &&
typeof DeviceOrientationEventAny.requestPermission === "function";

if (!motionNeedsPermission && !orientationNeedsPermission) {
setPermission("granted");
return;
}

const results: string[] = [];

if (motionNeedsPermission && DeviceMotionEventAny.requestPermission) {
results.push(await DeviceMotionEventAny.requestPermission());
}

if (
orientationNeedsPermission &&
DeviceOrientationEventAny.requestPermission
) {
results.push(await DeviceOrientationEventAny.requestPermission());
}

const granted = results.every((result) => result === "granted");
setPermission(granted ? "granted" : "denied");

if (!granted) {
setError("Motion permission was denied.");
}
} catch {
setPermission("denied");
setError("Could not request motion permission.");
}
}

async function startCamera() {
try {
setError("");

if (!navigator.mediaDevices?.getUserMedia) {
setPermission("unsupported");
setError("Camera is not supported on this device.");
return;
}

const stream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: "user",
width: { ideal: 1280 },
height: { ideal: 720 },
},
audio: false,
});

streamRef.current = stream;

if (videoRef.current) {
videoRef.current.srcObject = stream;
await videoRef.current.play();
}

setCameraOn(true);

if (permission === "idle") {
await requestMotionPermission();
}
} catch {
setError("Camera access failed.");
setCameraOn(false);
}
}

function stopCamera() {
if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}

if (videoRef.current) {
videoRef.current.srcObject = null;
}

setCameraOn(false);
}

function toggleCamera() {
if (cameraOn) {
stopCamera();
} else {
void startCamera();
}
}

const stateText = STATE_LABELS[heldState];
const tiltText = round(Math.abs(sample.tilt));
const rotationText = round(Math.abs(sample.rotation));
const stabilityText = round(heldScore || reading.stability);

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-6">
<div className="mb-4 flex items-center justify-between">
<div>
<div className="text-[11px] uppercase tracking-[0.35em] text-white/45">
Axis Instrument
</div>
<h1 className="mt-1 text-xl font-medium tracking-[0.18em] sm:text-2xl">
HUMAN ALIGNMENT
</h1>
</div>

<button
onClick={toggleCamera}
className="rounded-full border border-white/20 px-4 py-2 text-sm tracking-[0.2em] text-white/85 transition hover:border-white/40 hover:bg-white/5"
>
{cameraOn ? "END SESSION" : "START SESSION"}
</button>
</div>

<div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.4fr_0.8fr]">
<section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-2xl">
<div className="absolute inset-0">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="h-full w-full object-cover opacity-90"
/>
</div>

<div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/60" />

<div className="absolute inset-0">
<div className="absolute left-1/2 top-1/2 h-[68vmin] w-[68vmin] max-h-[640px] max-w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
<div className="absolute left-1/2 top-1/2 h-[48vmin] w-[48vmin] max-h-[460px] max-w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
<div className="absolute left-1/2 top-1/2 h-[28vmin] w-[28vmin] max-h-[280px] max-w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />

<div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10" />
<div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/10" />

<div
className="absolute left-1/2 top-1/2 h-[2px] w-[34vmin] max-w-[340px] -translate-y-1/2 bg-white/70 transition-transform duration-150"
style={{
transform: `translate(-50%, -50%) rotate(${smoothRotation}deg)`,
transformOrigin: "center center",
}}
/>

<div
className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-white/90 shadow-[0_0_30px_rgba(255,255,255,0.5)] transition-all duration-150"
style={{
marginTop: `${smoothTilt * 6}px`,
}}
/>
</div>

<div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-4 sm:p-6">
<div>
<div className="text-[11px] uppercase tracking-[0.35em] text-white/45">
State
</div>
<div className="mt-1 text-3xl font-semibold tracking-[0.22em] sm:text-5xl">
{stateText}
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.3em] text-white/45">
Stability
</div>
<div className="mt-1 text-2xl font-semibold tracking-[0.16em]">
{stabilityText}
</div>
</div>
</div>
</section>

<aside className="flex flex-col gap-4">
<div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/45">
Reading
</div>

<div className="mt-5 grid grid-cols-2 gap-3">
<MetricCard label="Tilt" value={tiltText} />
<MetricCard label="Rotation" value={rotationText} />
<MetricCard
label="Live State"
value={STATE_LABELS[reading.state]}
compact
/>
<MetricCard
label="Motion"
value={
permission === "granted"
? "READY"
: permission === "denied"
? "BLOCKED"
: permission === "unsupported"
? "UNSUPPORTED"
: "PENDING"
}
compact
/>
</div>
</div>

<div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/45">
Session
</div>

<div className="mt-4 space-y-3 text-sm text-white/70">
<p>Use the front camera and body position together.</p>
<p>Small movement changes are smoothed so the state does not flicker.</p>
<p>The held state waits a few frames before switching.</p>
</div>

<div className="mt-5 flex gap-3">
<button
onClick={toggleCamera}
className="rounded-full border border-white/20 px-4 py-2 text-xs tracking-[0.22em] text-white/85 transition hover:border-white/40 hover:bg-white/5"
>
{cameraOn ? "STOP" : "START"}
</button>

<button
onClick={() => void requestMotionPermission()}
className="rounded-full border border-white/10 px-4 py-2 text-xs tracking-[0.22em] text-white/60 transition hover:border-white/30 hover:text-white/80"
>
ENABLE MOTION
</button>
</div>

{error ? (
<div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
{error}
</div>
) : null}
</div>
</aside>
</div>
</div>
</main>
);
}

function MetricCard({
label,
value,
compact = false,
}: {
label: string;
value: string | number;
compact?: boolean;
}) {
return (
<div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">
{label}
</div>
<div
className={
compact
? "mt-2 text-base font-semibold tracking-[0.14em]"
: "mt-2 text-2xl font-semibold tracking-[0.14em]"
}
>
{value}
</div>
</div>
);
}