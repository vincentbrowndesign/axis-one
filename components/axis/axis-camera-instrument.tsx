"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

type AxisState = "aligned" | "shift" | "drop" | "recover";
type LockState = "search" | "partial" | "locked";

type Baseline = {
shoulderTilt: number;
torsoLean: number;
};

type PoseMetrics = {
shoulderTilt: number;
torsoLean: number;
control: number;
state: AxisState;
visible: boolean;
lockState: LockState;
centered: boolean;
bodyScale: number;
shoulderY: number;
hipY: number;
shoulderMidX: number;
hipMidX: number;
leftShoulderX: number;
rightShoulderX: number;
leftShoulderY: number;
rightShoulderY: number;
leftHipX: number;
rightHipX: number;
leftHipY: number;
rightHipY: number;
};

const STATE_LABELS: Record<AxisState, string> = {
aligned: "ALIGNED",
shift: "SHIFT",
drop: "DROP",
recover: "RECOVER",
};

const STATE_MEANING: Record<AxisState, string> = {
aligned: "Body stacked and stable",
shift: "Body drifting off center",
drop: "Balance lost",
recover: "Returning toward center",
};

const LOCK_LABELS: Record<LockState, string> = {
search: "SEARCH",
partial: "PARTIAL",
locked: "LOCKED",
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function round(value: number) {
return Math.round(value);
}

function lm(result: any, index: number) {
return result?.landmarks?.[0]?.[index];
}

function hasPose(result: any) {
return Boolean(result?.landmarks?.[0]?.length);
}

function roundedRect(
ctx: CanvasRenderingContext2D,
x: number,
y: number,
width: number,
height: number,
radius: number
) {
ctx.beginPath();
ctx.moveTo(x + radius, y);
ctx.lineTo(x + width - radius, y);
ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
ctx.lineTo(x + width, y + height - radius);
ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
ctx.lineTo(x + radius, y + height);
ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
ctx.lineTo(x, y + radius);
ctx.quadraticCurveTo(x, y, x + radius, y);
ctx.closePath();
}

function computeMetrics(result: any, baseline: Baseline | null): PoseMetrics {
if (!hasPose(result)) {
return {
shoulderTilt: 0,
torsoLean: 0,
control: 0,
state: "drop",
visible: false,
lockState: "search",
centered: false,
bodyScale: 0,
shoulderY: 0,
hipY: 0,
shoulderMidX: 0,
hipMidX: 0,
leftShoulderX: 0,
rightShoulderX: 0,
leftShoulderY: 0,
rightShoulderY: 0,
leftHipX: 0,
rightHipX: 0,
leftHipY: 0,
rightHipY: 0,
};
}

const leftShoulder = lm(result, 11);
const rightShoulder = lm(result, 12);
const leftHip = lm(result, 23);
const rightHip = lm(result, 24);

if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
return {
shoulderTilt: 0,
torsoLean: 0,
control: 0,
state: "drop",
visible: false,
lockState: "search",
centered: false,
bodyScale: 0,
shoulderY: 0,
hipY: 0,
shoulderMidX: 0,
hipMidX: 0,
leftShoulderX: 0,
rightShoulderX: 0,
leftShoulderY: 0,
rightShoulderY: 0,
leftHipX: 0,
rightHipX: 0,
leftHipY: 0,
rightHipY: 0,
};
}

const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
const hipMidX = (leftHip.x + rightHip.x) / 2;
const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
const hipMidY = (leftHip.y + rightHip.y) / 2;

const shoulderTiltRaw = Math.abs(leftShoulder.y - rightShoulder.y) * 100;
const torsoLeanRaw = Math.abs(shoulderMidX - hipMidX) * 100;

const bodyWidth = Math.abs(leftShoulder.x - rightShoulder.x);
const bodyHeight = Math.abs(shoulderMidY - hipMidY);
const bodyScale = bodyWidth + bodyHeight;

const centered =
shoulderMidX > 0.36 &&
shoulderMidX < 0.64 &&
hipMidX > 0.34 &&
hipMidX < 0.66;

const torsoPresent =
shoulderMidY > 0.12 &&
shoulderMidY < 0.68 &&
hipMidY > 0.28 &&
hipMidY < 0.88;

let lockState: LockState = "search";

if (bodyScale > 0.3 && bodyScale < 0.75 && centered && torsoPresent) {
lockState = "locked";
} else if (bodyScale > 0.2 && torsoPresent) {
lockState = "partial";
}

const shoulderTiltDelta = baseline
? Math.abs(shoulderTiltRaw - baseline.shoulderTilt)
: shoulderTiltRaw;

const torsoLeanDelta = baseline
? Math.abs(torsoLeanRaw - baseline.torsoLean)
: torsoLeanRaw;

let control = clamp(100 - shoulderTiltDelta * 7 - torsoLeanDelta * 9, 0, 100);

if (lockState === "partial") {
control = Math.min(control, 45);
}

if (lockState === "search") {
control = 0;
}

let state: AxisState = "drop";

if (lockState === "locked") {
if (control >= 84 && torsoLeanDelta < 2.5 && shoulderTiltDelta < 2.5) {
state = "aligned";
} else if (control >= 62 && torsoLeanDelta < 5.5 && shoulderTiltDelta < 5.5) {
state = "shift";
} else if (control >= 48) {
state = "recover";
} else {
state = "drop";
}
}

return {
shoulderTilt: shoulderTiltDelta,
torsoLean: torsoLeanDelta,
control,
state,
visible: true,
lockState,
centered,
bodyScale,
shoulderY: shoulderMidY,
hipY: hipMidY,
shoulderMidX,
hipMidX,
leftShoulderX: leftShoulder.x,
rightShoulderX: rightShoulder.x,
leftShoulderY: leftShoulder.y,
rightShoulderY: rightShoulder.y,
leftHipX: leftHip.x,
rightHipX: rightHip.x,
leftHipY: leftHip.y,
rightHipY: rightHip.y,
};
}

export default function AxisCameraInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const poseRef = useRef<PoseLandmarker | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const rafRef = useRef<number | null>(null);
const runningRef = useRef(false);

const [cameraOn, setCameraOn] = useState(false);
const [loading, setLoading] = useState(false);
const [showCamera, setShowCamera] = useState(true);
const [error, setError] = useState("");

const [baseline, setBaseline] = useState<Baseline | null>(null);
const [subjectVisible, setSubjectVisible] = useState(false);
const [lockState, setLockState] = useState<LockState>("search");
const [lockReady, setLockReady] = useState(false);

const [rawControl, setRawControl] = useState(0);
const [rawState, setRawState] = useState<AxisState>("drop");
const [rawShoulderTilt, setRawShoulderTilt] = useState(0);
const [rawTorsoLean, setRawTorsoLean] = useState(0);

const [smoothControl, setSmoothControl] = useState(0);
const [smoothTorsoLean, setSmoothTorsoLean] = useState(0);

const [heldState, setHeldState] = useState<AxisState>("drop");
const [heldControl, setHeldControl] = useState(0);

const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
const [alignedMs, setAlignedMs] = useState(0);
const [bestControl, setBestControl] = useState(0);

const candidateRef = useRef<AxisState>("drop");
const candidateCountRef = useRef(0);

useEffect(() => {
const interval = window.setInterval(() => {
setSmoothControl((prev) => prev + (rawControl - prev) * 0.18);
setSmoothTorsoLean((prev) => prev + (rawTorsoLean - prev) * 0.18);
}, 16);

return () => window.clearInterval(interval);
}, [rawControl, rawTorsoLean]);

useEffect(() => {
if (lockState !== "locked") {
setHeldState("drop");
setHeldControl(0);
candidateRef.current = "drop";
candidateCountRef.current = 0;
return;
}

const next = rawState;

if (candidateRef.current !== next) {
candidateRef.current = next;
candidateCountRef.current = 1;
return;
}

candidateCountRef.current += 1;

const threshold = next === "aligned" ? 3 : 5;

if (candidateCountRef.current >= threshold) {
setHeldState(next);
setHeldControl(round(smoothControl));
}
}, [rawState, smoothControl, lockState]);

useEffect(() => {
if (!cameraOn || sessionStartedAt === null || lockState !== "locked") return;

const interval = window.setInterval(() => {
if (candidateRef.current === "aligned") {
setAlignedMs((prev) => prev + 250);
}
setBestControl((prev) => Math.max(prev, round(smoothControl)));
}, 250);

return () => window.clearInterval(interval);
}, [cameraOn, sessionStartedAt, smoothControl, lockState]);

useEffect(() => {
return () => {
stopCamera();
};
}, []);

const totalMs =
sessionStartedAt === null ? 1 : Math.max(Date.now() - sessionStartedAt, 1);

const alignedPct = clamp((alignedMs / totalMs) * 100, 0, 100);

const displayStateText =
lockState === "search"
? "SEARCH"
: lockState === "partial"
? "PARTIAL"
: STATE_LABELS[heldState];

const meaningText =
lockState === "search"
? "Find torso in frame"
: lockState === "partial"
? "Move subject into lock zone"
: STATE_MEANING[heldState];

const coachingText =
lockState === "search"
? "Find the frame"
: lockState === "partial"
? "Center shoulders and hips"
: smoothTorsoLean < 2
? "Hold alignment"
: "Stabilize body";

async function ensurePoseLandmarker() {
if (poseRef.current) return poseRef.current;

const vision = await FilesetResolver.forVisionTasks(
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
);

poseRef.current = await PoseLandmarker.createFromOptions(vision, {
baseOptions: {
modelAssetPath:
"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
},
runningMode: "VIDEO",
numPoses: 1,
});

return poseRef.current;
}

async function startCamera() {
try {
setLoading(true);
setError("");

const pose = await ensurePoseLandmarker();

const stream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: { ideal: "environment" },
width: { ideal: 1280 },
height: { ideal: 720 },
},
audio: false,
});

streamRef.current = stream;

if (!videoRef.current) return;

videoRef.current.srcObject = stream;
await videoRef.current.play();

runningRef.current = true;
setCameraOn(true);
setSessionStartedAt(Date.now());
setAlignedMs(0);
setBestControl(0);

const loop = () => {
if (!runningRef.current || !videoRef.current || !canvasRef.current) return;

const video = videoRef.current;
const canvas = canvasRef.current;
const ctx = canvas.getContext("2d");

if (!ctx) return;

canvas.width = video.videoWidth || 640;
canvas.height = video.videoHeight || 480;

const result = pose.detectForVideo(video, performance.now());
const metrics = computeMetrics(result, baseline);

setSubjectVisible(metrics.visible);
setLockState(metrics.lockState);
setLockReady(metrics.lockState === "locked");

setRawControl(metrics.control);
setRawState(metrics.state);
setRawShoulderTilt(metrics.shoulderTilt);
setRawTorsoLean(metrics.torsoLean);

ctx.clearRect(0, 0, canvas.width, canvas.height);

if (showCamera) {
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

const grad = ctx.createRadialGradient(
canvas.width / 2,
canvas.height / 2,
canvas.width * 0.3,
canvas.width / 2,
canvas.height / 2,
canvas.width * 0.9
);
grad.addColorStop(0, "rgba(0,0,0,0)");
grad.addColorStop(1, "rgba(0,0,0,0.55)");
ctx.fillStyle = grad;
ctx.fillRect(0, 0, canvas.width, canvas.height);

const lockBoxX = canvas.width * 0.32;
const lockBoxY = canvas.height * 0.22;
const lockBoxW = canvas.width * 0.36;
const lockBoxH = canvas.height * 0.44;

ctx.strokeStyle =
metrics.lockState === "locked"
? "rgba(52,211,153,0.92)"
: metrics.lockState === "partial"
? "rgba(252,211,77,0.88)"
: "rgba(255,255,255,0.18)";
ctx.lineWidth = metrics.lockState === "locked" ? 3 : 2;
roundedRect(ctx, lockBoxX, lockBoxY, lockBoxW, lockBoxH, 24);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.18)";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(canvas.width / 2, 0);
ctx.lineTo(canvas.width / 2, canvas.height);
ctx.stroke();

if (metrics.visible) {
ctx.strokeStyle = "rgba(255,255,255,0.9)";
ctx.lineWidth = 3;

ctx.beginPath();
ctx.moveTo(
metrics.leftShoulderX * canvas.width,
metrics.leftShoulderY * canvas.height
);
ctx.lineTo(
metrics.rightShoulderX * canvas.width,
metrics.rightShoulderY * canvas.height
);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(metrics.leftHipX * canvas.width, metrics.leftHipY * canvas.height);
ctx.lineTo(metrics.rightHipX * canvas.width, metrics.rightHipY * canvas.height);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.55)";
ctx.beginPath();
ctx.moveTo(
metrics.shoulderMidX * canvas.width,
metrics.shoulderY * canvas.height
);
ctx.lineTo(metrics.hipMidX * canvas.width, metrics.hipY * canvas.height);
ctx.stroke();
}

ctx.fillStyle =
metrics.lockState === "locked"
? "rgba(52,211,153,0.95)"
: metrics.lockState === "partial"
? "rgba(252,211,77,0.95)"
: "rgba(255,255,255,0.5)";
ctx.font = "600 16px system-ui";
ctx.fillText(`LOCK ${LOCK_LABELS[metrics.lockState]}`, 24, 34);
}

rafRef.current = window.requestAnimationFrame(loop);
};

rafRef.current = window.requestAnimationFrame(loop);
} catch {
setError("Camera or pose model failed to start.");
} finally {
setLoading(false);
}
}

function stopCamera() {
runningRef.current = false;

if (rafRef.current !== null) {
window.cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}

if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}

if (videoRef.current) {
videoRef.current.srcObject = null;
}

setCameraOn(false);
setLockState("search");
setLockReady(false);
}

function calibrateAlign() {
if (!lockReady) return;

const currentBaseline: Baseline = {
shoulderTilt: rawShoulderTilt,
torsoLean: rawTorsoLean,
};

setBaseline(currentBaseline);
setHeldState("aligned");
setHeldControl(100);
setBestControl(100);
setAlignedMs(0);
setSessionStartedAt(Date.now());
candidateRef.current = "aligned";
candidateCountRef.current = 0;
}

return (
<main className="min-h-screen bg-black text-white">
<video ref={videoRef} playsInline muted autoPlay className="hidden" />

<div className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">
<div className="text-[10px] uppercase tracking-[0.38em] text-white/28">
Axis OS
</div>

<h1 className="mt-2 text-3xl font-semibold tracking-[0.18em] sm:text-5xl">
HUMAN ALIGNMENT
</h1>

<section className="mt-6 overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
<div className="border-b border-white/10 px-4 py-4 sm:px-6">
<div className="flex flex-wrap gap-3">
{!cameraOn ? (
<button
onClick={() => void startCamera()}
className="rounded-full border border-white/20 px-5 py-3 text-sm tracking-[0.18em] text-white transition hover:border-white/40 hover:bg-white/5"
>
{loading ? "STARTING..." : "START CAMERA"}
</button>
) : (
<>
<button
onClick={calibrateAlign}
disabled={!lockReady}
className={`rounded-full border px-5 py-3 text-sm tracking-[0.18em] transition ${
lockReady
? "border-white/20 text-white hover:border-white/40 hover:bg-white/5"
: "border-white/8 text-white/25"
}`}
>
CALIBRATE ALIGN
</button>

<button
onClick={() => setShowCamera((prev) => !prev)}
className="rounded-full border border-white/10 px-5 py-3 text-sm tracking-[0.18em] text-white/70 transition hover:border-white/30 hover:text-white"
>
{showCamera ? "HIDE CAMERA" : "SHOW CAMERA"}
</button>

<button
onClick={stopCamera}
className="rounded-full border border-white/10 px-5 py-3 text-sm tracking-[0.18em] text-white/70 transition hover:border-white/30 hover:text-white"
>
END SESSION
</button>
</>
)}

<Pill label={baseline ? "BASELINE LOCKED" : "NO BASELINE"} />
<Pill label={subjectVisible ? "SUBJECT VISIBLE" : "SUBJECT NOT FOUND"} />
<Pill label={`LOCK ${LOCK_LABELS[lockState]}`} />
</div>

{error ? (
<div className="mt-4 rounded-3xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
{error}
</div>
) : null}
</div>

<div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
<div className="order-1 border-b border-white/10 px-4 py-5 lg:order-2 lg:border-b-0 lg:border-l lg:border-white/10 sm:px-6">
<div className="flex items-center justify-between gap-4">
<div>
<div className="text-[10px] uppercase tracking-[0.35em] text-white/30">
Camera Lock Chamber
</div>
<div className="mt-2 text-sm text-white/50">
Fit shoulders and hips inside the lock box.
</div>
</div>

<div className="rounded-full border border-white/10 px-4 py-2 text-xs tracking-[0.18em] text-white/45">
{showCamera ? "VISIBLE" : "HIDDEN"}
</div>
</div>

<div className="mt-5 overflow-hidden rounded-[28px] border border-white/10 bg-black">
<canvas
ref={canvasRef}
className={`h-auto w-full ${showCamera ? "opacity-100" : "opacity-0"} transition-opacity`}
/>
</div>

<div className="mt-4 grid gap-3 sm:grid-cols-3">
<AssistCard
label="Lock"
value={LOCK_LABELS[lockState]}
sublabel="Target certainty"
/>
<AssistCard
label="Calibrate"
value={lockReady ? "READY" : "WAIT"}
sublabel="Only available on strong lock"
/>
<AssistCard
label="Flow"
value={cameraOn ? "LIVE" : "OFF"}
sublabel="Instrument remains active"
/>
</div>
</div>

<div className="order-2 px-4 py-5 lg:order-1 sm:px-6">
<div className="text-[10px] uppercase tracking-[0.35em] text-white/30">
State
</div>

<div className="mt-4 flex items-center gap-4">
<SignalDot state={lockState === "locked" ? heldState : "drop"} lockState={lockState} />
<div className="text-5xl font-semibold tracking-[0.18em] sm:text-7xl">
{displayStateText}
</div>
</div>

<div className="mt-4 text-base text-white/60 sm:text-lg">
{meaningText}
</div>

<div className="mt-3 text-sm uppercase tracking-[0.28em] text-white/38">
{coachingText}
</div>

<div className="mt-8 grid gap-0 sm:grid-cols-2">
<Metric
label="Control"
value={lockState === "locked" ? round(heldControl || smoothControl) : 0}
sublabel="How organized the body is"
/>
<Metric
label="Aligned Time"
value={`${round(alignedPct)}%`}
sublabel="Time spent organized"
withBorder
/>
<Metric
label="Best Control"
value={bestControl}
sublabel="Best lock this session"
topBorder
/>
<Metric
label="Body Drift"
value={lockState === "locked" ? round(smoothTorsoLean) : 0}
sublabel="Torso movement off center"
withBorder
topBorder
/>
</div>
</div>
</div>
</section>
</div>
</main>
);
}

function Pill({ label }: { label: string }) {
return (
<div className="rounded-full border border-white/10 px-5 py-3 text-sm tracking-[0.18em] text-white/45">
{label}
</div>
);
}

function SignalDot({
state,
lockState,
}: {
state: AxisState;
lockState: LockState;
}) {
const dotClass =
lockState === "search"
? "bg-white/35 shadow-[0_0_14px_rgba(255,255,255,0.12)]"
: lockState === "partial"
? "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.35)]"
: state === "aligned"
? "bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.45)]"
: state === "shift"
? "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.35)]"
: state === "recover"
? "bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.35)]"
: "bg-red-400 shadow-[0_0_18px_rgba(248,113,113,0.35)]";

return <div className={`h-4 w-4 rounded-full ${dotClass}`} />;
}

function Metric({
label,
value,
sublabel,
withBorder = false,
topBorder = false,
}: {
label: string;
value: string | number;
sublabel: string;
withBorder?: boolean;
topBorder?: boolean;
}) {
return (
<div
className={[
"px-0 py-6",
withBorder ? "sm:border-l sm:border-white/10 sm:pl-6" : "",
topBorder ? "border-t border-white/10 pt-6" : "",
].join(" ")}
>
<div className="text-[10px] uppercase tracking-[0.32em] text-white/30">
{label}
</div>
<div className="mt-3 text-4xl font-semibold tracking-[0.14em]">{value}</div>
<div className="mt-2 text-sm text-white/45">{sublabel}</div>
</div>
);
}

function AssistCard({
label,
value,
sublabel,
}: {
label: string;
value: string | number;
sublabel: string;
}) {
return (
<div className="rounded-[22px] border border-white/10 bg-white/[0.02] p-4">
<div className="text-[10px] uppercase tracking-[0.32em] text-white/30">
{label}
</div>
<div className="mt-2 text-xl font-semibold tracking-[0.12em]">{value}</div>
<div className="mt-1 text-xs text-white/45">{sublabel}</div>
</div>
);
}