"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
DrawingUtils,
FilesetResolver,
PoseLandmarker,
} from "@mediapipe/tasks-vision";

type AxisState = "LOCK" | "LOAD" | "SHIFT" | "DROP" | "OFF AXIS";

type Metrics = {
state: AxisState;
stability: number;
alignment: number;
lean: number;
driftX: number;
driftY: number;
};

type PosePoint = {
x: number;
y: number;
z?: number;
visibility?: number;
};

const STATE_COLORS: Record<AxisState, string> = {
LOCK: "#79ff4d",
LOAD: "#58a6ff",
SHIFT: "#ffd84d",
DROP: "#ff6b6b",
"OFF AXIS": "#ff9a57",
};

const INITIAL_METRICS: Metrics = {
state: "LOCK",
stability: 100,
alignment: 100,
lean: 0,
driftX: 0,
driftY: 0,
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

const alignment = Math.round(alignmentRaw * 100);
const stability = Math.round(stabilityRaw * 100);

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

return {
state,
stability: clamp(stability, 0, 100),
alignment: clamp(alignment, 0, 100),
lean: round(lean, 2),
driftX: round(driftX, 2),
driftY: round(driftY, 2),
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
const lastVideoTimeRef = useRef<number>(-1);

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

octx.fillStyle = "rgba(3, 5, 8, 0.14)";
octx.fillRect(0, 0, width, height);

const isWide = width >= 900;
const pad = Math.max(18, width * 0.02);

const topLeftW = isWide ? 280 : Math.min(width * 0.56, 320);
const topLeftH = isWide ? 88 : 92;

octx.save();
octx.fillStyle = "rgba(10, 12, 16, 0.28)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.2;
drawRoundedRect(octx, pad, pad, topLeftW, topLeftH, 20);
octx.fill();
octx.stroke();

octx.fillStyle = "rgba(255,255,255,0.78)";
octx.font = isWide
? "600 11px Inter, Arial, sans-serif"
: "600 10px Inter, Arial, sans-serif";
octx.fillText("AXIS CAMERA", pad + 16, pad + 22);

octx.font = isWide
? "600 18px Inter, Arial, sans-serif"
: "600 16px Inter, Arial, sans-serif";
octx.fillStyle = "rgba(255,255,255,0.92)";
octx.fillText("Measurement Instrument", pad + 16, pad + 44);

octx.font = isWide
? "900 34px Inter, Arial, sans-serif"
: "900 28px Inter, Arial, sans-serif";
octx.fillStyle = stateColor;
octx.fillText(liveMetrics.state, pad + 16, pad + 76);
octx.restore();

const statusW = isWide ? 230 : Math.min(width * 0.28, 180);
const statusH = isWide ? 88 : 92;
const statusX = width - pad - statusW;

octx.save();
octx.fillStyle = "rgba(10, 12, 16, 0.28)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.2;
drawRoundedRect(octx, statusX, pad, statusW, statusH, 20);
octx.fill();
octx.stroke();

octx.textAlign = "right";
octx.fillStyle = "rgba(255,255,255,0.78)";
octx.font = isWide
? "600 11px Inter, Arial, sans-serif"
: "600 10px Inter, Arial, sans-serif";
octx.fillText("STATUS", statusX + statusW - 16, pad + 22);

octx.fillStyle = "rgba(255,255,255,0.92)";
octx.font = isWide
? "600 15px Inter, Arial, sans-serif"
: "600 13px Inter, Arial, sans-serif";
octx.fillText(
recording ? "Instrument clip recording" : "Live measurement active",
statusX + statusW - 16,
pad + 48,
);

octx.fillStyle = "rgba(255,255,255,0.68)";
octx.font = isWide
? "500 13px Inter, Arial, sans-serif"
: "500 11px Inter, Arial, sans-serif";
octx.fillText(
`DRIFT ${liveMetrics.driftX.toFixed(2)} / ${liveMetrics.driftY.toFixed(2)}`,
statusX + statusW - 16,
pad + 70,
);
octx.textAlign = "left";
octx.restore();

const cards = [
{ label: "STATE", value: liveMetrics.state, accent: stateColor },
{ label: "STABILITY", value: `${liveMetrics.stability}%`, accent: "#ffffff" },
{ label: "ALIGNMENT", value: `${liveMetrics.alignment}%`, accent: "#ffffff" },
{ label: "LEAN", value: liveMetrics.lean.toFixed(2), accent: "#ffffff" },
{ label: "LOCK", value: "LIVE", accent: "#ffffff" },
];

if (isWide) {
const sideW = Math.min(290, width * 0.24);
const cardH = 78;
const gap = 12;
const totalH = cards.length * cardH + (cards.length - 1) * gap;
const sideX = width - pad - sideW;
const sideY = Math.max((height - totalH) / 2, pad + 110);

cards.forEach((card, index) => {
const y = sideY + index * (cardH + gap);

octx.save();
octx.fillStyle = "rgba(14, 16, 21, 0.30)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.2;
drawRoundedRect(octx, sideX, y, sideW, cardH, 20);
octx.fill();
octx.stroke();

octx.fillStyle = "rgba(255,255,255,0.60)";
octx.font = "600 11px Inter, Arial, sans-serif";
octx.fillText(card.label, sideX + 16, y + 22);

octx.fillStyle = card.accent;
octx.font = "900 24px Inter, Arial, sans-serif";
octx.fillText(card.value, sideX + 16, y + 54);
octx.restore();
});
} else {
const cardW = width - pad * 2;
const cardH = 80;
const gap = 12;
const totalH = cards.length * cardH + (cards.length - 1) * gap;
const startY = height - pad - totalH - 10;

cards.forEach((card, index) => {
const y = startY + index * (cardH + gap);

octx.save();
octx.fillStyle = "rgba(14, 16, 21, 0.30)";
octx.strokeStyle = "rgba(255,255,255,0.10)";
octx.lineWidth = 1.2;
drawRoundedRect(octx, pad, y, cardW, cardH, 20);
octx.fill();
octx.stroke();

octx.fillStyle = "rgba(255,255,255,0.60)";
octx.font = "600 11px Inter, Arial, sans-serif";
octx.fillText(card.label, pad + 16, y + 22);

octx.fillStyle = card.accent;
octx.font = "900 26px Inter, Arial, sans-serif";
octx.fillText(card.value, pad + 16, y + 56);
octx.restore();
});
}

if (recording) {
octx.save();
octx.fillStyle = "#ff4d4d";
octx.beginPath();
octx.arc(pad + 10, height - pad - 10, 8, 0, Math.PI * 2);
octx.fill();

octx.fillStyle = "rgba(255,255,255,0.94)";
octx.font = "700 14px Inter, Arial, sans-serif";
octx.fillText("INSTRUMENT CLIP", pad + 26, height - pad - 4);
octx.restore();
}
},
[recording, stateColor],
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

const axisX =
((shoulderCenter.x + hipCenter.x + ankleCenter.x) / 3) * width;

ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.22)";
ctx.lineWidth = 2;
ctx.setLineDash([8, 10]);
ctx.beginPath();
ctx.moveTo(axisX, height * 0.08);
ctx.lineTo(axisX, height * 0.94);
ctx.stroke();
ctx.restore();

ctx.restore();

drawInstrument(video, overlayCanvas, outputCanvas, liveMetrics);
} else {
drawInstrument(video, overlayCanvas, outputCanvas, metrics);
}

rafRef.current = requestAnimationFrame(renderFrame);
}, [cameraFacing, drawInstrument, metrics, running]);

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
setStatusText("Live measurement active");
rafRef.current = requestAnimationFrame(renderFrame);
} catch (err) {
console.error(err);
setError("Camera or pose model failed to start.");
setStatusText("Start failed");
}
}, [cameraFacing, cleanupStream, loadPose, renderFrame, stopLoop]);

const stopCamera = useCallback(() => {
setRunning(false);
setCameraReady(false);
setStatusText("Stopped");
stopLoop();
cleanupStream();
}, [cleanupStream, stopLoop]);

const startRecording = useCallback(() => {
const outputCanvas = outputRef.current;
if (!outputCanvas || recording) return;

setClipUrl("");
chunksRef.current = [];

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
const blob = new Blob(chunksRef.current, { type: "video/webm" });
const url = URL.createObjectURL(blob);
setClipUrl(url);
setRecording(false);
setStatusText("Instrument clip ready");
};

mediaRecorderRef.current = recorder;
recorder.start(250);
setRecording(true);
setStatusText("Recording instrument clip");
}, [recording]);

const stopRecording = useCallback(() => {
const recorder = mediaRecorderRef.current;
if (recorder && recorder.state !== "inactive") {
recorder.stop();
}
}, []);

useEffect(() => {
return () => {
stopLoop();
cleanupStream();
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
}, [cameraFacing]);

return (
<main className="min-h-screen bg-[#05070a] text-white">
<div className="mx-auto flex min-h-screen w-full bg-[#05070a]">
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
{statusText}
</div>
<div className="mt-1 text-[11px] text-white/58 md:text-xs">
DRIFT {metrics.driftX.toFixed(2)} / {metrics.driftY.toFixed(2)}
</div>
</div>
</div>

<div className="absolute bottom-4 left-4 right-4 z-30 md:hidden">
<div className="space-y-3 rounded-[28px] border border-white/10 bg-black/32 p-3 backdrop-blur-xl">
<MetricCard label="STATE" value={metrics.state} accent={stateColor} />
<MetricCard label="STABILITY" value={`${metrics.stability}%`} />
<MetricCard label="ALIGNMENT" value={`${metrics.alignment}%`} />
<MetricCard label="LEAN" value={metrics.lean.toFixed(2)} />
<MetricCard label="LOCK" value="LIVE" />

<div className="grid grid-cols-2 gap-3 pt-1">
{!running ? (
<ControlButton onClick={startCamera}>Start Camera</ControlButton>
) : (
<ControlButton onClick={stopCamera}>Stop Camera</ControlButton>
)}

<ControlButton
onClick={() =>
setCameraFacing((prev) =>
prev === "environment" ? "user" : "environment",
)
}
>
Use {cameraFacing === "environment" ? "Front" : "Back"} Camera
</ControlButton>

{!recording ? (
<ControlButton
onClick={startRecording}
disabled={!cameraReady || !running}
>
Start Instrument Clip
</ControlButton>
) : (
<ControlButton onClick={stopRecording}>
Stop Instrument Clip
</ControlButton>
)}

<ControlButton
onClick={() => {
setMetrics(INITIAL_METRICS);
setError("");
setStatusText(running ? "Live measurement active" : "Idle");
}}
>
Reset Read
</ControlButton>
</div>

{clipUrl ? (
<a
href={clipUrl}
download={`instrument-clip-${Date.now()}.webm`}
className="block rounded-[20px] border border-white/10 bg-white/10 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/15"
>
Download Instrument Clip
</a>
) : null}

{error ? (
<div className="rounded-[20px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
{error}
</div>
) : null}
</div>
</div>

<div className="absolute right-5 top-1/2 z-30 hidden w-[290px] -translate-y-1/2 md:block">
<div className="space-y-3 rounded-[28px] border border-white/10 bg-black/22 p-3 backdrop-blur-xl">
<MetricCard label="STATE" value={metrics.state} accent={stateColor} />
<MetricCard label="STABILITY" value={`${metrics.stability}%`} />
<MetricCard label="ALIGNMENT" value={`${metrics.alignment}%`} />
<MetricCard label="LEAN" value={metrics.lean.toFixed(2)} />
<MetricCard label="LOCK" value="LIVE" />

<div className="grid grid-cols-2 gap-3 pt-1">
{!running ? (
<ControlButton onClick={startCamera}>Start Camera</ControlButton>
) : (
<ControlButton onClick={stopCamera}>Stop Camera</ControlButton>
)}

<ControlButton
onClick={() =>
setCameraFacing((prev) =>
prev === "environment" ? "user" : "environment",
)
}
>
Use {cameraFacing === "environment" ? "Front" : "Back"} Camera
</ControlButton>

{!recording ? (
<ControlButton
onClick={startRecording}
disabled={!cameraReady || !running}
>
Start Instrument Clip
</ControlButton>
) : (
<ControlButton onClick={stopRecording}>
Stop Instrument Clip
</ControlButton>
)}

<ControlButton
onClick={() => {
setMetrics(INITIAL_METRICS);
setError("");
setStatusText(running ? "Live measurement active" : "Idle");
}}
>
Reset Read
</ControlButton>
</div>

{clipUrl ? (
<a
href={clipUrl}
download={`instrument-clip-${Date.now()}.webm`}
className="block rounded-[20px] border border-white/10 bg-white/10 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/15"
>
Download Instrument Clip
</a>
) : null}

{error ? (
<div className="rounded-[20px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
{error}
</div>
) : null}
</div>
</div>
</div>
</div>
</main>
);
}

function MetricCard({
label,
value,
accent,
}: {
label: string;
value: string;
accent?: string;
}) {
return (
<div className="rounded-[22px] border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
<div className="text-[10px] uppercase tracking-[0.3em] text-white/55">
{label}
</div>
<div
className="mt-1 text-3xl font-black leading-none"
style={{ color: accent ?? "#fff" }}
>
{value}
</div>
</div>
);
}

function ControlButton({
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
className="rounded-[18px] border border-white/10 bg-white/[0.07] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
>
{children}
</button>
);
}