"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
Camera,
Play,
Pause,
RotateCcw,
Radar,
Target,
Activity,
ScanLine,
} from "lucide-react";
import {
AxisCameraFrame,
AxisCameraState,
AxisCameraSummary,
calibrateBaseline,
computeAxisFrameFromLandmarks,
drawPoseOverlay,
formatStateLabel,
getStateColor,
scoreFromFrames,
smoothFrame,
} from "@/lib/axis-camera";

type PoseLandmarkerType = any;
type FilesetResolverType = any;

export default function AxisCameraInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const rafRef = useRef<number | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const poseLandmarkerRef = useRef<PoseLandmarkerType | null>(null);
const lastVideoTimeRef = useRef<number>(-1);

const [cameraReady, setCameraReady] = useState(false);
const [modelReady, setModelReady] = useState(false);
const [running, setRunning] = useState(false);
const [calibrating, setCalibrating] = useState(false);
const [status, setStatus] = useState("Idle");

const [frame, setFrame] = useState<AxisCameraFrame | null>(null);
const [history, setHistory] = useState<AxisCameraFrame[]>([]);
const [baseline, setBaseline] = useState<AxisCameraFrame | null>(null);
const [calibrationSamples, setCalibrationSamples] = useState<AxisCameraFrame[]>([]);

const summary: AxisCameraSummary = useMemo(() => {
return scoreFromFrames(history);
}, [history]);

async function setupCamera() {
try {
setStatus("Requesting camera...");
const stream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: "user",
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
} catch (error) {
console.error(error);
setStatus("Camera failed");
}
}

async function setupPoseLandmarker() {
try {
setStatus("Loading model...");

const visionModule = await import("@mediapipe/tasks-vision");
const FilesetResolver: FilesetResolverType = visionModule.FilesetResolver;
const PoseLandmarker: PoseLandmarkerType = visionModule.PoseLandmarker;

const vision = await FilesetResolver.forVisionTasks(
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);

const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
baseOptions: {
modelAssetPath: "/models/pose_landmarker_full.task",
},
runningMode: "VIDEO",
numPoses: 1,
minPoseDetectionConfidence: 0.5,
minPosePresenceConfidence: 0.5,
minTrackingConfidence: 0.5,
});

poseLandmarkerRef.current = poseLandmarker;
setModelReady(true);
setStatus("Model ready");
} catch (error) {
console.error(error);
setStatus("Model failed");
}
}

function stopLoop() {
if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}
setRunning(false);
}

function resetSession() {
stopLoop();
setHistory([]);
setFrame(null);
setBaseline(null);
setCalibrationSamples([]);
setCalibrating(false);
setStatus(cameraReady && modelReady ? "Ready" : "Idle");
}

function cleanupCamera() {
if (streamRef.current) {
for (const track of streamRef.current.getTracks()) track.stop();
streamRef.current = null;
}
}

function resizeCanvasToVideo() {
const video = videoRef.current;
const canvas = canvasRef.current;
if (!video || !canvas) return;

const width = video.videoWidth || 1280;
const height = video.videoHeight || 720;

if (canvas.width !== width) canvas.width = width;
if (canvas.height !== height) canvas.height = height;
}

function processFrame() {
const video = videoRef.current;
const canvas = canvasRef.current;
const poseLandmarker = poseLandmarkerRef.current;

if (!video || !canvas || !poseLandmarker || !running) {
rafRef.current = requestAnimationFrame(processFrame);
return;
}

resizeCanvasToVideo();

if (video.readyState < 2) {
rafRef.current = requestAnimationFrame(processFrame);
return;
}

const nowMs = performance.now();

if (video.currentTime !== lastVideoTimeRef.current) {
lastVideoTimeRef.current = video.currentTime;

const result = poseLandmarker.detectForVideo(video, nowMs);

const landmarks = result?.landmarks?.[0] ?? null;
const worldLandmarks = result?.worldLandmarks?.[0] ?? null;

if (landmarks?.length) {
const nextFrameRaw = computeAxisFrameFromLandmarks(
landmarks,
worldLandmarks,
baseline,
video.videoWidth || 1280,
video.videoHeight || 720,
);

const smoothed = smoothFrame(frame, nextFrameRaw, 0.35);
setFrame(smoothed);
setHistory((prev) => [...prev.slice(-299), smoothed]);

if (calibrating) {
setCalibrationSamples((prev) => [...prev, smoothed].slice(-120));
}

drawPoseOverlay({
canvas,
video,
landmarks,
axisFrame: smoothed,
});
} else {
const ctx = canvas.getContext("2d");
if (ctx) {
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
ctx.fillStyle = "rgba(255,255,255,0.65)";
ctx.font = "18px sans-serif";
ctx.fillText("No body detected", 24, 36);
}
}
}

rafRef.current = requestAnimationFrame(processFrame);
}

function startTracking() {
if (!cameraReady || !modelReady) return;
setRunning(true);
setStatus("Tracking live");
rafRef.current = requestAnimationFrame(processFrame);
}

function pauseTracking() {
setStatus("Paused");
stopLoop();
}

function beginCalibration() {
setCalibrationSamples([]);
setCalibrating(true);
setStatus("Calibrating 2 seconds...");
}

useEffect(() => {
if (!calibrating) return;

if (calibrationSamples.length >= 40) {
const nextBaseline = calibrateBaseline(calibrationSamples);
setBaseline(nextBaseline);
setCalibrating(false);
setStatus("Baseline locked");
}
}, [calibrating, calibrationSamples]);

useEffect(() => {
void setupCamera();
void setupPoseLandmarker();

return () => {
stopLoop();
cleanupCamera();
};
}, []);

const state: AxisCameraState = frame?.state ?? "SEARCHING";
const stateColor = getStateColor(state);

return (
<div className="min-h-screen bg-[#050816] text-white">
<div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4 md:px-6 md:py-6">
<div className="mb-4 flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur md:flex-row md:items-center md:justify-between">
<div>
<div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-white/50">
<Radar className="h-3.5 w-3.5" />
Axis Camera
</div>
<h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
Axis Body Tracking / Camera Instrument
</h1>
<p className="mt-1 max-w-3xl text-sm text-white/55 md:text-base">
Camera-based structure tracking using pose landmarks to estimate body center,
axis line, lateral shift, drop, and stability from a live video stream.
</p>
</div>

<div className="flex flex-wrap gap-2">
<button
onClick={startTracking}
disabled={!cameraReady || !modelReady || running}
className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-40"
>
<Play className="h-4 w-4" />
Start
</button>

<button
onClick={pauseTracking}
disabled={!running}
className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
>
<Pause className="h-4 w-4" />
Pause
</button>

<button
onClick={beginCalibration}
disabled={!running}
className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
>
<ScanLine className="h-4 w-4" />
Calibrate
</button>

<button
onClick={resetSession}
className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
>
<RotateCcw className="h-4 w-4" />
Reset
</button>
</div>
</div>

<div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(640px,1fr)_360px]">
<div className="order-2 flex flex-col gap-4 xl:order-1">
<MetricCard
icon={<Camera className="h-4 w-4" />}
label="Status"
value={status}
sub={`Camera ${cameraReady ? "ready" : "loading"} · Model ${modelReady ? "ready" : "loading"}`}
/>
<MetricCard
icon={<Activity className="h-4 w-4" />}
label="State"
value={formatStateLabel(state)}
sub={`Confidence ${frame ? Math.round(frame.visibility * 100) : 0}%`}
/>
<MetricCard
icon={<Target className="h-4 w-4" />}
label="Stability"
value={frame ? `${Math.round(frame.stability * 100)}` : "0"}
sub={`Shift ${frame ? frame.shiftX.toFixed(1) : "0.0"} · Drop ${frame ? frame.dropY.toFixed(1) : "0.0"}`}
/>

<div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
<div className="text-[11px] uppercase tracking-[0.25em] text-white/45">
Calibration
</div>
<div className="mt-3 text-sm text-white/70">
Stand upright in the center of frame, full body visible, then tap
<span className="font-semibold text-white"> Calibrate</span>.
</div>
<div className="mt-3 text-xs text-white/45">
{baseline
? "Baseline locked. Tracking compares live structure against your neutral setup."
: "No baseline yet. Tracking still works, but state quality improves after calibration."}
</div>
</div>
</div>

<div className="order-1 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),rgba(255,255,255,0.02)_30%,rgba(0,0,0,0)_68%)] p-3 md:p-5 xl:order-2">
<div className="relative flex min-h-[720px] items-center justify-center overflow-hidden rounded-[2rem] border border-white/10 bg-[#070b1e]">
<div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />

<div className="relative aspect-video w-full overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="absolute inset-0 h-full w-full object-cover"
/>
<canvas
ref={canvasRef}
className="absolute inset-0 h-full w-full"
/>

<div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">
Axis State
</div>
<div
className="mt-1 text-lg font-semibold"
style={{ color: stateColor }}
>
{formatStateLabel(state)}
</div>
</div>

<div className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">
Stability
</div>
<div className="mt-1 text-lg font-semibold">
{frame ? Math.round(frame.stability * 100) : 0}
</div>
</div>

<div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur">
<div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
<StatMini
label="Axis Angle"
value={frame ? `${frame.axisAngleDeg.toFixed(1)}°` : "0.0°"}
/>
<StatMini
label="Shift"
value={frame ? `${frame.shiftX.toFixed(1)}` : "0.0"}
/>
<StatMini
label="Drop"
value={frame ? `${frame.dropY.toFixed(1)}` : "0.0"}
/>
<StatMini
label="Visible"
value={frame ? `${Math.round(frame.visibility * 100)}%` : "0%"}
/>
</div>
</div>
</div>
</div>
</div>

<div className="order-3 flex flex-col gap-4">
<div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
<div className="text-[11px] uppercase tracking-[0.25em] text-white/45">
Session Read
</div>
<div className="mt-3 space-y-3">
<ReadRow label="Frames" value={String(summary.frames)} />
<ReadRow label="Axis %" value={`${summary.axisPct}%`} />
<ReadRow label="Shift %" value={`${summary.shiftPct}%`} />
<ReadRow label="Drop %" value={`${summary.dropPct}%`} />
<ReadRow label="Off Axis %" value={`${summary.offAxisPct}%`} />
</div>
</div>

<div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
<div className="text-[11px] uppercase tracking-[0.25em] text-white/45">
What this is reading
</div>
<div className="mt-3 space-y-2 text-sm text-white/65">
<p>• shoulder midpoint</p>
<p>• hip midpoint</p>
<p>• body center</p>
<p>• axis line angle</p>
<p>• lateral shift from baseline</p>
<p>• vertical drop from baseline</p>
</div>
</div>
</div>
</div>
</div>
</div>
);
}

function MetricCard({
icon,
label,
value,
sub,
}: {
icon: React.ReactNode;
label: string;
value: string;
sub: string;
}) {
return (
<div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
<div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-white/45">
{icon}
{label}
</div>
<div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
<div className="mt-1 text-sm text-white/45">{sub}</div>
</div>
);
}

function StatMini({ label, value }: { label: string; value: string }) {
return (
<div>
<div className="text-[10px] uppercase tracking-[0.24em] text-white/45">
{label}
</div>
<div className="mt-1 font-semibold text-white">{value}</div>
</div>
);
}

function ReadRow({ label, value }: { label: string; value: string }) {
return (
<div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
<div className="text-sm text-white/55">{label}</div>
<div className="text-sm font-semibold text-white">{value}</div>
</div>
);
}