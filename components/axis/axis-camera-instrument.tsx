"use client";

import { useEffect, useRef, useState } from "react";

type AxisState = "aligned" | "shift" | "drop" | "recover" | "unknown";

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

function getState(stability: number, alignment: number, lean: number): AxisState {
if (stability > 82 && alignment > 78 && lean < 0.08) return "aligned";
if (stability > 65 && alignment > 55) return "recover";
if (lean > 0.22 || alignment < 40) return "drop";
if (stability > 45) return "shift";
return "unknown";
}

function stateColor(state: AxisState) {
if (state === "aligned") return "#8CFFB5";
if (state === "recover") return "#FFE27A";
if (state === "shift") return "#FFB26B";
if (state === "drop") return "#FF7A7A";
return "#7AB8FF";
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

const [readout, setReadout] = useState<Readout>({
state: "unknown",
stability: 0,
alignment: 0,
lean: 0,
});

async function startCamera() {
setStatus("Requesting camera...");

const stream = await navigator.mediaDevices.getUserMedia({
video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
audio: false,
});

streamRef.current = stream;

if (!videoRef.current) return;

videoRef.current.srcObject = stream;
await videoRef.current.play();

setCameraReady(true);
setStatus("Camera ready");
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

function computeReadout(l: any[]): Readout {
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
return readout;
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

const stability =
clamp(
100 -
verticalError * 55 -
Math.abs(hipKneeDepth - kneeAnkleDepth) * 80 +
levelBalance * 12,
0,
100
);

const alignment = clamp(100 - verticalError * 85, 0, 100);

const state = getState(stability, alignment, lean);

return {
state,
stability,
alignment,
lean,
};
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

ctx.strokeStyle = "rgba(255,255,255,0.15)";
ctx.lineWidth = 2;

ctx.beginPath();
ctx.moveTo(w / 2, 0);
ctx.lineTo(w / 2, h);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(0, h / 2);
ctx.lineTo(w, h / 2);
ctx.stroke();

const color = stateColor(r.state);

if (landmarks?.length) {
const pairs = [
[11, 12],
[11, 23],
[12, 24],
[23, 24],
[23, 25],
[24, 26],
[25, 27],
[26, 28],
];

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
ctx.beginPath();
ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
ctx.fill();
}
}
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

if (landmarks) {
const next = computeReadout(landmarks);
setReadout(next);
drawOverlay(landmarks, next);
}

rafRef.current = requestAnimationFrame(tick);
}

useEffect(() => {
let mounted = true;

async function boot() {
await startCamera();
if (!mounted) return;

await loadModel();
if (!mounted) return;

rafRef.current = requestAnimationFrame(tick);
}

boot();

return () => {
mounted = false;

if (rafRef.current) cancelAnimationFrame(rafRef.current);

if (streamRef.current) {
for (const t of streamRef.current.getTracks()) {
t.stop();
}
}
};
}, []);

return (
<main className="h-screen w-screen bg-black text-white overflow-hidden">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="absolute inset-0 h-full w-full object-cover"
/>

<canvas
ref={canvasRef}
className="absolute inset-0 h-full w-full pointer-events-none"
/>

<div className="absolute bottom-0 left-0 right-0 grid grid-cols-4 gap-3 p-4 bg-gradient-to-t from-black/90">
<div>
<div className="text-xs text-white/50">STATE</div>
<div className="text-2xl">{readout.state}</div>
</div>

<div>
<div className="text-xs text-white/50">STABILITY</div>
<div className="text-2xl">{Math.round(readout.stability)}%</div>
</div>

<div>
<div className="text-xs text-white/50">ALIGNMENT</div>
<div className="text-2xl">{Math.round(readout.alignment)}%</div>
</div>

<div>
<div className="text-xs text-white/50">LEAN</div>
<div className="text-2xl">{readout.lean.toFixed(2)}</div>
</div>
</div>

{!cameraReady || !modelReady ? (
<div className="absolute inset-0 flex items-center justify-center bg-black/70">
<div>{status}</div>
</div>
) : null}
</main>
);
}