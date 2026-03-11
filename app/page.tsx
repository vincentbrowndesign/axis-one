"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
DrawingUtils,
FilesetResolver,
PoseLandmarker,
} from "@mediapipe/tasks-vision";

type AxisState = "ENTER FRAME" | "LOCK" | "LOAD" | "SHIFT" | "DROP" | "OFF AXIS";

type Metrics = {
state: AxisState;
stability: number;
alignment: number;
lean: number;
driftX: number;
driftY: number;
axisScore: number;
stabilityGrade: string;
alignmentGrade: string;
leanGrade: string;
};

type PosePoint = {
x: number;
y: number;
z?: number;
visibility?: number;
};

const STATE_COLORS: Record<AxisState, string> = {
"ENTER FRAME": "#c9d1d9",
LOCK: "#7CFF5B",
LOAD: "#63A7FF",
SHIFT: "#FFD24D",
DROP: "#FF6B6B",
"OFF AXIS": "#FF9B5E",
};

const INITIAL_METRICS: Metrics = {
state: "ENTER FRAME",
stability: 0,
alignment: 0,
lean: 0,
driftX: 0,
driftY: 0,
axisScore: 0,
stabilityGrade: "--",
alignmentGrade: "--",
leanGrade: "--",
};

function clamp(value: number, min: number, max: number) {
return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
return Number(value.toFixed(digits));
}

function averagePoint(points: PosePoint[]): PosePoint {
const valid = points.filter(Boolean);
const count = Math.max(valid.length, 1);
return {
x: valid.reduce((sum, p) => sum + p.x, 0) / count,
y: valid.reduce((sum, p) => sum + p.y, 0) / count,
z: valid.reduce((sum, p) => sum + (p.z ?? 0), 0) / count,
visibility:
valid.reduce((sum, p) => sum + (p.visibility ?? 1), 0) / count,
};
}

function dist(a: PosePoint, b: PosePoint) {
const dx = a.x - b.x;
const dy = a.y - b.y;
return Math.sqrt(dx * dx + dy * dy);
}

function toGrade(value: number) {
if (value >= 97) return "A+";
if (value >= 93) return "A";
if (value >= 90) return "A-";
if (value >= 87) return "B+";
if (value >= 83) return "B";
if (value >= 80) return "B-";
if (value >= 77) return "C+";
if (value >= 73) return "C";
if (value >= 70) return "C-";
if (value >= 67) return "D+";
if (value >= 63) return "D";
if (value >= 60) return "D-";
return "F";
}

function gradeColor(grade: string) {
if (grade.startsWith("A")) return "#7CFF5B";
if (grade.startsWith("B")) return "#9FE870";
if (grade.startsWith("C")) return "#FFD24D";
if (grade.startsWith("D")) return "#FF9B5E";
if (grade === "--") return "#ffffff";
return "#FF6B6B";
}

function classifyPose(landmarks: PosePoint[]): Metrics {
const nose = landmarks[0];
const leftShoulder = landmarks[11];
const rightShoulder = landmarks[12];
const leftHip = landmarks[23];
const rightHip = landmarks[24];
const leftKnee = landmarks[25];
const rightKnee = landmarks[26];
const leftAnkle = landmarks[27];
const rightAnkle = landmarks[28];

const shoulderCenter = averagePoint([leftShoulder, rightShoulder]);
const hipCenter = averagePoint([leftHip, rightHip]);
const kneeCenter = averagePoint([leftKnee, rightKnee]);
const ankleCenter = averagePoint([leftAnkle, rightAnkle]);

const shoulderWidth = Math.max(dist(leftShoulder, rightShoulder), 0.02);
const hipWidth = Math.max(dist(leftHip, rightHip), 0.02);
const baseWidth = Math.max(dist(leftAnkle, rightAnkle), 0.04);

const bodyDx = shoulderCenter.x - hipCenter.x;
const bodyDy = Math.max(Math.abs(shoulderCenter.y - hipCenter.y), 0.001);
const lean = Math.abs(bodyDx) / bodyDy;

const headDriftX = nose.x - ankleCenter.x;
const torsoDriftX = hipCenter.x - ankleCenter.x;
const driftX = (headDriftX + torsoDriftX) / 2;
const driftY = hipCenter.y - kneeCenter.y;

const kneeBend =
((leftKnee.y - leftHip.y) + (rightKnee.y - rightHip.y)) / 2 -
((leftAnkle.y - leftKnee.y) + (rightAnkle.y - rightKnee.y)) / 2 * 0.45;

const bendScore = clamp((kneeBend + 0.08) / 0.22, 0, 1);

const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y);
const hipTilt = Math.abs(leftHip.y - rightHip.y);

const axisOffset =
Math.abs(shoulderCenter.x - hipCenter.x) +
Math.abs(hipCenter.x - ankleCenter.x);

const alignmentRaw =
1 -
clamp(
lean * 0.85 +
Math.abs(driftX) * 1.35 +
shoulderTilt * 1.2 +
hipTilt * 1.0 +
axisOffset * 1.0,
0,
1,
);

const stabilityRaw =
1 -
clamp(
lean * 0.6 +
Math.abs(driftX) * 0.95 +
shoulderTilt * 0.8 +
hipTilt * 0.7,
0,
1,
);

const alignment = clamp(Math.round(alignmentRaw * 100), 0, 100);
const stability = clamp(Math.round(stabilityRaw * 100), 0, 100);

const driftThreshold = Math.max(baseWidth * 0.18, 0.045);
const offAxisThreshold = Math.max(shoulderWidth * 0.22, 0.05);
const dropThreshold = 0.22;

let state: AxisState = "LOCK";

const isDrop =
lean > dropThreshold ||
alignment < 45 ||
Math.abs(driftX) > baseWidth * 0.36;

const isOffAxis =
axisOffset > offAxisThreshold ||
shoulderTilt > shoulderWidth * 0.18 ||
hipTilt > hipWidth * 0.18;

const isLoad =
bendScore > 0.45 &&
lean < 0.2 &&
Math.abs(driftX) < baseWidth * 0.24 &&
alignment > 52;

const isShift = Math.abs(driftX) > driftThreshold && !isDrop && !isOffAxis;

if (isDrop) {
state = "DROP";
} else if (isOffAxis) {
state = "OFF AXIS";
} else if (isLoad) {
state = "LOAD";
} else if (isShift) {
state = "SHIFT";
} else {
state = "LOCK";
}

const leanScore = clamp(Math.round(100 - lean * 220), 0, 100);
const axisScore = clamp(
Math.round(stability * 0.45 + alignment * 0.4 + leanScore * 0.15),
0,
100,
);

return {
state,
stability,
alignment,
lean: round(lean, 2),
driftX: round(driftX, 2),
driftY: round(driftY, 2),
axisScore,
stabilityGrade: toGrade(stability),
alignmentGrade: toGrade(alignment),
leanGrade: toGrade(leanScore),
};
}

export default function Page() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayRef = useRef<HTMLCanvasElement | null>(null);
const outputRef = useRef<HTMLCanvasElement | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const poseRef = useRef<PoseLandmarker | null>(null);
const rafRef = useRef<number | null>(null);
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const chunksRef = useRef<Blob[]>([]);
const holdTimeoutRef = useRef<number | null>(null);
const clipStartRef = useRef<number | null>(null);

const [cameraFacing, setCameraFacing] = useState<"user" | "environment">(
"environment",
);
const [cameraReady, setCameraReady] = useState(false);
const [running, setRunning] = useState(false);
const [recording, setRecording] = useState(false);
const [metrics, setMetrics] = useState<Metrics>(INITIAL_METRICS);
const [clipUrl, setClipUrl] = useState<string>("");
const [statusText, setStatusText] = useState("Idle");
const [error, setError] = useState("");

const stateColor = useMemo(() => STATE_COLORS[metrics.state], [metrics.state]);

const cleanupStream = useCallback(() => {
if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}
}, []);

const stopLoop = useCallback(() => {
if (rafRef.current !== null) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}
}, []);

const drawRoundedRect = (
ctx: CanvasRenderingContext2D,
x: number,
y: number,
w: number,
h: number,
r: number,
) => {
ctx.beginPath();
ctx.moveTo(x + r, y);
ctx.arcTo(x + w, y, x + w, y + h, r);
ctx.arcTo(x + w, y + h, x, y + h, r);
ctx.arcTo(x, y + h, x, y, r);
ctx.arcTo(x, y, x + w, y, r);
ctx.closePath();
};

const drawMeasurementReticle = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
activeState: AxisState,
) => {
const zoneW = width * 0.44;
const zoneH = height * 0.62;
const x = (width - zoneW) / 2;
const y = (height - zoneH) / 2;
const lineColor =
activeState === "LOCK"
? "rgba(124,255,91,0.55)"
: activeState === "ENTER FRAME"
? "rgba(255,255,255,0.26)"
: "rgba(255,255,255,0.18)";

ctx.save();
ctx.strokeStyle = lineColor;
ctx.lineWidth = 2;
ctx.setLineDash([10, 12]);
drawRoundedRect(ctx, x, y, zoneW, zoneH, 28);
ctx.stroke();

ctx.setLineDash([]);
ctx.strokeStyle = "rgba(255,255,255,0.12)";
ctx.lineWidth = 1;

const midX = width / 2;
const midY = height / 2;

ctx.beginPath();
ctx.moveTo(midX, y - 24);
ctx.lineTo(midX, y + 18);
ctx.moveTo(midX, y + zoneH - 18);
ctx.lineTo(midX, y + zoneH + 24);
ctx.moveTo(x - 24, midY);
ctx.lineTo(x + 18, midY);
ctx.moveTo(x + zoneW - 18, midY);
ctx.lineTo(x + zoneW + 24, midY);
ctx.stroke();

if (activeState === "ENTER FRAME") {
ctx.fillStyle = "rgba(255,255,255,0.76)";
ctx.font = "700 16px Inter, Arial, sans-serif";
ctx.textAlign = "center";
ctx.fillText("ENTER FRAME", width / 2, y - 14);
}

ctx.restore();
},
[],
);

const drawInstrument = useCallback(
(
video: HTMLVideoElement,
poseCanvas: HTMLCanvasElement,
outputCanvas: HTMLCanvasElement,
liveMetrics: Metrics,
) => {
const width = video.videoWidth || 1280;
const height = video.videoHeight || 720;
if (!width || !height) return;

poseCanvas.width = width;
poseCanvas.height = height;
outputCanvas.width = width;
outputCanvas.height = height;

const octx = outputCanvas.getContext("2d");
if (!octx) return;

octx.clearRect(0, 0, width, height);
octx.drawImage(video, 0, 0, width, height);
octx.drawImage(poseCanvas, 0, 0, width, height);

octx.fillStyle = "rgba(4, 6, 10, 0.12)";
octx.fillRect(0, 0, width, height);

drawMeasurementReticle(octx, width, height, liveMetrics.state);

const isWide = width >= 900;
const pad = Math.max(18, width * 0.02);

octx.save();
octx.fillStyle = "rgba(10, 12, 16, 0.32)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.2;
drawRoundedRect(octx, pad, pad, isWide ? 265 : 220, 82, 22);
octx.fill();
octx.stroke();

octx.fillStyle = "rgba(255,255,255,0.70)";
octx.font = "600 11px Inter, Arial, sans-serif";
octx.fillText("AXIS CAMERA", pad + 16, pad + 22);

octx.fillStyle = "rgba(255,255,255,0.92)";
octx.font = "600 16px Inter, Arial, sans-serif";
octx.fillText("Measurement Instrument", pad + 16, pad + 44);

octx.fillStyle = stateColor;
octx.font = isWide
? "900 28px Inter, Arial, sans-serif"
: "900 24px Inter, Arial, sans-serif";
octx.fillText(liveMetrics.state, pad + 16, pad + 73);
octx.restore();

const statusW = isWide ? 190 : 160;
const statusX = width - pad - statusW;

octx.save();
octx.fillStyle = "rgba(10, 12, 16, 0.32)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.2;
drawRoundedRect(octx, statusX, pad, statusW, 82, 22);
octx.fill();
octx.stroke();

octx.textAlign = "right";
octx.fillStyle = "rgba(255,255,255,0.68)";
octx.font = "600 11px Inter, Arial, sans-serif";
octx.fillText("STATUS", statusX + statusW - 16, pad + 22);

octx.fillStyle = recording ? "#ff6b6b" : "rgba(255,255,255,0.92)";
octx.font = "700 14px Inter, Arial, sans-serif";
octx.fillText(
recording ? "RECORDING" : "LIVE",
statusX + statusW - 16,
pad + 47,
);

octx.fillStyle = "rgba(255,255,255,0.70)";
octx.font = "600 12px Inter, Arial, sans-serif";
octx.fillText(
`SCORE ${liveMetrics.axisScore}`,
statusX + statusW - 16,
pad + 69,
);
octx.textAlign = "left";
octx.restore();

const cards = [
{ label: "AXIS SCORE", value: String(liveMetrics.axisScore), color: "#ffffff" },
{ label: "STABILITY", value: liveMetrics.stabilityGrade, color: gradeColor(liveMetrics.stabilityGrade) },
{ label: "ALIGNMENT", value: liveMetrics.alignmentGrade, color: gradeColor(liveMetrics.alignmentGrade) },
{ label: "LEAN", value: liveMetrics.leanGrade, color: gradeColor(liveMetrics.leanGrade) },
];

if (isWide) {
const sideW = Math.min(240, width * 0.2);
const cardH = 70;
const gap = 10;
const totalH = cards.length * cardH + (cards.length - 1) * gap;
const sideX = width - pad - sideW;
const sideY = Math.max((height - totalH) / 2, 120);

cards.forEach((card, index) => {
const y = sideY + index * (cardH + gap);

octx.save();
octx.fillStyle = "rgba(12, 14, 18, 0.28)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.1;
drawRoundedRect(octx, sideX, y, sideW, cardH, 18);
octx.fill();
octx.stroke();

octx.fillStyle = "rgba(255,255,255,0.58)";
octx.font = "600 10px Inter, Arial, sans-serif";
octx.fillText(card.label, sideX + 14, y + 20);

octx.fillStyle = card.color;
octx.font = "900 28px Inter, Arial, sans-serif";
octx.fillText(card.value, sideX + 14, y + 53);
octx.restore();
});
} else {
const rowW = width - pad * 2;
const rowH = 80;

octx.save();
octx.fillStyle = "rgba(12, 14, 18, 0.30)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.1;
drawRoundedRect(octx, pad, height - pad - rowH, rowW, rowH, 20);
octx.fill();
octx.stroke();

const colW = rowW / 4;
cards.forEach((card, index) => {
const x = pad + index * colW;
octx.fillStyle = "rgba(255,255,255,0.52)";
octx.font = "600 10px Inter, Arial, sans-serif";
octx.fillText(card.label, x + 12, height - pad - 52);

octx.fillStyle = card.color;
octx.font = "900 24px Inter, Arial, sans-serif";
octx.fillText(card.value, x + 12, height - pad - 18);
});

octx.restore();
}

if (recording) {
octx.save();
octx.fillStyle = "#FF4D4D";
octx.beginPath();
octx.arc(pad + 8, height - pad - 104, 7, 0, Math.PI * 2);
octx.fill();

octx.fillStyle = "rgba(255,255,255,0.92)";
octx.font = "700 14px Inter, Arial, sans-serif";
octx.fillText("RECORDING", pad + 22, height - pad - 99);
octx.restore();
}
},
[drawMeasurementReticle, recording, stateColor],
);

const loadPose = useCallback(async () => {
if (poseRef.current) return poseRef.current;

const vision = await FilesetResolver.forVisionTasks(
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);

const pose = await PoseLandmarker.createFromOptions(vision, {
baseOptions: {
modelAssetPath:
"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
},
runningMode: "VIDEO",
numPoses: 1,
minPoseDetectionConfidence: 0.5,
minPosePresenceConfidence: 0.5,
minTrackingConfidence: 0.5,
outputSegmentationMasks: false,
});

poseRef.current = pose;
return pose;
}, []);

const renderFrame = useCallback(async () => {
const video = videoRef.current;
const overlayCanvas = overlayRef.current;
const outputCanvas = outputRef.current;
const pose = poseRef.current;

if (!video || !overlayCanvas || !outputCanvas || !pose) {
rafRef.current = requestAnimationFrame(renderFrame);
return;
}

if (video.readyState < 2 || !running) {
rafRef.current = requestAnimationFrame(renderFrame);
return;
}

const width = video.videoWidth || 1280;
const height = video.videoHeight || 720;

overlayCanvas.width = width;
overlayCanvas.height = height;

const ctx = overlayCanvas.getContext("2d");
if (!ctx) {
rafRef.current = requestAnimationFrame(renderFrame);
return;
}

ctx.clearRect(0, 0, width, height);

const result = pose.detectForVideo(video, performance.now());
const landmarks = result.landmarks?.[0];

if (landmarks && landmarks.length > 28) {
const liveMetrics = classifyPose(landmarks as PosePoint[]);
setMetrics(liveMetrics);

ctx.save();

if (cameraFacing === "user") {
ctx.translate(width, 0);
ctx.scale(-1, 1);
}

const drawingUtils = new DrawingUtils(ctx);

drawingUtils.drawConnectors(
landmarks,
PoseLandmarker.POSE_CONNECTIONS,
{
color: STATE_COLORS[liveMetrics.state],
lineWidth: Math.max(3, width * 0.003),
},
);

drawingUtils.drawLandmarks(landmarks, {
color: STATE_COLORS[liveMetrics.state],
radius: 4,
});

const shoulderCenter = averagePoint([
landmarks[11] as PosePoint,
landmarks[12] as PosePoint,
]);
const hipCenter = averagePoint([
landmarks[23] as PosePoint,
landmarks[24] as PosePoint,
]);
const ankleCenter = averagePoint([
landmarks[27] as PosePoint,
landmarks[28] as PosePoint,
]);

const axisX = ((shoulderCenter.x + hipCenter.x + ankleCenter.x) / 3) * width;

ctx.save();
ctx.strokeStyle =
liveMetrics.state === "LOCK"
? "rgba(124,255,91,0.55)"
: "rgba(255,255,255,0.22)";
ctx.lineWidth = 2;
ctx.setLineDash([8, 10]);
ctx.beginPath();
ctx.moveTo(axisX, height * 0.08);
ctx.lineTo(axisX, height * 0.94);
ctx.stroke();
ctx.restore();

// Axis Shape
ctx.save();
ctx.strokeStyle = STATE_COLORS[liveMetrics.state];
ctx.lineWidth = Math.max(4, width * 0.0035);
ctx.lineCap = "round";
ctx.beginPath();
ctx.moveTo(shoulderCenter.x * width, shoulderCenter.y * height);
ctx.lineTo(hipCenter.x * width, hipCenter.y * height);
ctx.lineTo(ankleCenter.x * width, ankleCenter.y * height);
ctx.stroke();

ctx.fillStyle = "rgba(255,255,255,0.92)";
ctx.font = "700 12px Inter, Arial, sans-serif";
ctx.fillText(
"AXIS SHAPE",
shoulderCenter.x * width + 12,
shoulderCenter.y * height - 12,
);
ctx.restore();

ctx.restore();

drawInstrument(video, overlayCanvas, outputCanvas, liveMetrics);
} else {
const emptyMetrics = {
...INITIAL_METRICS,
state: "ENTER FRAME" as AxisState,
};
setMetrics(emptyMetrics);
drawInstrument(video, overlayCanvas, outputCanvas, emptyMetrics);
}

rafRef.current = requestAnimationFrame(renderFrame);
}, [cameraFacing, drawInstrument, running]);

const startCamera = useCallback(async () => {
try {
setError("");
setStatusText("Starting camera");
stopLoop();
cleanupStream();

const pose = await loadPose();

const stream = await navigator.mediaDevices.getUserMedia({
audio: false,
video: {
facingMode: { ideal: cameraFacing },
width: { ideal: 1280 },
height: { ideal: 720 },
},
});

streamRef.current = stream;

const video = videoRef.current;
if (!video) return;

video.srcObject = stream;
await video.play();

poseRef.current = pose;
setCameraReady(true);
setRunning(true);
setStatusText("Live");
rafRef.current = requestAnimationFrame(renderFrame);
} catch (err) {
console.error(err);
setError("Camera or pose model failed to start.");
setStatusText("Start failed");
}
}, [cameraFacing, cleanupStream, loadPose, renderFrame, stopLoop]);

const stopCamera = useCallback(() => {
if (recording) {
const recorder = mediaRecorderRef.current;
if (recorder && recorder.state !== "inactive") recorder.stop();
setRecording(false);
}

setRunning(false);
setCameraReady(false);
setStatusText("Stopped");
stopLoop();
cleanupStream();
}, [cleanupStream, recording, stopLoop]);

const startRecording = useCallback(() => {
const outputCanvas = outputRef.current;
if (!outputCanvas || recording || !running) return;

setClipUrl("");
chunksRef.current = [];
clipStartRef.current = Date.now();

const stream = outputCanvas.captureStream(30);
const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
? "video/webm;codecs=vp9"
: "video/webm";

const recorder = new MediaRecorder(stream, { mimeType });

recorder.ondataavailable = (event) => {
if (event.data.size > 0) {
chunksRef.current.push(event.data);
}
};

recorder.onstop = () => {
const clipLength = clipStartRef.current
? Date.now() - clipStartRef.current
: 0;

clipStartRef.current = null;

if (clipLength < 500) {
setRecording(false);
setStatusText("Live");
return;
}

const blob = new Blob(chunksRef.current, { type: "video/webm" });
const url = URL.createObjectURL(blob);
setClipUrl(url);
setRecording(false);
setStatusText("Clip ready");
};

mediaRecorderRef.current = recorder;
recorder.start(200);
setRecording(true);
setStatusText("Recording");
}, [recording, running]);

const stopRecording = useCallback(() => {
if (holdTimeoutRef.current) {
window.clearTimeout(holdTimeoutRef.current);
holdTimeoutRef.current = null;
}

const recorder = mediaRecorderRef.current;
if (recorder && recorder.state !== "inactive") {
recorder.stop();
}
}, []);

const beginHoldRecord = useCallback(() => {
if (!running || !cameraReady || recording) return;

holdTimeoutRef.current = window.setTimeout(() => {
startRecording();
}, 120);
}, [cameraReady, recording, running, startRecording]);

const endHoldRecord = useCallback(() => {
if (holdTimeoutRef.current) {
window.clearTimeout(holdTimeoutRef.current);
holdTimeoutRef.current = null;
}

if (recording) {
stopRecording();
}
}, [recording, stopRecording]);

useEffect(() => {
return () => {
stopLoop();
cleanupStream();

if (holdTimeoutRef.current) {
window.clearTimeout(holdTimeoutRef.current);
}

if (clipUrl) URL.revokeObjectURL(clipUrl);

if (poseRef.current) {
poseRef.current.close();
poseRef.current = null;
}
};
}, [cleanupStream, clipUrl, stopLoop]);

useEffect(() => {
if (running) {
startCamera();
}
}, [cameraFacing, running, startCamera]);

return (
<main className="min-h-screen bg-[#05070a] text-white">
<div className="relative h-screen w-full overflow-hidden bg-black">
<video
ref={videoRef}
className={`absolute inset-0 h-full w-full object-cover ${
cameraFacing === "user" ? "scale-x-[-1]" : ""
}`}
muted
playsInline
autoPlay
/>

<canvas
ref={overlayRef}
className="pointer-events-none absolute inset-0 h-full w-full"
/>

<canvas
ref={outputRef}
className="pointer-events-none absolute -left-[99999px] top-0"
/>

<div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-start justify-between md:left-5 md:right-5 md:top-5">
<div className="rounded-[22px] border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-xl">
<div className="text-[10px] uppercase tracking-[0.32em] text-white/60">
Axis Camera
</div>
<div className="mt-1 text-sm font-medium text-white/90 md:text-base">
Measurement Instrument
</div>
<div
className="mt-1 text-2xl font-black leading-none md:text-4xl"
style={{ color: stateColor }}
>
{metrics.state}
</div>
</div>

<div className="rounded-[22px] border border-white/10 bg-black/25 px-4 py-3 text-right backdrop-blur-xl">
<div className="text-[10px] uppercase tracking-[0.32em] text-white/60">
Status
</div>
<div className="mt-1 text-xs text-white/88 md:text-sm">
{recording ? "Recording" : statusText}
</div>
<div className="mt-1 text-[11px] text-white/58 md:text-xs">
SCORE {metrics.axisScore}
</div>
</div>
</div>

<div className="absolute right-4 top-1/2 z-30 hidden w-[220px] -translate-y-1/2 md:block">
<div className="space-y-3 rounded-[24px] border border-white/10 bg-black/22 p-3 backdrop-blur-xl">
<GradeCard label="Axis Score" value={String(metrics.axisScore)} color="#ffffff" />
<GradeCard label="Stability" value={metrics.stabilityGrade} color={gradeColor(metrics.stabilityGrade)} />
<GradeCard label="Alignment" value={metrics.alignmentGrade} color={gradeColor(metrics.alignmentGrade)} />
<GradeCard label="Lean" value={metrics.leanGrade} color={gradeColor(metrics.leanGrade)} />
</div>
</div>

<div className="absolute bottom-28 left-4 right-4 z-30 md:hidden">
<div className="grid grid-cols-2 gap-3 rounded-[24px] border border-white/10 bg-black/24 p-3 backdrop-blur-xl">
<GradeCard label="Axis Score" value={String(metrics.axisScore)} color="#ffffff" compact />
<GradeCard label="Stability" value={metrics.stabilityGrade} color={gradeColor(metrics.stabilityGrade)} compact />
<GradeCard label="Alignment" value={metrics.alignmentGrade} color={gradeColor(metrics.alignmentGrade)} compact />
<GradeCard label="Lean" value={metrics.leanGrade} color={gradeColor(metrics.leanGrade)} compact />
</div>
</div>

<div className="absolute bottom-5 left-4 right-4 z-40 md:left-5 md:right-5">
<div className="rounded-[28px] border border-white/10 bg-black/35 p-3 backdrop-blur-xl">
<div className="grid grid-cols-3 gap-3">
{!running ? (
<ActionButton onClick={startCamera}>Start Camera</ActionButton>
) : (
<ActionButton onClick={stopCamera}>End Session</ActionButton>
)}

<ActionButton
onClick={() =>
setCameraFacing((prev) =>
prev === "environment" ? "user" : "environment",
)
}
>
Flip Camera
</ActionButton>

<HoldButton
disabled={!cameraReady || !running}
recording={recording}
onHoldStart={beginHoldRecord}
onHoldEnd={endHoldRecord}
>
Record
</HoldButton>
</div>

{clipUrl ? (
<div className="mt-3 grid grid-cols-2 gap-3">
<a
href={clipUrl}
download={`instrument-clip-${Date.now()}.webm`}
className="rounded-[18px] border border-white/10 bg-white/[0.07] px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/[0.12]"
>
Save Clip
</a>

<button
onClick={async () => {
try {
const res = await fetch(clipUrl);
const blob = await res.blob();
const file = new File([blob], "axis-instrument-clip.webm", {
type: blob.type || "video/webm",
});

if (
navigator.share &&
"canShare" in navigator &&
(navigator as Navigator & {
canShare?: (data?: ShareData) => boolean;
}).canShare?.({ files: [file] })
) {
await navigator.share({
files: [file],
title: "Axis Instrument Clip",
});
}
} catch (err) {
console.error(err);
}
}}
className="rounded-[18px] border border-white/10 bg-white/[0.07] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
>
Share
</button>
</div>
) : null}

{error ? (
<div className="mt-3 rounded-[18px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
{error}
</div>
) : null}
</div>
</div>
</div>
</main>
);
}

function GradeCard({
label,
value,
color,
compact = false,
}: {
label: string;
value: string;
color: string;
compact?: boolean;
}) {
return (
<div className="rounded-[18px] border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/55">
{label}
</div>
<div
className={`mt-1 font-black leading-none ${compact ? "text-2xl" : "text-3xl"}`}
style={{ color }}
>
{value}
</div>
</div>
);
}

function ActionButton({
children,
onClick,
disabled,
}: {
children: React.ReactNode;
onClick: () => void;
disabled?: boolean;
}) {
return (
<button
onClick={onClick}
disabled={disabled}
className="rounded-[18px] border border-white/10 bg-white/[0.07] px-4 py-4 text-sm font-semibold text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
>
{children}
</button>
);
}

function HoldButton({
children,
onHoldStart,
onHoldEnd,
disabled,
recording,
}: {
children: React.ReactNode;
onHoldStart: () => void;
onHoldEnd: () => void;
disabled?: boolean;
recording?: boolean;
}) {
return (
<button
disabled={disabled}
onMouseDown={onHoldStart}
onMouseUp={onHoldEnd}
onMouseLeave={onHoldEnd}
onTouchStart={(e) => {
e.preventDefault();
onHoldStart();
}}
onTouchEnd={(e) => {
e.preventDefault();
onHoldEnd();
}}
onTouchCancel={onHoldEnd}
className={`rounded-[18px] border px-4 py-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
recording
? "border-red-400/30 bg-red-500/15 text-red-100"
: "border-white/10 bg-white/[0.07] text-white hover:bg-white/[0.12]"
}`}
>
{recording ? "Recording" : children}
</button>
);
}