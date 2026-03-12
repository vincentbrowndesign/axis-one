"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

type AxisState = "aligned" | "shift" | "drop" | "recover";

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

function computeMetrics(result: any, baseline: Baseline | null): PoseMetrics {
if (!hasPose(result)) {
return {
shoulderTilt: 0,
torsoLean: 0,
control: 0,
state: "drop",
visible: false,
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
};
}

const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
const hipMidX = (leftHip.x + rightHip.x) / 2;

const shoulderTiltRaw = Math.abs(leftShoulder.y - rightShoulder.y) * 100;
const torsoLeanRaw = Math.abs(shoulderMidX - hipMidX) * 100;

const shoulderTiltDelta = baseline
? Math.abs(shoulderTiltRaw - baseline.shoulderTilt)
: shoulderTiltRaw;

const torsoLeanDelta = baseline
? Math.abs(torsoLeanRaw - baseline.torsoLean)
: torsoLeanRaw;

const control = clamp(
100 - shoulderTiltDelta * 7 - torsoLeanDelta * 9,
0,
100
);

let state: AxisState = "drop";

if (control >= 84 && torsoLeanDelta < 2.5 && shoulderTiltDelta < 2.5) {
state = "aligned";
} else if (control >= 62 && torsoLeanDelta < 5.5 && shoulderTiltDelta < 5.5) {
state = "shift";
} else if (control >= 48) {
state = "recover";
} else {
state = "drop";
}

return {
shoulderTilt: shoulderTiltDelta,
torsoLean: torsoLeanDelta,
control,
state,
visible: true,
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

const [rawControl, setRawControl] = useState(0);
const [rawState, setRawState] = useState<AxisState>("drop");
const [rawShoulderTilt, setRawShoulderTilt] = useState(0);
const [rawTorsoLean, setRawTorsoLean] = useState(0);

const [smoothControl, setSmoothControl] = useState(0);
const [smoothShoulderTilt, setSmoothShoulderTilt] = useState(0);
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
setSmoothShoulderTilt((prev) => prev + (rawShoulderTilt - prev) * 0.18);
setSmoothTorsoLean((prev) => prev + (rawTorsoLean - prev) * 0.18);
}, 16);

return () => window.clearInterval(interval);
}, [rawControl, rawShoulderTilt, rawTorsoLean]);

useEffect(() => {
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
}, [rawState, smoothControl]);

useEffect(() => {
if (!cameraOn || sessionStartedAt === null) return;

const interval = window.setInterval(() => {
if (candidateRef.current === "aligned") {
setAlignedMs((prev) => prev + 250);
}

setBestControl((prev) => Math.max(prev, round(smoothControl)));
}, 250);

return () => window.clearInterval(interval);
}, [cameraOn, sessionStartedAt, smoothControl]);

useEffect(() => {
return () => {
stopCamera();
};
}, []);

const totalMs =
sessionStartedAt === null ? 1 : Math.max(Date.now() - sessionStartedAt, 1);

const alignedPct = clamp((alignedMs / totalMs) * 100, 0, 100);

const meaningText = useMemo(() => STATE_MEANING[heldState], [heldState]);

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
setRawControl(metrics.control);
setRawState(metrics.state);
setRawShoulderTilt(metrics.shoulderTilt);
setRawTorsoLean(metrics.torsoLean);

ctx.clearRect(0, 0, canvas.width, canvas.height);

if (showCamera) {
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

if (metrics.visible) {
const leftShoulder = lm(result, 11);
const rightShoulder = lm(result, 12);
const leftHip = lm(result, 23);
const rightHip = lm(result, 24);

if (leftShoulder && rightShoulder && leftHip && rightHip) {
const shoulderMidX = ((leftShoulder.x + rightShoulder.x) / 2) * canvas.width;
const shoulderMidY = ((leftShoulder.y + rightShoulder.y) / 2) * canvas.height;
const hipMidX = ((leftHip.x + rightHip.x) / 2) * canvas.width;
const hipMidY = ((leftHip.y + rightHip.y) / 2) * canvas.height;

ctx.strokeStyle = "rgba(255,255,255,0.9)";
ctx.lineWidth = 3;

ctx.beginPath();
ctx.moveTo(leftShoulder.x * canvas.width, leftShoulder.y * canvas.height);
ctx.lineTo(rightShoulder.x * canvas.width, rightShoulder.y * canvas.height);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(leftHip.x * canvas.width, leftHip.y * canvas.height);
ctx.lineTo(rightHip.x * canvas.width, rightHip.y * canvas.height);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.55)";
ctx.beginPath();
ctx.moveTo(shoulderMidX, shoulderMidY);
ctx.lineTo(hipMidX, hipMidY);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.2)";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(canvas.width / 2, 0);
ctx.lineTo(canvas.width / 2, canvas.height);
ctx.stroke();
}
}
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
}

function calibrateAlign() {
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

<div className="mx-auto max-w-6xl px-5 pb-24 pt-8 sm:px-8">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/35">
Axis OS
</div>

<h1 className="mt-2 text-3xl font-semibold tracking-[0.18em] sm:text-5xl">
HUMAN ALIGNMENT
</h1>

<section className="mt-6 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.03]">
<div className="border-b border-white/10 px-5 py-5 sm:px-7">
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
className="rounded-full border border-white/20 px-5 py-3 text-sm tracking-[0.18em] text-white transition hover:border-white/40 hover:bg-white/5"
>
CALIBRATE ALIGN
</button>

<button
onClick={() => setShowCamera((prev) => !prev)}
className="rounded-full border border-white/10 px-5 py-3 text-sm tracking-[0.18em] text-white/65 transition hover:border-white/30 hover:text-white"
>
{showCamera ? "HIDE CAMERA" : "SHOW CAMERA"}
</button>

<button
onClick={stopCamera}
className="rounded-full border border-white/10 px-5 py-3 text-sm tracking-[0.18em] text-white/65 transition hover:border-white/30 hover:text-white"
>
END SESSION
</button>
</>
)}

<Pill label={baseline ? "BASELINE LOCKED" : "NO BASELINE"} />
<Pill label={subjectVisible ? "SUBJECT VISIBLE" : "SUBJECT NOT FOUND"} />
<Pill label={cameraOn ? "LIVE READ ACTIVE" : "LIVE READ OFF"} />
</div>

{error ? (
<div className="mt-4 rounded-3xl border border-red-400/20 bg-red-400/10 px-5 py-4 text-sm text-red-200">
{error}
</div>
) : null}
</div>

<div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
<div className="border-b border-white/10 px-5 py-6 lg:border-b-0 lg:border-r lg:border-white/10 sm:px-7">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/35">
State
</div>

<div className="mt-4 flex items-center gap-4">
<SignalDot state={heldState} />
<div className="text-5xl font-semibold tracking-[0.18em] sm:text-7xl">
{STATE_LABELS[heldState]}
</div>
</div>

<div className="mt-4 text-base text-white/60 sm:text-lg">
{meaningText}
</div>

<div className="mt-8 grid gap-0 sm:grid-cols-2">
<Metric
label="Control"
value={round(heldControl || smoothControl)}
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
value={round(smoothTorsoLean)}
sublabel="Torso movement off center"
withBorder
topBorder
/>
</div>
</div>

<div className="px-5 py-6 sm:px-7">
<div className="flex items-center justify-between gap-4">
<div>
<div className="text-[11px] uppercase tracking-[0.35em] text-white/35">
Camera Lock Point
</div>
<div className="mt-2 text-sm text-white/50">
Keep the kid centered from hips to shoulders.
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
value={subjectVisible ? "FOUND" : "SEARCH"}
sublabel="Subject presence in frame"
/>
<AssistCard
label="Calibrate"
value={baseline ? "READY" : "SET"}
sublabel="Capture clean aligned stance"
/>
<AssistCard
label="Flow"
value={cameraOn ? "LIVE" : "OFF"}
sublabel="Read remains active on page"
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

function SignalDot({ state }: { state: AxisState }) {
const dotClass =
state === "aligned"
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
"px-0 py-6 sm:px-0",
withBorder ? "sm:border-l sm:border-white/10 sm:pl-6" : "",
topBorder ? "border-t border-white/10 pt-6" : "",
].join(" ")}
>
<div className="text-[10px] uppercase tracking-[0.32em] text-white/35">
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
<div className="text-[10px] uppercase tracking-[0.32em] text-white/35">
{label}
</div>
<div className="mt-2 text-xl font-semibold tracking-[0.12em]">{value}</div>
<div className="mt-1 text-xs text-white/45">{sublabel}</div>
</div>
);
}