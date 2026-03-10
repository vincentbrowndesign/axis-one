"use client";

import { useEffect, useRef, useState } from "react";

type AxisState = "aligned" | "shift" | "drop" | "recover" | "unknown";
type ViewMode = "front" | "side";

type Point = {
x: number;
y: number;
};

type Readout = {
state: AxisState;
stability: number;
alignment: number;
lean: number;
};

function clamp(v: number, min: number, max: number) {
return Math.min(max, Math.max(min, v));
}

function midpoint(a: Point, b: Point): Point {
return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
};
}

function distance(a: Point, b: Point) {
const dx = a.x - b.x;
const dy = a.y - b.y;
return Math.sqrt(dx * dx + dy * dy);
}

function stateColor(state: AxisState) {
if (state === "aligned") return "#8CFFB5";
if (state === "recover") return "#FFE27A";
if (state === "shift") return "#FFB26B";
if (state === "drop") return "#FF7A7A";
return "#7AB8FF";
}

function getFrontState(stability: number, alignment: number, lean: number): AxisState {
if (stability >= 82 && alignment >= 78 && lean <= 0.08) return "aligned";
if (stability >= 66 && alignment >= 58) return "recover";
if (lean > 0.22 || alignment < 40) return "drop";
if (stability >= 46) return "shift";
return "unknown";
}

function getSideState(stability: number, alignment: number, lean: number): AxisState {
if (stability >= 80 && alignment >= 74 && lean <= 0.14) return "aligned";
if (stability >= 62 && alignment >= 52) return "recover";
if (lean > 0.34 || alignment < 36) return "drop";
if (stability >= 42) return "shift";
return "unknown";
}

export default function AxisCameraInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const poseRef = useRef<any>(null);
const rafRef = useRef<number | null>(null);
const streamRef = useRef<MediaStream | null>(null);

const [status, setStatus] = useState("Starting camera...");
const [cameraReady, setCameraReady] = useState(false);
const [modelReady, setModelReady] = useState(false);
const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
const [viewMode, setViewMode] = useState<ViewMode>("front");

const [readout, setReadout] = useState<Readout>({
state: "unknown",
stability: 0,
alignment: 0,
lean: 0,
});

async function stopCamera() {
if (streamRef.current) {
for (const track of streamRef.current.getTracks()) {
track.stop();
}
streamRef.current = null;
}

if (videoRef.current) {
videoRef.current.srcObject = null;
}

setCameraReady(false);
}

async function startCamera(facing: "environment" | "user") {
setStatus(facing === "environment" ? "Starting back camera..." : "Starting front camera...");

const stream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: { ideal: facing },
width: { ideal: 1280 },
height: { ideal: 720 },
},
audio: false,
});

streamRef.current = stream;

if (!videoRef.current) return;

videoRef.current.srcObject = stream;
await videoRef.current.play();

setCameraReady(true);
setStatus("Camera ready");
}

async function restartCamera(nextFacing: "environment" | "user") {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
await stopCamera();
setCameraFacing(nextFacing);
await startCamera(nextFacing);
if (poseRef.current) {
setStatus("Live measurement active");
rafRef.current = requestAnimationFrame(tick);
}
}

async function loadModel() {
setStatus("Loading pose model...");

const vision = await import("@mediapipe/tasks-vision");

const fileset = await vision.FilesetResolver.forVisionTasks(
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
);

poseRef.current = await vision.PoseLandmarker.createFromOptions(fileset, {
baseOptions: {
modelAssetPath:
"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
},
runningMode: "VIDEO",
numPoses: 1,
});

setModelReady(true);
setStatus("Live measurement active");
}

function computeFrontReadout(l: any[]): Readout {
const ls = l[11];
const rs = l[12];
const lh = l[23];
const rh = l[24];
const lk = l[25];
const rk = l[26];
const la = l[27];
const ra = l[28];
const nose = l[0];

if (!ls || !rs || !lh || !rh || !lk || !rk || !la || !ra || !nose) {
return {
state: "unknown",
stability: 0,
alignment: 0,
lean: 0,
};
}

const shoulderMid = midpoint(ls, rs);
const hipMid = midpoint(lh, rh);
const kneeMid = midpoint(lk, rk);
const ankleMid = midpoint(la, ra);

const base = distance(la, ra) + 0.0001;

const shoulderHipOffset = Math.abs(shoulderMid.x - hipMid.x) / base;
const hipAnkleOffset = Math.abs(hipMid.x - ankleMid.x) / base;
const noseOffset = Math.abs(nose.x - hipMid.x) / base;

const verticalError = shoulderHipOffset * 0.9 + hipAnkleOffset * 1.2 + noseOffset * 0.6;
const lean = clamp(hipAnkleOffset, 0, 1);

const hipKneeDepth = Math.abs(hipMid.y - kneeMid.y);
const kneeAnkleDepth = Math.abs(kneeMid.y - ankleMid.y);
const levelBalance = 1 - clamp(Math.abs(lh.y - rh.y) * 5, 0, 1);

const stability = clamp(
100 - verticalError * 55 - Math.abs(hipKneeDepth - kneeAnkleDepth) * 80 + levelBalance * 12,
0,
100
);

const alignment = clamp(100 - verticalError * 85, 0, 100);
const state = getFrontState(stability, alignment, lean);

return { state, stability, alignment, lean };
}

function computeSideReadout(l: any[]): Readout {
const shoulder = l[12] ?? l[11];
const hip = l[24] ?? l[23];
const knee = l[26] ?? l[25];
const ankle = l[28] ?? l[27];
const ear = l[8] ?? l[7] ?? l[0];

if (!shoulder || !hip || !knee || !ankle || !ear) {
return {
state: "unknown",
stability: 0,
alignment: 0,
lean: 0,
};
}

const base = Math.max(Math.abs(hip.y - ankle.y), 0.0001);

const shoulderHipX = Math.abs(shoulder.x - hip.x) / base;
const hipAnkleX = Math.abs(hip.x - ankle.x) / base;
const earHipX = Math.abs(ear.x - hip.x) / base;

const forwardError = shoulderHipX * 0.9 + hipAnkleX * 1.3 + earHipX * 0.8;
const lean = clamp(hipAnkleX, 0, 1);

const hipKneeDepth = Math.abs(hip.y - knee.y);
const kneeAnkleDepth = Math.abs(knee.y - ankle.y);
const segmentBalance = 1 - clamp(Math.abs(hipKneeDepth - kneeAnkleDepth) * 3.5, 0, 1);

const stability = clamp(100 - forwardError * 70 + segmentBalance * 16, 0, 100);
const alignment = clamp(100 - forwardError * 95, 0, 100);
const state = getSideState(stability, alignment, lean);

return { state, stability, alignment, lean };
}

function computeReadout(l: any[]): Readout {
return viewMode === "front" ? computeFrontReadout(l) : computeSideReadout(l);
}

function drawReferenceField(ctx: CanvasRenderingContext2D, w: number, h: number) {
const frameW = w * 0.42;
const frameH = h * 0.65;

const frameX = w / 2 - frameW / 2;
const frameY = h / 2 - frameH / 2;

ctx.strokeStyle = "rgba(255,255,255,0.12)";
ctx.lineWidth = 3;
ctx.strokeRect(frameX, frameY, frameW, frameH);

ctx.strokeStyle = "rgba(255,255,255,0.18)";
ctx.lineWidth = 2;

ctx.beginPath();
ctx.moveTo(w / 2, frameY);
ctx.lineTo(w / 2, frameY + frameH);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(frameX, h / 2);
ctx.lineTo(frameX + frameW, h / 2);
ctx.stroke();
}

function drawOverlay(landmarks: any[] | null, r: Readout) {
const canvas = canvasRef.current;
const video = videoRef.current;

if (!canvas || !video) return;

const ctx = canvas.getContext("2d");
if (!ctx) return;

const w = video.videoWidth || 1280;
const h = video.videoHeight || 720;

canvas.width = w;
canvas.height = h;

ctx.clearRect(0, 0, w, h);

ctx.strokeStyle = "rgba(255,255,255,0.12)";
ctx.lineWidth = 2;

ctx.beginPath();
ctx.moveTo(w / 2, 0);
ctx.lineTo(w / 2, h);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(0, h / 2);
ctx.lineTo(w, h / 2);
ctx.stroke();

drawReferenceField(ctx, w, h);

const color = stateColor(r.state);

if (landmarks?.length) {
const frontPairs: Array<[number, number]> = [
[11, 12],
[11, 23],
[12, 24],
[23, 24],
[23, 25],
[24, 26],
[25, 27],
[26, 28],
];

const sidePairs: Array<[number, number]> = [
[12, 24],
[24, 26],
[26, 28],
[11, 23],
[23, 25],
[25, 27],
];

const pairs = viewMode === "front" ? frontPairs : sidePairs;

ctx.strokeStyle = color;
ctx.lineWidth = 4;

for (const [a, b] of pairs) {
const p1 = landmarks[a];
const p2 = landmarks[b];
if (!p1 || !p2) continue;

ctx.beginPath();
ctx.moveTo(p1.x * w, p1.y * h);
ctx.lineTo(p2.x * w, p2.y * h);
ctx.stroke();
}

ctx.fillStyle = color;

for (const p of landmarks) {
if (!p) continue;
ctx.beginPath();
ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
ctx.fill();
}
}

ctx.fillStyle = "rgba(5,7,10,0.72)";
ctx.fillRect(28, 28, 390, 166);

ctx.fillStyle = "rgba(255,255,255,0.48)";
ctx.font = "18px sans-serif";
ctx.fillText(`AXIS CAMERA / ${viewMode.toUpperCase()} VIEW`, 50, 58);

ctx.fillStyle = color;
ctx.font = "700 46px sans-serif";
ctx.fillText(r.state.toUpperCase(), 50, 104);

ctx.fillStyle = "white";
ctx.font = "24px sans-serif";
ctx.fillText(`STABILITY ${Math.round(r.stability)}%`, 50, 142);
}

function tick() {
const video = videoRef.current;
const pose = poseRef.current;

if (!video || !pose || video.readyState < 2) {
rafRef.current = requestAnimationFrame(tick);
return;
}

const result = pose.detectForVideo(video, performance.now());
const landmarks = result?.landmarks?.[0] ?? null;

let next = readout;
if (landmarks) {
next = computeReadout(landmarks);
setReadout(next);
}

drawOverlay(landmarks, next);
rafRef.current = requestAnimationFrame(tick);
}

useEffect(() => {
let mounted = true;

async function boot() {
try {
await startCamera("environment");
if (!mounted) return;

await loadModel();
if (!mounted) return;

rafRef.current = requestAnimationFrame(tick);
} catch (error) {
console.error(error);
setStatus("Camera or model failed to load");
}
}

boot();

return () => {
mounted = false;

if (rafRef.current) cancelAnimationFrame(rafRef.current);

if (streamRef.current) {
for (const t of streamRef.current.getTracks()) t.stop();
}
};
}, []);

useEffect(() => {
if (!poseRef.current || !cameraReady) return;
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = requestAnimationFrame(tick);
}, [viewMode]);

return (
<main className="h-screen w-screen overflow-hidden bg-black text-white">
<div className="relative h-full w-full">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="absolute inset-0 h-full w-full object-cover"
/>

<canvas
ref={canvasRef}
className="pointer-events-none absolute inset-0 h-full w-full"
/>

<div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 py-4 sm:px-6">
<div>
<div className="text-[11px] tracking-[0.28em] text-white/42">AXIS CAMERA</div>
<div className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
Measurement Instrument
</div>
</div>

<div className="text-right">
<div className="text-[11px] tracking-[0.22em] text-white/38">STATUS</div>
<div className="mt-1 text-sm text-white/75">{status}</div>
</div>
</div>

<div className="absolute left-4 top-24 z-20 flex gap-2 sm:left-6 sm:top-28">
<button
type="button"
onClick={() => setViewMode("front")}
className={`rounded-full border px-4 py-2 text-sm ${
viewMode === "front"
? "border-white/25 bg-white/15 text-white"
: "border-white/10 bg-black/30 text-white/75"
}`}
>
Front View
</button>

<button
type="button"
onClick={() => setViewMode("side")}
className={`rounded-full border px-4 py-2 text-sm ${
viewMode === "side"
? "border-white/25 bg-white/15 text-white"
: "border-white/10 bg-black/30 text-white/75"
}`}
>
Side View
</button>

<button
type="button"
onClick={() =>
restartCamera(cameraFacing === "environment" ? "user" : "environment")
}
className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/75"
>
{cameraFacing === "environment" ? "Use Front Camera" : "Use Back Camera"}
</button>
</div>

<div className="pointer-events-none absolute bottom-0 left-0 right-0 grid gap-3 bg-gradient-to-t from-black/88 via-black/50 to-transparent px-4 pb-4 pt-24 sm:grid-cols-4 sm:px-6">
<div className="rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
<div className="text-[11px] tracking-[0.22em] text-white/45">STATE</div>
<div className="mt-2 text-2xl font-semibold text-white">{readout.state}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
<div className="text-[11px] tracking-[0.22em] text-white/45">STABILITY</div>
<div className="mt-2 text-2xl font-semibold text-white">
{Math.round(readout.stability)}%
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
<div className="text-[11px] tracking-[0.22em] text-white/45">ALIGNMENT</div>
<div className="mt-2 text-2xl font-semibold text-white">
{Math.round(readout.alignment)}%
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
<div className="text-[11px] tracking-[0.22em] text-white/45">LEAN</div>
<div className="mt-2 text-2xl font-semibold text-white">
{readout.lean.toFixed(2)}
</div>
</div>
</div>

{(!cameraReady || !modelReady) && (
<div className="absolute inset-0 flex items-center justify-center bg-black/50">
<div className="rounded-2xl border border-white/10 bg-black/60 px-5 py-4 text-center">
<div className="text-[11px] tracking-[0.24em] text-white/40">AXIS</div>
<div className="mt-2 text-lg text-white/85">{status}</div>
</div>
</div>
)}
</div>
</main>
);
}