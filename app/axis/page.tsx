"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";

type AxisState =
| "WAIT"
| "CALIBRATING"
| "MOVE BACK"
| "CENTER"
| "SHOW BASE"
| "NOT READY"
| "PARTIAL"
| "READY"
| "LOCKED"
| "LOST";

type FacingMode = "user" | "environment";

type Point = {
x: number;
y: number;
score: number;
};

type CaptureItem = {
id: string;
state: AxisState;
score: number;
timestamp: number;
label: string;
dataUrl: string;
};

type BaselineSample = {
shoulderAngle: number;
hipAngle: number;
torsoMidXNorm: number;
torsoHeightNorm: number;
shoulderWidthNorm: number;
hipWidthNorm: number;
baseRatio: number | null;
};

type Baseline = {
shoulderAngle: number;
hipAngle: number;
torsoMidXNorm: number;
torsoHeightNorm: number;
shoulderWidthNorm: number;
hipWidthNorm: number;
baseRatio: number | null;
};

const STATE_GLOW: Record<AxisState, string> = {
WAIT: "rgba(255,255,255,0.08)",
CALIBRATING: "rgba(120,180,255,0.14)",
"MOVE BACK": "rgba(120,180,255,0.14)",
CENTER: "rgba(120,180,255,0.14)",
"SHOW BASE": "rgba(120,180,255,0.14)",
"NOT READY": "rgba(255,90,90,0.16)",
PARTIAL: "rgba(255,190,80,0.14)",
READY: "rgba(115,255,170,0.14)",
LOCKED: "rgba(80,255,150,0.18)",
LOST: "rgba(160,160,160,0.12)",
};

const MIN_PAIR_SCORE = 0.2;
const MIN_POINT_SCORE = 0.2;
const STATE_HOLD_MS = 300;
const AUTO_CAPTURE_COOLDOWN_MS = 1200;
const BEST_CAPTURE_COOLDOWN_MS = 1500;
const CALIBRATION_MS = 1800;

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
return a + (b - a) * t;
}

function distance(a: Point, b: Point) {
return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
score: Math.min(a.score, b.score),
};
}

function angleDeg(a: Point, b: Point) {
return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function normalizeAngleAbs(deg: number) {
const normalized = ((deg % 180) + 180) % 180;
const lineAngle = normalized > 90 ? normalized - 180 : normalized;
return Math.abs(lineAngle);
}

function createFileName(
kind: string,
state: AxisState,
timestamp: number,
ext: string,
) {
const d = new Date(timestamp);
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
return `AXIS_READY_${kind}_${state.replace(/\s+/g, "_")}_${stamp}.${ext}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
const parts = dataUrl.split(",");
const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
const binary = atob(parts[1]);
const len = binary.length;
const bytes = new Uint8Array(len);

for (let i = 0; i < len; i += 1) {
bytes[i] = binary.charCodeAt(i);
}

return new Blob([bytes], { type: mime });
}

function downloadBlob(blob: Blob, filename: string) {
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
a.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareOrDownloadBlob(blob: Blob, filename: string) {
const file = new File([blob], filename, { type: blob.type });
const nav = navigator as Navigator & {
canShare?: (data?: ShareData) => boolean;
};

if (navigator.share && nav.canShare?.({ files: [file] })) {
await navigator.share({
title: filename,
files: [file],
});
return;
}

downloadBlob(blob, filename);
}

async function initTfBackend() {
await tf.ready();
if (tf.getBackend() === "webgl") return;
const ok = await tf.setBackend("webgl");
if (!ok) throw new Error("TensorFlow WebGL backend could not be initialized.");
await tf.ready();
}

function hasPoint(p?: Point) {
return !!p && p.score >= MIN_POINT_SCORE;
}

function hasPair(a?: Point, b?: Point) {
return !!a && !!b && a.score >= MIN_PAIR_SCORE && b.score >= MIN_PAIR_SCORE;
}

function average(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>) {
const valid = values.filter((v): v is number => v !== null);
if (!valid.length) return null;
return average(valid);
}

function buildBaseline(samples: BaselineSample[]): Baseline {
return {
shoulderAngle: average(samples.map((s) => s.shoulderAngle)),
hipAngle: average(samples.map((s) => s.hipAngle)),
torsoMidXNorm: average(samples.map((s) => s.torsoMidXNorm)),
torsoHeightNorm: average(samples.map((s) => s.torsoHeightNorm)),
shoulderWidthNorm: average(samples.map((s) => s.shoulderWidthNorm)),
hipWidthNorm: average(samples.map((s) => s.hipWidthNorm)),
baseRatio: averageNullable(samples.map((s) => s.baseRatio)),
};
}

export default function AxisReadyPage() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);

const streamRef = useRef<MediaStream | null>(null);
const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
const rafRef = useRef<number | null>(null);

const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const recordedChunksRef = useRef<Blob[]>([]);

const smoothedReadyRef = useRef<number>(0);
const currentStateRef = useRef<AxisState>("WAIT");
const candidateStateRef = useRef<AxisState>("WAIT");
const lastStateChangeAtRef = useRef<number>(0);
const candidateSinceRef = useRef<number>(0);
const lastAutoCaptureAtRef = useRef<number>(0);
const lastBestCaptureAtRef = useRef<number>(0);
const bestScoreThisSessionRef = useRef<number>(0);

const calibrationStartedAtRef = useRef<number | null>(null);
const calibrationSamplesRef = useRef<BaselineSample[]>([]);
const baselineRef = useRef<Baseline | null>(null);

const [enabled, setEnabled] = useState(false);
const [ready, setReady] = useState(false);
const [error, setError] = useState("");

const [axisState, setAxisState] = useState<AxisState>("WAIT");
const [axisReady, setAxisReady] = useState(0);
const [alignmentScore, setAlignmentScore] = useState(0);
const [baseScore, setBaseScore] = useState(0);
const [centerScore, setCenterScore] = useState(0);
const [motionScore, setMotionScore] = useState(0);
const [confidenceScore, setConfidenceScore] = useState(0);
const [guideText, setGuideText] = useState(
"HOLD NEUTRAL STANCE TO CALIBRATE AXIS READY",
);
const [calibrationProgress, setCalibrationProgress] = useState(0);

const [facingMode, setFacingMode] = useState<FacingMode>("environment");
const [isRecording, setIsRecording] = useState(false);
const [recordedVideoUrl, setRecordedVideoUrl] = useState("");

const [captures, setCaptures] = useState<CaptureItem[]>([]);
const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);

const sessionSeconds = useMemo(() => {
if (!sessionStartedAt) return 0;
return Math.floor((Date.now() - sessionStartedAt) / 1000);
}, [sessionStartedAt, axisReady, axisState]);

const resetSession = useCallback(() => {
bestScoreThisSessionRef.current = 0;
smoothedReadyRef.current = 0;
currentStateRef.current = "WAIT";
candidateStateRef.current = "WAIT";
lastStateChangeAtRef.current = performance.now();
candidateSinceRef.current = performance.now();
lastAutoCaptureAtRef.current = 0;
lastBestCaptureAtRef.current = 0;
calibrationStartedAtRef.current = null;
calibrationSamplesRef.current = [];
baselineRef.current = null;

setAxisState("WAIT");
setAxisReady(0);
setAlignmentScore(0);
setBaseScore(0);
setCenterScore(0);
setMotionScore(0);
setConfidenceScore(0);
setGuideText("HOLD NEUTRAL STANCE TO CALIBRATE AXIS READY");
setCalibrationProgress(0);
setCaptures([]);
setRecordedVideoUrl("");
setSessionStartedAt(Date.now());
}, []);

const getCanvasSize = useCallback(() => {
const video = videoRef.current;
if (!video) return { width: 720, height: 1280 };
return {
width: video.videoWidth || 720,
height: video.videoHeight || 1280,
};
}, []);

const syncCanvasSize = useCallback(() => {
const { width, height } = getCanvasSize();
const overlay = overlayCanvasRef.current;
const exportCanvas = exportCanvasRef.current;

if (overlay) {
overlay.width = width;
overlay.height = height;
}
if (exportCanvas) {
exportCanvas.width = width;
exportCanvas.height = height;
}
}, [getCanvasSize]);

const drawVideoCover = useCallback(
(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) => {
const vw = video.videoWidth || width;
const vh = video.videoHeight || height;
const scale = Math.max(width / vw, height / vh);
const dw = vw * scale;
const dh = vh * scale;
const dx = (width - dw) / 2;
const dy = (height - dh) / 2;
ctx.drawImage(video, dx, dy, dw, dh);
},
[],
);

const drawGrid = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.055)";
ctx.lineWidth = 1;

const cols = 6;
const rows = 10;

for (let i = 1; i < cols; i += 1) {
const x = (width / cols) * i;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}

for (let j = 1; j < rows; j += 1) {
const y = (height / rows) * j;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}

ctx.restore();
}, []);

const drawAmbientGlow = useCallback(
(ctx: CanvasRenderingContext2D, width: number, height: number, state: AxisState) => {
ctx.save();

const radial = ctx.createRadialGradient(
width / 2,
height / 2,
width * 0.12,
width / 2,
height / 2,
Math.max(width, height) * 0.75,
);

radial.addColorStop(0, "rgba(255,255,255,0)");
radial.addColorStop(0.55, "rgba(255,255,255,0)");
radial.addColorStop(1, STATE_GLOW[state]);

ctx.fillStyle = radial;
ctx.fillRect(0, 0, width, height);

const edge = ctx.createLinearGradient(0, 0, 0, height);
edge.addColorStop(0, STATE_GLOW[state]);
edge.addColorStop(0.18, "rgba(255,255,255,0)");
edge.addColorStop(0.82, "rgba(255,255,255,0)");
edge.addColorStop(1, STATE_GLOW[state]);

ctx.fillStyle = edge;
ctx.fillRect(0, 0, width, height);

ctx.restore();
},
[],
);

const drawAxisLine = useCallback(
(ctx: CanvasRenderingContext2D, width: number, height: number, state: AxisState) => {
ctx.save();

let color = "rgba(255,255,255,0.38)";
if (state === "READY") color = "rgba(120,255,175,0.9)";
if (state === "LOCKED") color = "rgba(85,255,155,0.98)";
if (state === "PARTIAL") color = "rgba(255,205,95,0.95)";
if (state === "NOT READY") color = "rgba(255,110,110,0.95)";
if (state === "MOVE BACK" || state === "CENTER" || state === "SHOW BASE" || state === "CALIBRATING") {
color = "rgba(130,190,255,0.9)";
}
if (state === "LOST") color = "rgba(180,180,180,0.5)";

ctx.strokeStyle = color;
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(width / 2, height * 0.12);
ctx.lineTo(width / 2, height * 0.9);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.2)";
ctx.lineWidth = 1;
for (let i = 0; i < 12; i += 1) {
const y = lerp(height * 0.14, height * 0.88, i / 11);
ctx.beginPath();
ctx.moveTo(width / 2 - 10, y);
ctx.lineTo(width / 2 + 10, y);
ctx.stroke();
}

ctx.restore();
},
[],
);

const drawLabel = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
state: AxisState,
readyScore: number,
confidence: number,
guide: string,
progress: number,
) => {
ctx.save();

ctx.fillStyle = "rgba(0,0,0,0.35)";
ctx.fillRect(24, 24, width - 48, 106);

ctx.font =
'600 18px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = "rgba(255,255,255,0.72)";
ctx.fillText("AXIS READY", 40, 52);

ctx.font =
'700 36px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
if (state === "LOCKED") ctx.fillStyle = "rgba(85,255,155,1)";
else if (state === "READY") ctx.fillStyle = "rgba(120,255,175,1)";
else if (state === "PARTIAL") ctx.fillStyle = "rgba(255,205,95,1)";
else if (state === "NOT READY") ctx.fillStyle = "rgba(255,110,110,1)";
else if (
state === "MOVE BACK" ||
state === "CENTER" ||
state === "SHOW BASE" ||
state === "CALIBRATING"
) {
ctx.fillStyle = "rgba(130,190,255,1)";
} else ctx.fillStyle = "rgba(255,255,255,0.95)";
ctx.fillText(String(Math.round(readyScore)).padStart(2, "0"), 40, 96);

ctx.font =
'600 16px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = "rgba(255,255,255,0.78)";
ctx.fillText(state, 104, 95);

ctx.font =
'500 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
ctx.fillStyle = "rgba(255,255,255,0.65)";
ctx.fillText(`CONF ${Math.round(confidence)}`, width - 170, 52);

if (state === "CALIBRATING") {
ctx.fillText(`BASELINE ${Math.round(progress)}%`, width - 170, 75);
} else {
ctx.fillText(`STATE ${state}`, width - 170, 75);
}

ctx.restore();

ctx.save();
ctx.fillStyle = "rgba(0,0,0,0.3)";
ctx.fillRect(24, height - 68, width - 48, 36);
ctx.font =
'500 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
ctx.fillStyle = "rgba(255,255,255,0.65)";
ctx.fillText(guide, 40, height - 45);
ctx.restore();

if (state === "CALIBRATING") {
ctx.save();
ctx.fillStyle = "rgba(255,255,255,0.08)";
ctx.fillRect(24, 138, width - 48, 10);
ctx.fillStyle = "rgba(130,190,255,0.92)";
ctx.fillRect(24, 138, (width - 48) * clamp(progress / 100, 0, 1), 10);
ctx.restore();
}
},
[],
);

const drawBodyIndicators = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
keypoints: Record<string, Point>,
state: AxisState,
showShoulders: boolean,
showHips: boolean,
showBase: boolean,
) => {
const leftShoulder = keypoints.left_shoulder;
const rightShoulder = keypoints.right_shoulder;
const leftHip = keypoints.left_hip;
const rightHip = keypoints.right_hip;
const leftAnkle = keypoints.left_ankle;
const rightAnkle = keypoints.right_ankle;

if (!showShoulders && !showHips) return;

let lineColor = "rgba(255,255,255,0.92)";
if (state === "READY") lineColor = "rgba(120,255,175,0.96)";
if (state === "LOCKED") lineColor = "rgba(85,255,155,0.98)";
if (state === "PARTIAL") lineColor = "rgba(255,205,95,0.95)";
if (state === "NOT READY") lineColor = "rgba(255,110,110,0.98)";
if (
state === "MOVE BACK" ||
state === "CENTER" ||
state === "SHOW BASE" ||
state === "CALIBRATING"
) {
lineColor = "rgba(130,190,255,0.96)";
}

ctx.save();
ctx.lineCap = "round";

let shoulderMid: Point | null = null;
let hipMid: Point | null = null;

if (showShoulders && leftShoulder && rightShoulder) {
shoulderMid = midpoint(leftShoulder, rightShoulder);
ctx.strokeStyle = lineColor;
ctx.lineWidth = 4;
ctx.beginPath();
ctx.moveTo(leftShoulder.x, leftShoulder.y);
ctx.lineTo(rightShoulder.x, rightShoulder.y);
ctx.stroke();

[leftShoulder, rightShoulder, shoulderMid].forEach((p, idx) => {
ctx.fillStyle = idx === 2 ? lineColor : "rgba(255,255,255,0.75)";
ctx.beginPath();
ctx.arc(p.x, p.y, idx === 2 ? 5 : 4, 0, Math.PI * 2);
ctx.fill();
});

ctx.strokeStyle = "rgba(255,255,255,0.16)";
ctx.lineWidth = 1;
ctx.setLineDash([5, 6]);
ctx.beginPath();
ctx.moveTo(width / 2, shoulderMid.y);
ctx.lineTo(shoulderMid.x, shoulderMid.y);
ctx.stroke();
ctx.setLineDash([]);
}

if (showHips && leftHip && rightHip) {
hipMid = midpoint(leftHip, rightHip);
ctx.strokeStyle = lineColor;
ctx.lineWidth = 4;
ctx.beginPath();
ctx.moveTo(leftHip.x, leftHip.y);
ctx.lineTo(rightHip.x, rightHip.y);
ctx.stroke();

[leftHip, rightHip, hipMid].forEach((p, idx) => {
ctx.fillStyle = idx === 2 ? lineColor : "rgba(255,255,255,0.75)";
ctx.beginPath();
ctx.arc(p.x, p.y, idx === 2 ? 5 : 4, 0, Math.PI * 2);
ctx.fill();
});

ctx.strokeStyle = "rgba(255,255,255,0.16)";
ctx.lineWidth = 1;
ctx.setLineDash([5, 6]);
ctx.beginPath();
ctx.moveTo(width / 2, hipMid.y);
ctx.lineTo(hipMid.x, hipMid.y);
ctx.stroke();
ctx.setLineDash([]);
}

if (shoulderMid && hipMid) {
ctx.strokeStyle = lineColor;
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(shoulderMid.x, shoulderMid.y);
ctx.lineTo(hipMid.x, hipMid.y);
ctx.stroke();
}

if (showBase && leftAnkle && rightAnkle && hipMid) {
const ankleMid = midpoint(leftAnkle, rightAnkle);
ctx.strokeStyle = "rgba(255,255,255,0.32)";
ctx.lineWidth = 2;

ctx.beginPath();
ctx.moveTo(leftAnkle.x, leftAnkle.y);
ctx.lineTo(rightAnkle.x, rightAnkle.y);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(hipMid.x, hipMid.y);
ctx.lineTo(ankleMid.x, ankleMid.y);
ctx.stroke();

[leftAnkle, rightAnkle].forEach((p) => {
ctx.fillStyle = "rgba(255,255,255,0.75)";
ctx.beginPath();
ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
ctx.fill();
});
}

ctx.restore();
},
[],
);

const renderInstrument = useCallback(
(
keypoints: Record<string, Point> | null,
state: AxisState,
readyScore: number,
confidence: number,
guide: string,
progress: number,
showShoulders: boolean,
showHips: boolean,
showBase: boolean,
) => {
const video = videoRef.current;
const overlay = overlayCanvasRef.current;
const exportCanvas = exportCanvasRef.current;

if (!video || !overlay || !exportCanvas) return;

const overlayCtx = overlay.getContext("2d");
const exportCtx = exportCanvas.getContext("2d");
if (!overlayCtx || !exportCtx) return;

const { width, height } = overlay;

[overlayCtx, exportCtx].forEach((ctx) => {
ctx.clearRect(0, 0, width, height);
drawVideoCover(ctx, video, width, height);
drawAmbientGlow(ctx, width, height, state);
drawGrid(ctx, width, height);
drawAxisLine(ctx, width, height, state);

if (keypoints) {
drawBodyIndicators(
ctx,
width,
keypoints,
state,
showShoulders,
showHips,
showBase,
);
}

drawLabel(ctx, width, height, state, readyScore, confidence, guide, progress);
});
},
[drawAmbientGlow, drawAxisLine, drawBodyIndicators, drawGrid, drawLabel, drawVideoCover],
);

const addCaptureFromExportCanvas = useCallback(
async (label: string, state: AxisState, score: number) => {
const canvas = exportCanvasRef.current;
if (!canvas) return;

const timestamp = Date.now();
const dataUrl = canvas.toDataURL("image/jpeg", 0.94);

setCaptures((prev) => [
{
id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
state,
score,
timestamp,
label,
dataUrl,
},
...prev,
]);
},
[],
);

const updateStateWithHold = useCallback((candidate: AxisState, now: number) => {
if (candidate !== candidateStateRef.current) {
candidateStateRef.current = candidate;
candidateSinceRef.current = now;
}

if (
candidate !== currentStateRef.current &&
now - candidateSinceRef.current >= STATE_HOLD_MS &&
now - lastStateChangeAtRef.current >= STATE_HOLD_MS
) {
currentStateRef.current = candidate;
lastStateChangeAtRef.current = now;
setAxisState(candidate);
}
}, []);

const analyzePose = useCallback(
async (now: number) => {
const video = videoRef.current;
const detector = detectorRef.current;

if (!video || !detector || video.readyState < 2) {
renderInstrument(
null,
"WAIT",
smoothedReadyRef.current,
confidenceScore,
guideText,
calibrationProgress,
false,
false,
false,
);
return;
}

const poses = await detector.estimatePoses(video, {
maxPoses: 1,
flipHorizontal: facingMode === "user",
});

const pose = poses[0];
const kpMap: Record<string, Point> = {};

if (pose?.keypoints?.length) {
for (const kp of pose.keypoints) {
const name = (kp.name ?? (kp as { part?: string }).part ?? "") as string;
if (!name) continue;
kpMap[name] = {
x: kp.x,
y: kp.y,
score: kp.score ?? 0,
};
}
}

const leftShoulder = kpMap.left_shoulder;
const rightShoulder = kpMap.right_shoulder;
const leftHip = kpMap.left_hip;
const rightHip = kpMap.right_hip;
const leftAnkle = kpMap.left_ankle;
const rightAnkle = kpMap.right_ankle;

const shoulderPairOk = hasPair(leftShoulder, rightShoulder);
const hipPairOk = hasPair(leftHip, rightHip);
const anklePairOk = hasPair(leftAnkle, rightAnkle);

const showShoulders = shoulderPairOk;
const showHips = hipPairOk;
const showBase = anklePairOk;

const visibleCount = [
hasPoint(leftShoulder),
hasPoint(rightShoulder),
hasPoint(leftHip),
hasPoint(rightHip),
hasPoint(leftAnkle),
hasPoint(rightAnkle),
].filter(Boolean).length;

const confidence =
(visibleCount / 6) * 70 +
(shoulderPairOk ? 10 : 0) +
(hipPairOk ? 10 : 0) +
(anklePairOk ? 10 : 0);

setConfidenceScore(Math.round(confidence));

if (!shoulderPairOk && !hipPairOk) {
const guide = "STEP BACK // FIND SUBJECT";
setGuideText(guide);
smoothedReadyRef.current *= 0.85;
setAxisReady(Math.round(smoothedReadyRef.current));
setAlignmentScore(0);
setBaseScore(0);
setCenterScore(0);
setMotionScore(0);
updateStateWithHold("LOST", now);
renderInstrument(
null,
currentStateRef.current,
smoothedReadyRef.current,
confidence,
guide,
calibrationProgress,
false,
false,
false,
);
return;
}

if (!shoulderPairOk || !hipPairOk) {
const guide = "CENTER TORSO INSIDE FIELD";
setGuideText(guide);
smoothedReadyRef.current = Math.max(smoothedReadyRef.current * 0.92, 12);
setAxisReady(Math.round(smoothedReadyRef.current));
setAlignmentScore(0);
setBaseScore(0);
setCenterScore(25);
setMotionScore(30);
updateStateWithHold("CENTER", now);
renderInstrument(
kpMap,
currentStateRef.current,
smoothedReadyRef.current,
confidence,
guide,
calibrationProgress,
showShoulders,
showHips,
false,
);
return;
}

const shoulderMid = midpoint(leftShoulder!, rightShoulder!);
const hipMid = midpoint(leftHip!, rightHip!);
const shoulderWidth = Math.max(distance(leftShoulder!, rightShoulder!), 1);
const hipWidth = Math.max(distance(leftHip!, rightHip!), 1);
const torsoHeight = Math.max(Math.abs(hipMid.y - shoulderMid.y), 1);

const shoulderAngle = normalizeAngleAbs(angleDeg(leftShoulder!, rightShoulder!));
const hipAngle = normalizeAngleAbs(angleDeg(leftHip!, rightHip!));
const torsoMidXNorm = ((shoulderMid.x + hipMid.x) / 2) / Math.max(video.videoWidth, 1);
const torsoHeightNorm = torsoHeight / Math.max(video.videoHeight, 1);
const shoulderWidthNorm = shoulderWidth / Math.max(video.videoWidth, 1);
const hipWidthNorm = hipWidth / Math.max(video.videoWidth, 1);

const tooClose =
shoulderWidthNorm > 0.52 ||
torsoHeightNorm > 0.58 ||
shoulderMid.y < video.videoHeight * 0.12 ||
hipMid.y > video.videoHeight * 0.92;

const torsoCenterOffsetNorm = Math.abs(torsoMidXNorm - 0.5) / 0.18;
const offCenter =
torsoCenterOffsetNorm > 1 ||
shoulderMid.x < video.videoWidth * 0.16 ||
shoulderMid.x > video.videoWidth * 0.84 ||
hipMid.x < video.videoWidth * 0.14 ||
hipMid.x > video.videoWidth * 0.86;

let baseRatio: number | null = null;
let centerOverBasePenalty = 0.25;

if (anklePairOk) {
const stanceWidth = Math.max(distance(leftAnkle!, rightAnkle!), 1);
const footMid = midpoint(leftAnkle!, rightAnkle!);
baseRatio = stanceWidth / hipWidth;
centerOverBasePenalty = clamp(
Math.abs(hipMid.x - footMid.x) / stanceWidth,
0,
1,
);
}

if (tooClose) {
const guide = "MOVE BACK // FIT SHOULDERS + HIPS INSIDE FIELD";
setGuideText(guide);
smoothedReadyRef.current = Math.max(smoothedReadyRef.current * 0.94, 14);
setAxisReady(Math.round(smoothedReadyRef.current));
setAlignmentScore(0);
setBaseScore(0);
setCenterScore(20);
setMotionScore(20);
updateStateWithHold("MOVE BACK", now);
renderInstrument(
kpMap,
currentStateRef.current,
smoothedReadyRef.current,
confidence,
guide,
calibrationProgress,
true,
true,
false,
);
return;
}

if (offCenter) {
const guide = "CENTER TORSO ON AXIS";
setGuideText(guide);
smoothedReadyRef.current = Math.max(smoothedReadyRef.current * 0.95, 16);
setAxisReady(Math.round(smoothedReadyRef.current));
setAlignmentScore(0);
setBaseScore(0);
setCenterScore(Math.round(clamp(100 - torsoCenterOffsetNorm * 60, 0, 100)));
setMotionScore(30);
updateStateWithHold("CENTER", now);
renderInstrument(
kpMap,
currentStateRef.current,
smoothedReadyRef.current,
confidence,
guide,
calibrationProgress,
true,
true,
false,
);
return;
}

if (!baselineRef.current) {
if (calibrationStartedAtRef.current === null) {
calibrationStartedAtRef.current = now;
calibrationSamplesRef.current = [];
}

calibrationSamplesRef.current.push({
shoulderAngle,
hipAngle,
torsoMidXNorm,
torsoHeightNorm,
shoulderWidthNorm,
hipWidthNorm,
baseRatio,
});

const progress = clamp(
((now - calibrationStartedAtRef.current) / CALIBRATION_MS) * 100,
0,
100,
);
setCalibrationProgress(progress);
setGuideText("HOLD NEUTRAL STANCE // BUILDING BASELINE");
setAxisReady(0);
setAlignmentScore(0);
setBaseScore(0);
setCenterScore(0);
setMotionScore(0);

updateStateWithHold("CALIBRATING", now);

if (progress >= 100 && calibrationSamplesRef.current.length >= 12) {
baselineRef.current = buildBaseline(calibrationSamplesRef.current);
calibrationStartedAtRef.current = null;
calibrationSamplesRef.current = [];
setGuideText("BASELINE SET // AXIS READY LIVE");
setCalibrationProgress(100);
currentStateRef.current = "NOT READY";
candidateStateRef.current = "NOT READY";
setAxisState("NOT READY");
}

renderInstrument(
kpMap,
currentStateRef.current,
0,
confidence,
"HOLD NEUTRAL STANCE // BUILDING BASELINE",
progress,
true,
true,
anklePairOk,
);
return;
}

setCalibrationProgress(100);

const baseline = baselineRef.current;

const shoulderAngleDelta = Math.abs(shoulderAngle - baseline.shoulderAngle);
const hipAngleDelta = Math.abs(hipAngle - baseline.hipAngle);
const torsoXDelta = Math.abs(torsoMidXNorm - baseline.torsoMidXNorm);
const torsoHeightDelta = Math.abs(torsoHeightNorm - baseline.torsoHeightNorm);
const shoulderWidthDelta = Math.abs(shoulderWidthNorm - baseline.shoulderWidthNorm);
const hipWidthDelta = Math.abs(hipWidthNorm - baseline.hipWidthNorm);
const baseRatioDelta =
baseRatio !== null && baseline.baseRatio !== null
? Math.abs(baseRatio - baseline.baseRatio)
: null;

const alignment =
100 -
clamp(shoulderAngleDelta / 10, 0, 1) * 45 -
clamp(hipAngleDelta / 10, 0, 1) * 35 -
clamp(torsoXDelta / 0.08, 0, 1) * 20;

const center =
100 -
clamp(torsoXDelta / 0.08, 0, 1) * 60 -
clamp(centerOverBasePenalty / 0.35, 0, 1) * 40;

const base =
baseRatio !== null
? 100 -
clamp((baseRatioDelta ?? 0) / 0.35, 0, 1) * 55 -
clamp(centerOverBasePenalty / 0.35, 0, 1) * 45
: 68;

const motion =
100 -
clamp(torsoHeightDelta / 0.07, 0, 1) * 35 -
clamp(shoulderWidthDelta / 0.07, 0, 1) * 25 -
clamp(hipWidthDelta / 0.07, 0, 1) * 20 -
clamp(shoulderAngleDelta / 12, 0, 1) * 20;

const confidenceForScore = clamp(confidence, 0, 100);

const rawReady =
0.35 * clamp(alignment, 0, 100) +
0.25 * clamp(base, 0, 100) +
0.2 * clamp(center, 0, 100) +
0.15 * clamp(motion, 0, 100) +
0.05 * confidenceForScore;

smoothedReadyRef.current =
smoothedReadyRef.current === 0
? rawReady
: smoothedReadyRef.current * 0.82 + rawReady * 0.18;

const readyScore = clamp(smoothedReadyRef.current, 0, 100);

let candidate: AxisState = "NOT READY";
let guide = "AXIS READY LIVE";

if (!anklePairOk) {
candidate = readyScore >= 70 ? "PARTIAL" : "SHOW BASE";
guide = "SHOW FEET FOR FULL FORCE READ";
} else if (readyScore >= 90) {
candidate = "LOCKED";
guide = "STABLE ENOUGH TO RELEASE FORCE";
} else if (readyScore >= 70) {
candidate = "READY";
guide = "READY TO RELEASE FORCE";
} else if (readyScore >= 40) {
candidate = "PARTIAL";
guide = "PARTIAL READ // CLEAN UP STRUCTURE";
} else {
candidate = "NOT READY";
guide = "NOT READY // RESTACK BEFORE FORCE";
}

if (candidate !== candidateStateRef.current) {
candidateStateRef.current = candidate;
candidateSinceRef.current = now;
}

if (
candidate !== currentStateRef.current &&
now - candidateSinceRef.current >= STATE_HOLD_MS &&
now - lastStateChangeAtRef.current >= STATE_HOLD_MS
) {
currentStateRef.current = candidate;
lastStateChangeAtRef.current = now;
setAxisState(candidate);

if (
["READY", "LOCKED", "PARTIAL", "NOT READY"].includes(candidate) &&
now - lastAutoCaptureAtRef.current > AUTO_CAPTURE_COOLDOWN_MS
) {
lastAutoCaptureAtRef.current = now;
void addCaptureFromExportCanvas(`Auto ${candidate}`, candidate, readyScore);
}
}

if (readyScore > bestScoreThisSessionRef.current) {
bestScoreThisSessionRef.current = readyScore;
}

if (
currentStateRef.current === "LOCKED" &&
readyScore >= bestScoreThisSessionRef.current - 0.8 &&
now - lastBestCaptureAtRef.current > BEST_CAPTURE_COOLDOWN_MS
) {
lastBestCaptureAtRef.current = now;
void addCaptureFromExportCanvas("Best Moment", "LOCKED", readyScore);
}

setGuideText(guide);
setAxisReady(Math.round(readyScore));
setAlignmentScore(Math.round(clamp(alignment, 0, 100)));
setBaseScore(Math.round(clamp(base, 0, 100)));
setCenterScore(Math.round(clamp(center, 0, 100)));
setMotionScore(Math.round(clamp(motion, 0, 100)));

renderInstrument(
kpMap,
currentStateRef.current,
readyScore,
confidence,
guide,
100,
true,
true,
anklePairOk,
);
},
[
addCaptureFromExportCanvas,
calibrationProgress,
confidenceScore,
facingMode,
guideText,
renderInstrument,
updateStateWithHold,
],
);

const loop = useCallback(async () => {
const now = performance.now();
try {
await analyzePose(now);
} catch (err) {
console.error("analyzePose error:", err);
setError(`Pose analysis failed: ${String(err)}`);
}
rafRef.current = requestAnimationFrame(loop);
}, [analyzePose]);

const stopLoop = useCallback(() => {
if (rafRef.current !== null) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}
}, []);

const stopCamera = useCallback(() => {
stopLoop();

if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
mediaRecorderRef.current.stop();
}

if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}

detectorRef.current?.dispose?.();
detectorRef.current = null;

setEnabled(false);
setReady(false);
}, [stopLoop]);

const startCamera = useCallback(async () => {
try {
setError("");
stopCamera();
resetSession();

if (!navigator.mediaDevices?.getUserMedia) {
throw new Error("This browser does not support camera access.");
}

await initTfBackend();

const stream = await navigator.mediaDevices.getUserMedia({
audio: false,
video: {
facingMode,
width: { ideal: 1080 },
height: { ideal: 1920 },
frameRate: { ideal: 30, max: 30 },
},
});

streamRef.current = stream;

const video = videoRef.current;
if (!video) throw new Error("Video element was not found.");

video.srcObject = stream;

await new Promise<void>((resolve, reject) => {
const onLoaded = () => {
video.onloadedmetadata = null;
video.onerror = null;
resolve();
};
const onError = () => {
video.onloadedmetadata = null;
video.onerror = null;
reject(new Error("Video metadata failed to load."));
};
video.onloadedmetadata = onLoaded;
video.onerror = onError;
});

await video.play();
syncCanvasSize();

const detector = await poseDetection.createDetector(
poseDetection.SupportedModels.MoveNet,
{
modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
enableSmoothing: true,
},
);

detectorRef.current = detector;
setEnabled(true);
setReady(true);

stopLoop();
rafRef.current = requestAnimationFrame(loop);
} catch (err) {
console.error("startCamera error:", err);
setError(`Camera or pose model failed to start: ${String(err)}`);
setEnabled(false);
setReady(false);

if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}
}
}, [facingMode, loop, resetSession, stopCamera, stopLoop, syncCanvasSize]);

useEffect(() => {
return () => {
stopCamera();
};
}, [stopCamera]);

useEffect(() => {
if (!enabled) return;
const handleResize = () => syncCanvasSize();
window.addEventListener("resize", handleResize);
return () => window.removeEventListener("resize", handleResize);
}, [enabled, syncCanvasSize]);

const flipCamera = useCallback(() => {
setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
}, []);

useEffect(() => {
if (!enabled) return;
void startCamera();
}, [facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

const manualCapture = useCallback(async () => {
await addCaptureFromExportCanvas("Manual Capture", axisState, axisReady);
}, [addCaptureFromExportCanvas, axisReady, axisState]);

const startRecording = useCallback(() => {
const exportCanvas = exportCanvasRef.current;
if (!exportCanvas || isRecording) return;

recordedChunksRef.current = [];
const stream = exportCanvas.captureStream(30);
let recorder: MediaRecorder;

try {
recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
} catch {
try {
recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
} catch {
setError("Recording is not supported on this device/browser.");
return;
}
}

recorder.ondataavailable = (event) => {
if (event.data.size > 0) recordedChunksRef.current.push(event.data);
};

recorder.onstop = () => {
const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
const url = URL.createObjectURL(blob);
setRecordedVideoUrl((prev) => {
if (prev) URL.revokeObjectURL(prev);
return url;
});
setIsRecording(false);
};

mediaRecorderRef.current = recorder;
recorder.start(250);
setIsRecording(true);
}, [isRecording]);

const stopRecording = useCallback(() => {
if (!mediaRecorderRef.current) return;
if (mediaRecorderRef.current.state !== "inactive") {
mediaRecorderRef.current.stop();
}
}, []);

const saveVideo = useCallback(async () => {
if (!recordedVideoUrl) return;
const res = await fetch(recordedVideoUrl);
const blob = await res.blob();
const filename = createFileName("VIDEO", axisState, Date.now(), "webm");
await shareOrDownloadBlob(blob, filename);
}, [axisState, recordedVideoUrl]);

const saveCapture = useCallback(async (capture: CaptureItem) => {
const blob = dataUrlToBlob(capture.dataUrl);
const filename = createFileName("FRAME", capture.state, capture.timestamp, "jpg");
await shareOrDownloadBlob(blob, filename);
}, []);

const saveAllCaptures = useCallback(async () => {
for (const capture of captures) {
const blob = dataUrlToBlob(capture.dataUrl);
const filename = createFileName("FRAME", capture.state, capture.timestamp, "jpg");
downloadBlob(blob, filename);
await new Promise((r) => setTimeout(r, 200));
}
}, [captures]);

const clearBaseline = useCallback(() => {
baselineRef.current = null;
calibrationSamplesRef.current = [];
calibrationStartedAtRef.current = null;
setAxisState("WAIT");
setGuideText("HOLD NEUTRAL STANCE TO CALIBRATE AXIS READY");
setCalibrationProgress(0);
currentStateRef.current = "WAIT";
candidateStateRef.current = "WAIT";
}, []);

const topCapture = captures[0];

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
<div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur md:flex-row md:items-center">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Axis Ready Instrument
</div>
<div className="mt-1 text-2xl font-semibold tracking-tight">
Calibrated force-readiness signal
</div>
<div className="mt-1 text-sm text-white/55">
Baseline calibration, torso fallback, full-base force read, proof capture.
</div>
</div>

<div className="flex flex-wrap gap-2">
{!enabled ? (
<button
onClick={() => void startCamera()}
className="rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90"
>
Start Axis Ready
</button>
) : (
<button
onClick={stopCamera}
className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
>
End Session
</button>
)}

<button
onClick={flipCamera}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
>
Flip Camera
</button>

<button
onClick={clearBaseline}
disabled={!enabled}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
>
Recalibrate
</button>

{!isRecording ? (
<button
onClick={startRecording}
disabled={!enabled || !ready}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
>
Record Instrument
</button>
) : (
<button
onClick={stopRecording}
className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
>
Stop Recording
</button>
)}

<button
onClick={() => void manualCapture()}
disabled={!enabled}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
>
Capture Frame
</button>
</div>
</div>

{error ? (
<div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
{error}
</div>
) : null}

<div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
<section className="overflow-hidden rounded-[28px] border border-white/10 bg-black">
<div className="relative aspect-[9/16] w-full bg-black">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
/>
<canvas ref={overlayCanvasRef} className="absolute inset-0 h-full w-full" />
<canvas ref={exportCanvasRef} className="hidden" />

<div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.25em] text-white/45">
State
</div>
<div className="mt-1 text-lg font-semibold">{axisState}</div>
</div>

<div className="pointer-events-none absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-right backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.25em] text-white/45">
Session
</div>
<div className="mt-1 text-lg font-semibold">
{String(Math.floor(sessionSeconds / 60)).padStart(2, "0")}:
{String(sessionSeconds % 60).padStart(2, "0")}
</div>
</div>
</div>
</section>

<aside className="flex flex-col gap-4">
<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Live Read
</div>

<div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Axis Ready
</div>
<div className="mt-2 text-5xl font-semibold">{axisReady}</div>
<div className="mt-2 text-sm text-white/55">
{axisState === "LOCKED"
? "Stable enough to release force."
: axisState === "READY"
? "Ready to release force."
: axisState === "PARTIAL"
? "Partial read. Show base for full certainty."
: axisState === "NOT READY"
? "Restack before force."
: guideText}
</div>
</div>

<div className="mt-4 grid grid-cols-2 gap-3">
<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Alignment
</div>
<div className="mt-2 text-2xl font-semibold">{alignmentScore}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Base
</div>
<div className="mt-2 text-2xl font-semibold">{baseScore}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Center
</div>
<div className="mt-2 text-2xl font-semibold">{centerScore}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Motion
</div>
<div className="mt-2 text-2xl font-semibold">{motionScore}</div>
</div>
</div>

<div className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Confidence
</div>
<div className="mt-2 text-2xl font-semibold">{confidenceScore}</div>
</div>

<div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
<div
className="h-full rounded-full bg-white transition-all duration-300"
style={{ width: `${clamp(axisReady, 0, 100)}%` }}
/>
</div>

<div className="mt-3 text-sm text-white/55">{guideText}</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="flex items-center justify-between">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Best / Auto Frames
</div>
<div className="mt-1 text-sm text-white/55">
Auto captures follow state changes and best locked moments.
</div>
</div>

{captures.length > 0 ? (
<button
onClick={() => void saveAllCaptures()}
className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
>
Save All
</button>
) : null}
</div>

{topCapture ? (
<div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
<img
src={topCapture.dataUrl}
alt={topCapture.label}
className="aspect-[9/16] w-full object-cover"
/>
<div className="flex items-center justify-between gap-3 p-3">
<div>
<div className="text-sm font-semibold">{topCapture.label}</div>
<div className="text-xs text-white/50">
{topCapture.state} • {Math.round(topCapture.score)}
</div>
</div>
<button
onClick={() => void saveCapture(topCapture)}
className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
>
Save
</button>
</div>
</div>
) : (
<div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-black/30 p-6 text-sm text-white/45">
Start the instrument and it will begin saving proof frames.
</div>
)}
</div>

<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Recorded Instrument Feed
</div>

{recordedVideoUrl ? (
<div className="mt-4">
<video
src={recordedVideoUrl}
controls
className="w-full rounded-2xl border border-white/10"
/>
<button
onClick={() => void saveVideo()}
className="mt-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
>
Save Video
</button>
</div>
) : (
<div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-black/30 p-6 text-sm text-white/45">
Record saves the full instrument feed with overlays, calibrated read, and axis line.
</div>
)}
</div>
</aside>
</div>
</div>
</main>
);
}