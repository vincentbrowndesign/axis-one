"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as poseDetection from "@tensorflow-models/pose-detection";
import "@tensorflow/tfjs-backend-webgl";

type AxisState = "WAIT" | "LOCK" | "SHIFT" | "DROP" | "LOST";
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

const STATE_GLOW: Record<AxisState, string> = {
WAIT: "rgba(255,255,255,0.08)",
LOCK: "rgba(80,255,150,0.16)",
SHIFT: "rgba(255,190,80,0.16)",
DROP: "rgba(255,90,90,0.18)",
LOST: "rgba(160,160,160,0.12)",
};

const STATE_TEXT: Record<AxisState, string> = {
WAIT: "WAIT",
LOCK: "LOCK",
SHIFT: "SHIFT",
DROP: "DROP",
LOST: "LOST",
};

const MIN_KEYPOINT_SCORE = 0.3;
const STATE_HOLD_MS = 450;
const AUTO_CAPTURE_COOLDOWN_MS = 1200;
const BEST_CAPTURE_COOLDOWN_MS = 1500;

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

function createFileName(kind: string, state: AxisState, timestamp: number, ext: string) {
const d = new Date(timestamp);
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
return `AXIS_${kind}_${state}_${stamp}.${ext}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
const parts = dataUrl.split(",");
const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
const binary = atob(parts[1]);
const len = binary.length;
const bytes = new Uint8Array(len);
for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
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

function getCandidateState(score: number, current: AxisState): AxisState {
if (score < 8) return "LOST";

if (current === "LOCK") {
if (score >= 74) return "LOCK";
if (score >= 52) return "SHIFT";
return "DROP";
}

if (current === "SHIFT") {
if (score >= 84) return "LOCK";
if (score >= 50) return "SHIFT";
return "DROP";
}

if (current === "DROP") {
if (score >= 84) return "LOCK";
if (score >= 58) return "SHIFT";
return "DROP";
}

if (score >= 84) return "LOCK";
if (score >= 58) return "SHIFT";
if (score >= 20) return "DROP";
return "LOST";
}

export default function AxisInstrumentPage() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);

const streamRef = useRef<MediaStream | null>(null);
const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
const rafRef = useRef<number | null>(null);

const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const recordedChunksRef = useRef<Blob[]>([]);

const smoothedScoreRef = useRef<number>(0);
const currentStateRef = useRef<AxisState>("WAIT");
const candidateStateRef = useRef<AxisState>("WAIT");
const lastStateChangeAtRef = useRef<number>(0);
const candidateSinceRef = useRef<number>(0);
const lastAutoCaptureAtRef = useRef<number>(0);
const lastBestCaptureAtRef = useRef<number>(0);
const bestScoreThisSessionRef = useRef<number>(0);

const [enabled, setEnabled] = useState(false);
const [error, setError] = useState("");
const [ready, setReady] = useState(false);

const [axisState, setAxisState] = useState<AxisState>("WAIT");
const [stability, setStability] = useState(0);
const [baseRatio, setBaseRatio] = useState(0);
const [centerOffset, setCenterOffset] = useState(0);

const [facingMode, setFacingMode] = useState<FacingMode>("environment");
const [isRecording, setIsRecording] = useState(false);
const [recordedVideoUrl, setRecordedVideoUrl] = useState<string>("");

const [captures, setCaptures] = useState<CaptureItem[]>([]);
const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);

const sessionSeconds = useMemo(() => {
if (!sessionStartedAt) return 0;
return Math.floor((Date.now() - sessionStartedAt) / 1000);
}, [sessionStartedAt, stability, axisState]);

const resetSession = useCallback(() => {
bestScoreThisSessionRef.current = 0;
smoothedScoreRef.current = 0;
currentStateRef.current = "WAIT";
candidateStateRef.current = "WAIT";
lastStateChangeAtRef.current = performance.now();
candidateSinceRef.current = performance.now();
lastAutoCaptureAtRef.current = 0;
lastBestCaptureAtRef.current = 0;

setAxisState("WAIT");
setStability(0);
setBaseRatio(0);
setCenterOffset(0);
setCaptures([]);
setRecordedVideoUrl("");
setSessionStartedAt(Date.now());
}, []);

const getCanvasSize = useCallback(() => {
const video = videoRef.current;
if (!video) return { width: 720, height: 1280 };

const width = video.videoWidth || 720;
const height = video.videoHeight || 1280;
return { width, height };
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

const drawGrid = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.06)";
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
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
state: AxisState,
) => {
ctx.save();

let color = "rgba(255,255,255,0.38)";
if (state === "LOCK") color = "rgba(115,255,170,0.9)";
if (state === "SHIFT") color = "rgba(255,200,90,0.92)";
if (state === "DROP") color = "rgba(255,110,110,0.95)";
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
score: number,
base: number,
center: number,
) => {
ctx.save();

ctx.fillStyle = "rgba(0,0,0,0.35)";
ctx.fillRect(24, 24, width - 48, 92);

ctx.font = '600 18px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = "rgba(255,255,255,0.72)";
ctx.fillText("AXIS", 40, 52);

ctx.font = '700 34px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
if (state === "LOCK") ctx.fillStyle = "rgba(115,255,170,1)";
else if (state === "SHIFT") ctx.fillStyle = "rgba(255,200,90,1)";
else if (state === "DROP") ctx.fillStyle = "rgba(255,110,110,1)";
else ctx.fillStyle = "rgba(255,255,255,0.95)";
ctx.fillText(STATE_TEXT[state], 40, 92);

ctx.font = '500 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
ctx.fillStyle = "rgba(255,255,255,0.65)";
ctx.fillText(`STABILITY ${Math.round(score)}`, width - 190, 50);
ctx.fillText(`BASE ${base.toFixed(2)}`, width - 190, 72);
ctx.fillText(`CENTER ${center.toFixed(2)}`, width - 190, 94);

ctx.restore();

ctx.save();
ctx.fillStyle = "rgba(0,0,0,0.3)";
ctx.fillRect(24, height - 68, width - 48, 36);
ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
ctx.fillStyle = "rgba(255,255,255,0.65)";
ctx.fillText("ALIGN TO CENTER AXIS // HOLD GREEN // RECORD PROOF", 40, height - 45);
ctx.restore();
},
[],
);

const drawBodyIndicators = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
keypoints: Record<string, Point>,
state: AxisState,
) => {
const leftShoulder = keypoints.left_shoulder;
const rightShoulder = keypoints.right_shoulder;
const leftHip = keypoints.left_hip;
const rightHip = keypoints.right_hip;
const leftAnkle = keypoints.left_ankle;
const rightAnkle = keypoints.right_ankle;

if (
!leftShoulder ||
!rightShoulder ||
!leftHip ||
!rightHip ||
!leftAnkle ||
!rightAnkle
) {
return;
}

const shoulderMid = midpoint(leftShoulder, rightShoulder);
const hipMid = midpoint(leftHip, rightHip);
const ankleMid = midpoint(leftAnkle, rightAnkle);

let lineColor = "rgba(255,255,255,0.92)";
if (state === "LOCK") lineColor = "rgba(115,255,170,0.98)";
if (state === "SHIFT") lineColor = "rgba(255,200,90,0.98)";
if (state === "DROP") lineColor = "rgba(255,110,110,0.98)";
if (state === "LOST") lineColor = "rgba(200,200,200,0.75)";

ctx.save();
ctx.strokeStyle = lineColor;
ctx.lineWidth = 4;
ctx.lineCap = "round";

ctx.beginPath();
ctx.moveTo(leftShoulder.x, leftShoulder.y);
ctx.lineTo(rightShoulder.x, rightShoulder.y);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(leftHip.x, leftHip.y);
ctx.lineTo(rightHip.x, rightHip.y);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.3)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(leftAnkle.x, leftAnkle.y);
ctx.lineTo(rightAnkle.x, rightAnkle.y);
ctx.stroke();

ctx.strokeStyle = lineColor;
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(shoulderMid.x, shoulderMid.y);
ctx.lineTo(hipMid.x, hipMid.y);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.35)";
ctx.beginPath();
ctx.moveTo(hipMid.x, hipMid.y);
ctx.lineTo(ankleMid.x, ankleMid.y);
ctx.stroke();

const points = [leftShoulder, rightShoulder, leftHip, rightHip, leftAnkle, rightAnkle, shoulderMid, hipMid];
points.forEach((p, idx) => {
ctx.fillStyle = idx >= 6 ? lineColor : "rgba(255,255,255,0.75)";
ctx.beginPath();
ctx.arc(p.x, p.y, idx >= 6 ? 5 : 4, 0, Math.PI * 2);
ctx.fill();
});

ctx.restore();

ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.16)";
ctx.lineWidth = 1;
ctx.setLineDash([5, 6]);

ctx.beginPath();
ctx.moveTo(width / 2, shoulderMid.y);
ctx.lineTo(shoulderMid.x, shoulderMid.y);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(width / 2, hipMid.y);
ctx.lineTo(hipMid.x, hipMid.y);
ctx.stroke();

ctx.restore();
},
[],
);

const renderInstrument = useCallback(
(
keypoints: Record<string, Point> | null,
state: AxisState,
score: number,
base: number,
center: number,
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
ctx.drawImage(video, 0, 0, width, height);
drawAmbientGlow(ctx, width, height, state);
drawGrid(ctx, width, height);
drawAxisLine(ctx, width, height, state);

if (keypoints) {
drawBodyIndicators(ctx, width, height, keypoints, state);
}

drawLabel(ctx, width, height, state, score, base, center);
});
},
[drawAmbientGlow, drawAxisLine, drawBodyIndicators, drawGrid, drawLabel],
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

const analyzePose = useCallback(
async (now: number) => {
const video = videoRef.current;
const detector = detectorRef.current;

if (!video || !detector || video.readyState < 2) {
renderInstrument(null, "WAIT", smoothedScoreRef.current, baseRatio, centerOffset);
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
const name = kp.name || "";
if (!name) continue;
kpMap[name] = {
x: kp.x,
y: kp.y,
score: kp.score ?? 0,
};
}
}

const required = [
"left_shoulder",
"right_shoulder",
"left_hip",
"right_hip",
"left_ankle",
"right_ankle",
];

const hasAll = required.every((k) => kpMap[k] && kpMap[k].score >= MIN_KEYPOINT_SCORE);

if (!hasAll) {
const candidate = "LOST";
if (candidateStateRef.current !== candidate) {
candidateStateRef.current = candidate;
candidateSinceRef.current = now;
}

if (
currentStateRef.current !== candidate &&
now - candidateSinceRef.current >= STATE_HOLD_MS
) {
currentStateRef.current = candidate;
lastStateChangeAtRef.current = now;
setAxisState(candidate);
}

smoothedScoreRef.current = smoothedScoreRef.current * 0.85;
setStability(Math.round(smoothedScoreRef.current));
setBaseRatio(0);
setCenterOffset(0);
renderInstrument(null, currentStateRef.current, smoothedScoreRef.current, 0, 0);
return;
}

const leftShoulder = kpMap.left_shoulder;
const rightShoulder = kpMap.right_shoulder;
const leftHip = kpMap.left_hip;
const rightHip = kpMap.right_hip;
const leftAnkle = kpMap.left_ankle;
const rightAnkle = kpMap.right_ankle;

const shoulderMid = midpoint(leftShoulder, rightShoulder);
const hipMid = midpoint(leftHip, rightHip);
const footMid = midpoint(leftAnkle, rightAnkle);

const shoulderAngle = normalizeAngleAbs(angleDeg(leftShoulder, rightShoulder));
const hipAngle = normalizeAngleAbs(angleDeg(leftHip, rightHip));

const shoulderWidth = distance(leftShoulder, rightShoulder);
const hipWidth = Math.max(distance(leftHip, rightHip), 1);
const stanceWidth = distance(leftAnkle, rightAnkle);

const axisDeviation = Math.abs(shoulderMid.x - hipMid.x) / shoulderWidth;
const centerDrift = Math.abs(hipMid.x - footMid.x) / Math.max(stanceWidth, 1);
const base = stanceWidth / hipWidth;

const anglePenalty = clamp((shoulderAngle + hipAngle) / 36, 0, 1);
const axisPenalty = clamp(axisDeviation / 0.3, 0, 1);
const centerPenalty = clamp(centerDrift / 0.3, 0, 1);

const baseSweetPenalty =
base < 1.15
? clamp((1.15 - base) / 0.55, 0, 1)
: base > 1.95
? clamp((base - 1.95) / 0.8, 0, 1)
: 0;

let rawScore =
100 -
anglePenalty * 28 -
axisPenalty * 24 -
centerPenalty * 30 -
baseSweetPenalty * 18;

rawScore = clamp(rawScore, 0, 100);

const smoothFactor = 0.18;
smoothedScoreRef.current =
smoothedScoreRef.current === 0
? rawScore
: smoothedScoreRef.current * (1 - smoothFactor) + rawScore * smoothFactor;

const score = smoothedScoreRef.current;
const candidate = getCandidateState(score, currentStateRef.current);

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
["LOCK", "SHIFT", "DROP"].includes(candidate) &&
now - lastAutoCaptureAtRef.current > AUTO_CAPTURE_COOLDOWN_MS
) {
lastAutoCaptureAtRef.current = now;
void addCaptureFromExportCanvas(`Auto ${candidate}`, candidate, score);
}
}

const liveState = currentStateRef.current;
bestScoreThisSessionRef.current = Math.max(bestScoreThisSessionRef.current, score);

if (
liveState === "LOCK" &&
score > bestScoreThisSessionRef.current - 0.8 &&
now - lastBestCaptureAtRef.current > BEST_CAPTURE_COOLDOWN_MS
) {
lastBestCaptureAtRef.current = now;
void addCaptureFromExportCanvas("Best Moment", liveState, score);
}

setStability(Math.round(score));
setBaseRatio(Number(base.toFixed(2)));
setCenterOffset(Number(centerDrift.toFixed(2)));

renderInstrument(kpMap, liveState, score, base, centerDrift);
},
[addCaptureFromExportCanvas, baseRatio, centerOffset, facingMode, renderInstrument],
);

const loop = useCallback(async () => {
const now = performance.now();

try {
await analyzePose(now);
} catch (err) {
console.error(err);
setError("Pose tracking hit an error.");
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
if (!video) return;

video.srcObject = stream;
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
console.error(err);
setError("Camera or pose model failed to start.");
setEnabled(false);
setReady(false);
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

const flipCamera = useCallback(async () => {
setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
}, []);

useEffect(() => {
if (!enabled) return;
void startCamera();
}, [facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

const manualCapture = useCallback(async () => {
await addCaptureFromExportCanvas("Manual Capture", axisState, stability);
}, [addCaptureFromExportCanvas, axisState, stability]);

const startRecording = useCallback(() => {
const exportCanvas = exportCanvasRef.current;
if (!exportCanvas || isRecording) return;

recordedChunksRef.current = [];

const stream = exportCanvas.captureStream(30);
const recorder = new MediaRecorder(stream, {
mimeType: "video/webm;codecs=vp9",
});

recorder.ondataavailable = (event) => {
if (event.data.size > 0) recordedChunksRef.current.push(event.data);
};

recorder.onstop = () => {
const blob = new Blob(recordedChunksRef.current, {
type: "video/webm",
});
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

const topCapture = captures[0];

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
<div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur md:flex-row md:items-center">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Axis Instrument</div>
<div className="mt-1 text-2xl font-semibold tracking-tight">Single signal. Live proof.</div>
<div className="mt-1 text-sm text-white/55">
Central axis layout, ambient state lighting, auto best-frame capture, smoothed state logic.
</div>
</div>

<div className="flex flex-wrap gap-2">
{!enabled ? (
<button
onClick={() => void startCamera()}
className="rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90"
>
Start Instrument
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
className="absolute inset-0 h-full w-full object-cover opacity-0"
/>
<canvas
ref={overlayCanvasRef}
className="absolute inset-0 h-full w-full object-cover"
/>
<canvas ref={exportCanvasRef} className="hidden" />

<div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.25em] text-white/45">State</div>
<div className="mt-1 text-lg font-semibold">{axisState}</div>
</div>

<div className="pointer-events-none absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur text-right">
<div className="text-[10px] uppercase tracking-[0.25em] text-white/45">Session</div>
<div className="mt-1 text-lg font-semibold">
{String(Math.floor(sessionSeconds / 60)).padStart(2, "0")}:
{String(sessionSeconds % 60).padStart(2, "0")}
</div>
</div>
</div>
</section>

<aside className="flex flex-col gap-4">
<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Live Read</div>
<div className="mt-4 grid grid-cols-3 gap-3">
<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Stability</div>
<div className="mt-2 text-2xl font-semibold">{stability}</div>
</div>
<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Base</div>
<div className="mt-2 text-2xl font-semibold">{baseRatio.toFixed(2)}</div>
</div>
<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Center</div>
<div className="mt-2 text-2xl font-semibold">{centerOffset.toFixed(2)}</div>
</div>
</div>

<div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
<div
className="h-full rounded-full bg-white transition-all duration-300"
style={{ width: `${clamp(stability, 0, 100)}%` }}
/>
</div>

<div className="mt-3 text-sm text-white/55">
LOCK is the dominant signal. Everything else supports it.
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="flex items-center justify-between">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Best / Auto Frames</div>
<div className="mt-1 text-sm text-white/55">
Auto captures happen on state changes and best LOCK moments.
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
<img src={topCapture.dataUrl} alt={topCapture.label} className="aspect-[9/16] w-full object-cover" />
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
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Recorded Instrument Feed</div>
{recordedVideoUrl ? (
<div className="mt-4">
<video src={recordedVideoUrl} controls className="w-full rounded-2xl border border-white/10" />
<button
onClick={() => void saveVideo()}
className="mt-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
>
Save Video
</button>
</div>
) : (
<div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-black/30 p-6 text-sm text-white/45">
Record saves the full instrument feed with overlays, state lighting, and axis line.
</div>
)}
</div>
</aside>
</div>
</div>
</main>
);
}