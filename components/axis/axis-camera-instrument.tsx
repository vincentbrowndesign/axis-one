"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as posedetection from "@tensorflow-models/pose-detection";
import "@tensorflow/tfjs-backend-webgl";

type AxisState = "SEARCHING" | "ALIGNED" | "SHIFT" | "DROP" | "LOST";
type CameraFacing = "user" | "environment";

type JointPoint = {
x: number;
y: number;
score: number;
};

type PoseMetrics = {
ready: boolean;
state: AxisState;
confidence: number;
stability: number;
verticalStack: number;
torsoLean: number;
hipOverBase: number;
kneeFlex: number;
shoulderLevel: number;
frameCoverage: number;
signal: number[];
};

type RepRecord = {
id: string;
startedAt: number;
endedAt: number;
peakState: AxisState;
avgStability: number;
peakInstability: number;
made?: boolean;
notes: string;
};

const KEYPOINT_MIN_SCORE = 0.3;
const SIGNAL_BUFFER = 120;
const ANALYSIS_INTERVAL_MS = 70;

const VIDEO_W = 1280;
const VIDEO_H = 720;

const STATE_ORDER: AxisState[] = ["SEARCHING", "ALIGNED", "SHIFT", "DROP", "LOST"];

const STATE_LABEL: Record<AxisState, string> = {
SEARCHING: "SEARCHING",
ALIGNED: "ALIGNED",
SHIFT: "SHIFT",
DROP: "DROP",
LOST: "LOST",
};

const STATE_COLOR: Record<AxisState, string> = {
SEARCHING: "#8B8B8B",
ALIGNED: "#33d17a",
SHIFT: "#ffd84d",
DROP: "#ff9f40",
LOST: "#ff4d4f",
};

function clamp(value: number, min: number, max: number): number {
return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
return a + (b - a) * t;
}

function mean(values: number[]): number {
if (!values.length) return 0;
return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function smoothstep(value: number, edge0: number, edge1: number): number {
const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
return t * t * (3 - 2 * t);
}

function nowId(): string {
return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPoint(
pose: posedetection.Pose,
name: string,
): JointPoint | null {
const point = pose.keypoints.find((kp) => kp.name === name);
if (!point) return null;
const score = point.score ?? 0;
if (score < KEYPOINT_MIN_SCORE) return null;
return { x: point.x, y: point.y, score };
}

function midpoint(a: JointPoint | null, b: JointPoint | null): JointPoint | null {
if (!a || !b) return null;
return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
score: Math.min(a.score, b.score),
};
}

function distance(a: JointPoint | null, b: JointPoint | null): number {
if (!a || !b) return 0;
return Math.hypot(a.x - b.x, a.y - b.y);
}

function safeDiv(n: number, d: number): number {
return d === 0 ? 0 : n / d;
}

function getBaseScale(pose: posedetection.Pose): number {
const ls = getPoint(pose, "left_shoulder");
const rs = getPoint(pose, "right_shoulder");
const lh = getPoint(pose, "left_hip");
const rh = getPoint(pose, "right_hip");
const la = getPoint(pose, "left_ankle");
const ra = getPoint(pose, "right_ankle");

const shoulderWidth = distance(ls, rs);
const hipWidth = distance(lh, rh);
const ankleWidth = distance(la, ra);
const torsoHeight = distance(midpoint(ls, rs), midpoint(lh, rh));

return Math.max(shoulderWidth, hipWidth, ankleWidth * 0.75, torsoHeight * 0.7, 40);
}

function getBodyCoverage(pose: posedetection.Pose, width: number, height: number): number {
const visible = pose.keypoints.filter((kp) => (kp.score ?? 0) >= KEYPOINT_MIN_SCORE);
if (!visible.length) return 0;

const xs = visible.map((p) => p.x);
const ys = visible.map((p) => p.y);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);

const boxArea = Math.max(1, (maxX - minX) * (maxY - minY));
return clamp(boxArea / Math.max(1, width * height), 0, 1);
}

function analyzePose(
pose: posedetection.Pose,
videoWidth: number,
videoHeight: number,
priorSignal: number[],
): PoseMetrics {
const nose = getPoint(pose, "nose");
const ls = getPoint(pose, "left_shoulder");
const rs = getPoint(pose, "right_shoulder");
const le = getPoint(pose, "left_elbow");
const re = getPoint(pose, "right_elbow");
const lh = getPoint(pose, "left_hip");
const rh = getPoint(pose, "right_hip");
const lk = getPoint(pose, "left_knee");
const rk = getPoint(pose, "right_knee");
const la = getPoint(pose, "left_ankle");
const ra = getPoint(pose, "right_ankle");

const shoulderMid = midpoint(ls, rs);
const hipMid = midpoint(lh, rh);
const ankleMid = midpoint(la, ra);

const baseScale = getBaseScale(pose);
const frameCoverage = getBodyCoverage(pose, videoWidth, videoHeight);

const essentialReady = Boolean(shoulderMid && hipMid && (la || ra));
if (!essentialReady) {
const searchingSignal = [...priorSignal, 10].slice(-SIGNAL_BUFFER);
return {
ready: false,
state: "SEARCHING",
confidence: 0,
stability: 10,
verticalStack: 0,
torsoLean: 1,
hipOverBase: 1,
kneeFlex: 0,
shoulderLevel: 1,
frameCoverage,
signal: searchingSignal,
};
}

const headX = nose?.x ?? shoulderMid!.x;
const chestX = shoulderMid!.x;
const hipX = hipMid!.x;
const baseX = ankleMid?.x ?? hipMid!.x;

const verticalStackRaw =
(Math.abs(headX - chestX) + Math.abs(chestX - hipX)) / Math.max(baseScale, 1);
const verticalStack = clamp(1 - verticalStackRaw / 0.45, 0, 1);

const torsoLeanRaw = Math.abs(chestX - hipX) / Math.max(baseScale, 1);
const torsoLean = clamp(1 - torsoLeanRaw / 0.35, 0, 1);

const ankleSpread = Math.max(distance(la, ra), baseScale * 0.75);
const hipOverBaseRaw = Math.abs(hipX - baseX) / Math.max(ankleSpread * 0.75, 1);
const hipOverBase = clamp(1 - hipOverBaseRaw / 0.9, 0, 1);

const shoulderLevelRaw = ls && rs ? Math.abs(ls.y - rs.y) / Math.max(baseScale, 1) : 0;
const shoulderLevel = clamp(1 - shoulderLevelRaw / 0.35, 0, 1);

const leftKneeFlex = lh && lk && la ? safeDiv(Math.abs(lh.y - lk.y), Math.abs(la.y - lh.y) + 1) : 0.45;
const rightKneeFlex = rh && rk && ra ? safeDiv(Math.abs(rh.y - rk.y), Math.abs(ra.y - rh.y) + 1) : 0.45;
const kneeFlexRaw = mean([leftKneeFlex, rightKneeFlex]);
const kneeFlex = clamp(smoothstep(kneeFlexRaw, 0.18, 0.55), 0, 1);

const pointScores = [
nose?.score ?? 0,
ls?.score ?? 0,
rs?.score ?? 0,
le?.score ?? 0,
re?.score ?? 0,
lh?.score ?? 0,
rh?.score ?? 0,
lk?.score ?? 0,
rk?.score ?? 0,
la?.score ?? 0,
ra?.score ?? 0,
].filter(Boolean);

const confidence = clamp(mean(pointScores), 0, 1);

const coverageScore = clamp(smoothstep(frameCoverage, 0.08, 0.32), 0, 1);

const rawStability =
verticalStack * 0.28 +
torsoLean * 0.26 +
hipOverBase * 0.26 +
shoulderLevel * 0.08 +
kneeFlex * 0.05 +
coverageScore * 0.07;

const stability = Math.round(clamp(rawStability * confidence * 100, 0, 100));

let state: AxisState = "ALIGNED";
if (confidence < 0.38 || coverageScore < 0.2) state = "SEARCHING";
else if (stability >= 78) state = "ALIGNED";
else if (stability >= 58) state = "SHIFT";
else if (stability >= 36) state = "DROP";
else state = "LOST";

const nextSignal = [...priorSignal, stability].slice(-SIGNAL_BUFFER);

return {
ready: true,
state,
confidence,
stability,
verticalStack,
torsoLean,
hipOverBase,
kneeFlex,
shoulderLevel,
frameCoverage,
signal: nextSignal,
};
}

function getRepNote(avg: number, peakInstability: number, peakState: AxisState): string {
if (peakState === "ALIGNED" && avg >= 82) return "Repeatable structure.";
if (peakState === "SHIFT") return "Slight drift through the rep.";
if (peakState === "DROP") return "Structure dropped before or during action.";
if (peakState === "LOST") return "Body broke outside its base.";
if (peakInstability > 50) return "Late instability spike detected.";
return "Signal captured.";
}

export default function AxisCameraPlacementTolerant() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const overlayRef = useRef<HTMLCanvasElement | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const detectorRef = useRef<posedetection.PoseDetector | null>(null);
const loopRef = useRef<number | null>(null);
const lastRunRef = useRef(0);
const signalRef = useRef<number[]>([]);
const repWindowRef = useRef<number[]>([]);
const repActiveRef = useRef(false);
const repStartRef = useRef<number | null>(null);
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const mediaChunksRef = useRef<Blob[]>([]);
const recordStreamRef = useRef<MediaStream | null>(null);

const [booting, setBooting] = useState(true);
const [enabled, setEnabled] = useState(false);
const [facingMode, setFacingMode] = useState<CameraFacing>("environment");
const [error, setError] = useState("");
const [metrics, setMetrics] = useState<PoseMetrics>({
ready: false,
state: "SEARCHING",
confidence: 0,
stability: 10,
verticalStack: 0,
torsoLean: 1,
hipOverBase: 1,
kneeFlex: 0,
shoulderLevel: 1,
frameCoverage: 0,
signal: [],
});
const [isRecording, setIsRecording] = useState(false);
const [reps, setReps] = useState<RepRecord[]>([]);
const [lastClipUrl, setLastClipUrl] = useState<string>("");
const [lastClipMade, setLastClipMade] = useState<boolean | undefined>(undefined);

const signalBars = useMemo(() => {
return metrics.signal.map((value, idx) => {
let color = STATE_COLOR.SEARCHING;
if (value >= 78) color = STATE_COLOR.ALIGNED;
else if (value >= 58) color = STATE_COLOR.SHIFT;
else if (value >= 36) color = STATE_COLOR.DROP;
else color = STATE_COLOR.LOST;
return { id: `${idx}-${value}`, value, color };
});
}, [metrics.signal]);

useEffect(() => {
let mounted = true;

async function setupDetector() {
try {
await posedetection.createDetector(posedetection.SupportedModels.MoveNet, {
modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
enableSmoothing: true,
}).then((detector) => {
if (!mounted) return;
detectorRef.current = detector;
});
} catch (err) {
console.error(err);
if (mounted) setError("Pose model failed to load.");
} finally {
if (mounted) setBooting(false);
}
}

setupDetector();

return () => {
mounted = false;
};
}, []);

useEffect(() => {
return () => {
stopCamera();
if (lastClipUrl) URL.revokeObjectURL(lastClipUrl);
};
}, [lastClipUrl]);

async function startCamera(nextFacingMode = facingMode) {
try {
setError("");
stopCamera();

const stream = await navigator.mediaDevices.getUserMedia({
audio: false,
video: {
facingMode: { ideal: nextFacingMode },
width: { ideal: VIDEO_W },
height: { ideal: VIDEO_H },
frameRate: { ideal: 30, max: 30 },
},
});

const video = videoRef.current;
if (!video) return;

streamRef.current = stream;
video.srcObject = stream;
await video.play();

setEnabled(true);
startLoop();
} catch (err) {
console.error(err);
setError("Camera access failed.");
setEnabled(false);
}
}

function stopCamera() {
if (loopRef.current) {
cancelAnimationFrame(loopRef.current);
loopRef.current = null;
}

if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
mediaRecorderRef.current.stop();
}

streamRef.current?.getTracks().forEach((track) => track.stop());
streamRef.current = null;

recordStreamRef.current?.getTracks().forEach((track) => track.stop());
recordStreamRef.current = null;

const video = videoRef.current;
if (video) video.srcObject = null;

setEnabled(false);
setIsRecording(false);
}

function startLoop() {
if (loopRef.current) cancelAnimationFrame(loopRef.current);

const run = async (ts: number) => {
loopRef.current = requestAnimationFrame(run);
if (!videoRef.current || !detectorRef.current) return;
if (videoRef.current.readyState < 2) return;
if (ts - lastRunRef.current < ANALYSIS_INTERVAL_MS) return;
lastRunRef.current = ts;

const video = videoRef.current;
const detector = detectorRef.current;
const overlay = overlayRef.current;
if (!overlay) return;

overlay.width = video.videoWidth;
overlay.height = video.videoHeight;

const poses = await detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false });
const pose = poses[0];

if (!pose) {
const nextMetrics: PoseMetrics = {
ready: false,
state: "SEARCHING",
confidence: 0,
stability: 10,
verticalStack: 0,
torsoLean: 1,
hipOverBase: 1,
kneeFlex: 0,
shoulderLevel: 1,
frameCoverage: 0,
signal: [...signalRef.current, 10].slice(-SIGNAL_BUFFER),
};
signalRef.current = nextMetrics.signal;
setMetrics(nextMetrics);
drawOverlay(null, nextMetrics);
trackRep(nextMetrics);
return;
}

const nextMetrics = analyzePose(pose, video.videoWidth, video.videoHeight, signalRef.current);
signalRef.current = nextMetrics.signal;
setMetrics(nextMetrics);
drawOverlay(pose, nextMetrics);
trackRep(nextMetrics);
};

loopRef.current = requestAnimationFrame(run);
}

function drawLine(
ctx: CanvasRenderingContext2D,
a: JointPoint | null,
b: JointPoint | null,
color: string,
width = 4,
) {
if (!a || !b) return;
ctx.beginPath();
ctx.moveTo(a.x, a.y);
ctx.lineTo(b.x, b.y);
ctx.strokeStyle = color;
ctx.lineWidth = width;
ctx.lineCap = "round";
ctx.stroke();
}

function drawCircle(
ctx: CanvasRenderingContext2D,
p: JointPoint | null,
r: number,
fill: string,
) {
if (!p) return;
ctx.beginPath();
ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
ctx.fillStyle = fill;
ctx.fill();
}

function drawOverlay(pose: posedetection.Pose | null, nextMetrics: PoseMetrics) {
const canvas = overlayRef.current;
if (!canvas) return;
const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.clearRect(0, 0, canvas.width, canvas.height);

const accent = STATE_COLOR[nextMetrics.state];

ctx.strokeStyle = accent;
ctx.lineWidth = 2;
ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

const labelW = 220;
const labelH = 54;
ctx.fillStyle = "rgba(0,0,0,0.58)";
ctx.fillRect(28, 28, labelW, labelH);
ctx.fillStyle = accent;
ctx.font = "600 16px Inter, ui-sans-serif, system-ui";
ctx.fillText("STATE", 42, 50);
ctx.font = "700 24px Inter, ui-sans-serif, system-ui";
ctx.fillText(STATE_LABEL[nextMetrics.state], 42, 76);

if (!pose) return;

const nose = getPoint(pose, "nose");
const ls = getPoint(pose, "left_shoulder");
const rs = getPoint(pose, "right_shoulder");
const lh = getPoint(pose, "left_hip");
const rh = getPoint(pose, "right_hip");
const lk = getPoint(pose, "left_knee");
const rk = getPoint(pose, "right_knee");
const la = getPoint(pose, "left_ankle");
const ra = getPoint(pose, "right_ankle");
const shoulderMid = midpoint(ls, rs);
const hipMid = midpoint(lh, rh);
const ankleMid = midpoint(la, ra);

drawLine(ctx, ls, rs, accent, 5);
drawLine(ctx, lh, rh, accent, 5);
drawLine(ctx, ls, lh, accent, 4);
drawLine(ctx, rs, rh, accent, 4);
drawLine(ctx, lh, lk, accent, 4);
drawLine(ctx, rh, rk, accent, 4);
drawLine(ctx, lk, la, accent, 4);
drawLine(ctx, rk, ra, accent, 4);
drawLine(ctx, shoulderMid, hipMid, accent, 5);
drawLine(ctx, hipMid, ankleMid, accent, 4);

drawCircle(ctx, nose, 7, accent);
drawCircle(ctx, shoulderMid, 8, accent);
drawCircle(ctx, hipMid, 8, accent);
drawCircle(ctx, la, 7, accent);
drawCircle(ctx, ra, 7, accent);

if (shoulderMid && hipMid && ankleMid) {
ctx.setLineDash([8, 8]);
ctx.beginPath();
ctx.moveTo(ankleMid.x, ankleMid.y - 120);
ctx.lineTo(ankleMid.x, ankleMid.y + 30);
ctx.strokeStyle = "rgba(255,255,255,0.4)";
ctx.lineWidth = 2;
ctx.stroke();
ctx.setLineDash([]);
}
}

function trackRep(nextMetrics: PoseMetrics) {
repWindowRef.current.push(nextMetrics.stability);
if (repWindowRef.current.length > 90) repWindowRef.current.shift();

const movingAvg = mean(repWindowRef.current.slice(-6));
const currentlyActive = nextMetrics.ready && movingAvg >= 48;

if (currentlyActive && !repActiveRef.current) {
repActiveRef.current = true;
repStartRef.current = Date.now();
if (!isRecording) beginClipRecording();
}

if (!currentlyActive && repActiveRef.current) {
repActiveRef.current = false;
const start = repStartRef.current ?? Date.now();
const ended = Date.now();
const repValues = repWindowRef.current.slice(-30);
const avgStability = Math.round(mean(repValues));
const peakInstability = Math.max(0, 100 - Math.min(...repValues, 100));
const repState = derivePeakState(repValues);
const notes = getRepNote(avgStability, peakInstability, repState);

setReps((prev) => [
{
id: nowId(),
startedAt: start,
endedAt: ended,
peakState: repState,
avgStability,
peakInstability,
made: lastClipMade,
notes,
},
...prev,
].slice(0, 8));

repStartRef.current = null;
if (isRecording) endClipRecording();
}
}

function derivePeakState(values: number[]): AxisState {
const avg = mean(values);
if (avg >= 78) return "ALIGNED";
if (avg >= 58) return "SHIFT";
if (avg >= 36) return "DROP";
return "LOST";
}

function beginClipRecording() {
const canvas = canvasRef.current;
const overlay = overlayRef.current;
const video = videoRef.current;
if (!canvas || !overlay || !video) return;

const draw = () => {
const ctx = canvas.getContext("2d");
if (!ctx || !video) return;
canvas.width = video.videoWidth || VIDEO_W;
canvas.height = video.videoHeight || VIDEO_H;
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
if (overlay.width && overlay.height) {
ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
}
if (isRecording) requestAnimationFrame(draw);
};

const stream = canvas.captureStream(30);
recordStreamRef.current = stream;
const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
? "video/webm;codecs=vp9"
: "video/webm";

const recorder = new MediaRecorder(stream, { mimeType });
mediaChunksRef.current = [];

recorder.ondataavailable = (event) => {
if (event.data.size > 0) mediaChunksRef.current.push(event.data);
};

recorder.onstop = () => {
const blob = new Blob(mediaChunksRef.current, { type: mimeType });
if (lastClipUrl) URL.revokeObjectURL(lastClipUrl);
const url = URL.createObjectURL(blob);
setLastClipUrl(url);
recordStreamRef.current?.getTracks().forEach((track) => track.stop());
recordStreamRef.current = null;
};

mediaRecorderRef.current = recorder;
setIsRecording(true);
recorder.start();
requestAnimationFrame(draw);
}

function endClipRecording() {
if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
mediaRecorderRef.current.stop();
}
setIsRecording(false);
}

async function toggleCamera() {
const next: CameraFacing = facingMode === "user" ? "environment" : "user";
setFacingMode(next);
await startCamera(next);
}

function markShot(made: boolean) {
setLastClipMade(made);
setReps((prev) => {
if (!prev.length) return prev;
const [first, ...rest] = prev;
return [{ ...first, made }, ...rest];
});
}

const instrumentTone = useMemo(() => {
const s = metrics.stability;
if (s >= 78) return "Repeatable structure";
if (s >= 58) return "Slight drift";
if (s >= 36) return "Structure dropped";
return "Body broke outside base";
}, [metrics.stability]);

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Axis Instrument</div>
<h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">Structure Through Space + Time</h1>
<p className="mt-2 max-w-3xl text-sm text-white/60 md:text-base">
This version is camera-placement tolerant by normalizing to your body proportions instead of screen position.
It works best front view, slight angle, tripod, phone, laptop, or external webcam.
</p>
</div>

<div className="flex flex-wrap gap-3">
<button
onClick={() => (enabled ? stopCamera() : startCamera())}
className="rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90"
disabled={booting}
>
{enabled ? "Stop Camera" : booting ? "Loading Model" : "Start Camera"}
</button>
<button
onClick={toggleCamera}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
disabled={!enabled}
>
Flip Camera
</button>
</div>
</div>

{error ? (
<div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
{error}
</div>
) : null}

<div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
<div className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl shadow-black/30">
<div className="relative aspect-video w-full bg-black">
<video
ref={videoRef}
className="absolute inset-0 h-full w-full object-cover"
muted
playsInline
autoPlay
/>
<canvas ref={overlayRef} className="absolute inset-0 h-full w-full object-cover" />
<canvas ref={canvasRef} className="hidden" />

<div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 backdrop-blur-md">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">State</div>
<div className="mt-1 text-2xl font-semibold" style={{ color: STATE_COLOR[metrics.state] }}>
{STATE_LABEL[metrics.state]}
</div>
</div>

<div className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 backdrop-blur-md text-right">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Stability</div>
<div className="mt-1 text-2xl font-semibold">{metrics.stability}</div>
</div>

<div className="absolute bottom-4 left-4 right-4 rounded-[24px] border border-white/10 bg-black/60 p-4 backdrop-blur-md">
<div className="mb-2 flex items-center justify-between gap-4">
<div>
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Structure Signal</div>
<div className="mt-1 text-sm text-white/75">{instrumentTone}</div>
</div>
<div className="flex items-center gap-2 text-xs text-white/55">
<span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATE_COLOR.ALIGNED }} />
aligned
<span className="inline-block h-2.5 w-2.5 rounded-full ml-2" style={{ backgroundColor: STATE_COLOR.SHIFT }} />
shift
<span className="inline-block h-2.5 w-2.5 rounded-full ml-2" style={{ backgroundColor: STATE_COLOR.DROP }} />
drop
<span className="inline-block h-2.5 w-2.5 rounded-full ml-2" style={{ backgroundColor: STATE_COLOR.LOST }} />
lost
</div>
</div>

<div className="flex h-12 items-end gap-[3px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-2">
{signalBars.length ? (
signalBars.map((bar) => (
<div
key={bar.id}
className="min-w-[4px] flex-1 rounded-full"
style={{
height: `${clamp(bar.value, 8, 100)}%`,
backgroundColor: bar.color,
}}
/>
))
) : (
<div className="flex w-full items-center justify-center text-xs uppercase tracking-[0.26em] text-white/30">
waiting for signal
</div>
)}
</div>
</div>
</div>
</div>

<div className="flex flex-col gap-6">
<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Placement Robustness</div>
<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
<MetricCard label="Confidence" value={`${Math.round(metrics.confidence * 100)}%`} />
<MetricCard label="Frame Coverage" value={`${Math.round(metrics.frameCoverage * 100)}%`} />
<MetricCard label="Vertical Stack" value={`${Math.round(metrics.verticalStack * 100)}%`} />
<MetricCard label="Torso Lean" value={`${Math.round(metrics.torsoLean * 100)}%`} />
<MetricCard label="Hip Over Base" value={`${Math.round(metrics.hipOverBase * 100)}%`} />
<MetricCard label="Shoulder Level" value={`${Math.round(metrics.shoulderLevel * 100)}%`} />
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="flex items-center justify-between gap-3">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Rep Review</div>
<div className="mt-2 text-lg font-semibold">Record live. Review the rep after.</div>
</div>
<div className={`rounded-full px-3 py-1 text-xs font-semibold ${isRecording ? "bg-red-500/15 text-red-300" : "bg-white/5 text-white/55"}`}>
{isRecording ? "Recording" : "Idle"}
</div>
</div>

<div className="mt-4 flex gap-3">
<button
onClick={() => markShot(true)}
className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-black"
>
Mark Made
</button>
<button
onClick={() => markShot(false)}
className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white"
>
Mark Missed
</button>
</div>

{lastClipUrl ? (
<div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
<video src={lastClipUrl} controls className="aspect-video w-full" />
</div>
) : (
<div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
Complete a rep and the most recent clip will appear here.
</div>
)}
</div>

<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Recent Reps</div>
<div className="mt-4 space-y-3">
{reps.length ? (
reps.map((rep) => (
<div key={rep.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
<div className="flex items-center justify-between gap-4">
<div className="text-sm font-semibold" style={{ color: STATE_COLOR[rep.peakState] }}>
{rep.peakState}
</div>
<div className="text-xs text-white/45">
{Math.max(0.2, (rep.endedAt - rep.startedAt) / 1000).toFixed(1)}s
</div>
</div>
<div className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
<span className="rounded-full border border-white/10 px-2 py-1">avg {rep.avgStability}</span>
<span className="rounded-full border border-white/10 px-2 py-1">peak instability {rep.peakInstability}</span>
{typeof rep.made === "boolean" ? (
<span className="rounded-full border border-white/10 px-2 py-1">{rep.made ? "made" : "missed"}</span>
) : null}
</div>
<div className="mt-2 text-sm text-white/70">{rep.notes}</div>
</div>
))
) : (
<div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
No reps captured yet.
</div>
)}
</div>
</div>
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5 text-sm text-white/65">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Important</div>
<div className="mt-3 grid gap-2 md:grid-cols-3">
<p>
This is <span className="font-semibold text-white">placement tolerant</span>, not mathematically perfect for every angle.
It normalizes by body proportions so zoom and distance matter less.
</p>
<p>
Best results: full body visible, camera chest-to-waist height, slight angle or front view, stable tripod, good light.
</p>
<p>
If you want true all-angle robustness later, the next step is multi-camera fusion or adding depth / IMU sensors.
</p>
</div>
</div>
</div>
</div>
);
}

function MetricCard({ label, value }: { label: string; value: string }) {
return (
<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
<div className="text-[10px] uppercase tracking-[0.24em] text-white/40">{label}</div>
<div className="mt-2 text-lg font-semibold text-white">{value}</div>
</div>
);
}