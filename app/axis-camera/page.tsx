"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PoseLandmarkerResult = {
landmarks?: Array<Array<{ x: number; y: number; z?: number; visibility?: number }>>;
};

type FilesetResolverType = {
forVisionTasks(basePath: string): Promise<unknown>;
};

type PoseLandmarkerInstance = {
setOptions(options: Record<string, unknown>): Promise<void>;
detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult;
close?: () => void;
};

type TasksVisionModule = {
FilesetResolver: FilesetResolverType;
PoseLandmarker: {
createFromOptions(
vision: unknown,
options: Record<string, unknown>
): Promise<PoseLandmarkerInstance>;
};
};

type AxisState = "ENTER FRAME" | "LOCK" | "SHIFT" | "DROP" | "RECOVER";

type Grade = "A" | "B" | "C" | "D" | "F" | "--";

type UiSnapshot = {
score: number;
stability: number;
alignment: number;
lean: number;
state: AxisState;
status: string;
live: boolean;
};

type Point = { x: number; y: number };

const UI_REFRESH_MS = 800;
const MAX_HOLD_MS = 1200;
const HISTORY_SIZE = 18;

const INITIAL_UI: UiSnapshot = {
score: 0,
stability: 0,
alignment: 0,
lean: 0,
state: "ENTER FRAME",
status: "Ready",
live: false,
};

function clamp(value: number, min = 0, max = 1) {
return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
return a + (b - a) * t;
}

function average(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function gradeFromScore(score: number): Grade {
if (score >= 92) return "A";
if (score >= 84) return "B";
if (score >= 74) return "C";
if (score >= 64) return "D";
return "F";
}

function mapScoreToState(
stability: number,
alignment: number,
lean: number,
previousState: AxisState
): AxisState {
if (stability === 0 && alignment === 0) return "ENTER FRAME";
if (alignment >= 90 && stability >= 90 && lean <= 0.06) return "LOCK";
if (alignment >= 80 && stability >= 80 && lean <= 0.12) return "RECOVER";
if (lean >= 0.24 || alignment < 55 || stability < 55) return "DROP";
if (lean >= 0.12 || alignment < 78 || stability < 78) return "SHIFT";
return previousState === "DROP" ? "RECOVER" : "LOCK";
}

function computeShoulderData(
leftShoulder?: { x: number; y: number; visibility?: number },
rightShoulder?: { x: number; y: number; visibility?: number },
leftHip?: { x: number; y: number; visibility?: number },
rightHip?: { x: number; y: number; visibility?: number }
) {
if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

const shoulderCenter = {
x: (leftShoulder.x + rightShoulder.x) / 2,
y: (leftShoulder.y + rightShoulder.y) / 2,
};

const hipCenter = {
x: (leftHip.x + rightHip.x) / 2,
y: (leftHip.y + rightHip.y) / 2,
};

const dx = shoulderCenter.x - hipCenter.x;
const dy = shoulderCenter.y - hipCenter.y;
const torsoLength = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
const lean = Math.abs(dx) / torsoLength;

const shoulderSlope =
Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(0.001, Math.abs(leftShoulder.x - rightShoulder.x));

const alignment = clamp(1 - lean * 2.2) * 100;
const levelnessPenalty = clamp(shoulderSlope * 2.6);
const postureAlignment = clamp(alignment / 100 - levelnessPenalty * 0.35) * 100;

return {
shoulderCenter,
hipCenter,
lean,
torsoLength,
alignment: postureAlignment,
};
}

export default function AxisCameraPage() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayRef = useRef<HTMLCanvasElement | null>(null);

const streamRef = useRef<MediaStream | null>(null);
const rafRef = useRef<number | null>(null);
const poseRef = useRef<PoseLandmarkerInstance | null>(null);

const lastUiUpdateRef = useRef<number>(0);
const lastGoodDetectionRef = useRef<number>(0);
const mountedRef = useRef<boolean>(false);

const usingFrontCameraRef = useRef<boolean>(true);
const runningRef = useRef<boolean>(false);
const modelReadyRef = useRef<boolean>(false);

const smoothedRef = useRef({
score: 0,
stability: 0,
alignment: 0,
lean: 0,
state: "ENTER FRAME" as AxisState,
});

const historyRef = useRef<UiSnapshot[]>([]);
const lastGoodGeometryRef = useRef<{
shoulderCenter: Point;
hipCenter: Point;
bodyLineX: number;
} | null>(null);

const [ui, setUi] = useState<UiSnapshot>(INITIAL_UI);
const [status, setStatus] = useState<string>("Loading camera");
const [cameraLabel, setCameraLabel] = useState<"Front View" | "Back View">("Front View");
const [recording, setRecording] = useState<boolean>(false);

const scoreGrade = useMemo(() => gradeFromScore(ui.score), [ui.score]);
const stabilityGrade = useMemo(() => (ui.live ? gradeFromScore(ui.stability) : "--"), [ui.live, ui.stability]);
const alignmentGrade = useMemo(() => (ui.live ? gradeFromScore(ui.alignment) : "--"), [ui.live, ui.alignment]);
const leanGrade = useMemo(() => {
if (!ui.live) return "--";
if (ui.lean <= 0.05) return "A";
if (ui.lean <= 0.09) return "B";
if (ui.lean <= 0.14) return "C";
if (ui.lean <= 0.2) return "D";
return "F";
}, [ui.live, ui.lean]);

const drawScope = useCallback(
(geometry?: { shoulderCenter: Point; hipCenter: Point; bodyLineX: number } | null, live = false) => {
const canvas = overlayRef.current;
const video = videoRef.current;
if (!canvas || !video) return;

const ctx = canvas.getContext("2d");
if (!ctx) return;

const width = video.videoWidth || window.innerWidth;
const height = video.videoHeight || window.innerHeight;

if (canvas.width !== width || canvas.height !== height) {
canvas.width = width;
canvas.height = height;
}

ctx.clearRect(0, 0, width, height);

// center instrument field
const scopeSize = Math.min(width * 0.52, height * 0.34);
const cx = width / 2;
const cy = height * 0.43;
const radius = scopeSize / 2;

ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.09)";
ctx.lineWidth = 1.5;

for (let i = 1; i <= 4; i += 1) {
ctx.beginPath();
ctx.arc(cx, cy, (radius / 4) * i, 0, Math.PI * 2);
ctx.stroke();
}

ctx.beginPath();
ctx.moveTo(cx - radius, cy);
ctx.lineTo(cx + radius, cy);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(cx, cy - radius);
ctx.lineTo(cx, cy + radius);
ctx.stroke();

ctx.fillStyle = "rgba(255,255,255,0.14)";
ctx.beginPath();
ctx.arc(cx, cy, 5, 0, Math.PI * 2);
ctx.fill();

if (geometry && live) {
const { shoulderCenter, hipCenter, bodyLineX } = geometry;

const centerBodyX = ((shoulderCenter.x + hipCenter.x) / 2) * width;
const centerBodyY = ((shoulderCenter.y + hipCenter.y) / 2) * height;
const vectorX = clamp((centerBodyX - bodyLineX) / (width * 0.18), -1, 1) * (radius * 0.82);
const vectorY = clamp((centerBodyY - cy) / (height * 0.2), -1, 1) * (radius * 0.7);

const dotX = cx + vectorX;
const dotY = cy + vectorY;

const ringAlpha = clamp(ui.stability / 100, 0.18, 1);
ctx.strokeStyle =
ui.state === "DROP"
? `rgba(255,102,102,${ringAlpha})`
: ui.state === "SHIFT"
? `rgba(255,196,92,${ringAlpha})`
: `rgba(117,255,192,${ringAlpha})`;

ctx.lineWidth = 3;
ctx.beginPath();
ctx.arc(cx, cy, radius * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(ui.score / 100));
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.24)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(cx, cy);
ctx.lineTo(dotX, dotY);
ctx.stroke();

ctx.fillStyle =
ui.state === "DROP" ? "#ff6b6b" : ui.state === "SHIFT" ? "#ffc15c" : "#75ffc0";
ctx.beginPath();
ctx.arc(dotX, dotY, 8, 0, Math.PI * 2);
ctx.fill();
}

ctx.restore();
},
[ui.score, ui.stability, ui.state]
);

const stopCamera = useCallback(() => {
runningRef.current = false;
if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}

if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}
}, []);

const startCamera = useCallback(async () => {
const video = videoRef.current;
if (!video) return;

try {
stopCamera();
setStatus("Starting camera");

const constraints: MediaStreamConstraints = {
audio: false,
video: {
facingMode: usingFrontCameraRef.current ? "user" : { ideal: "environment" },
width: { ideal: 1080 },
height: { ideal: 1920 },
},
};

const stream = await navigator.mediaDevices.getUserMedia(constraints);
streamRef.current = stream;
video.srcObject = stream;
await video.play();

runningRef.current = true;
setCameraLabel(usingFrontCameraRef.current ? "Front View" : "Back View");
setStatus(modelReadyRef.current ? "Live measurement active" : "Loading pose model");
} catch (error) {
console.error(error);
setStatus("Camera failed to start");
setUi((prev) => ({ ...prev, live: false, status: "Camera failed" }));
}
}, [stopCamera]);

const loadPoseModel = useCallback(async () => {
if (modelReadyRef.current || poseRef.current) return;

try {
setStatus("Loading pose model");

const visionModule = (await import("@mediapipe/tasks-vision")) as unknown as TasksVisionModule;
const vision = await visionModule.FilesetResolver.forVisionTasks(
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
);

poseRef.current = await visionModule.PoseLandmarker.createFromOptions(vision, {
baseOptions: {
modelAssetPath:
"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
delegate: "GPU",
},
runningMode: "VIDEO",
numPoses: 1,
minPoseDetectionConfidence: 0.58,
minPosePresenceConfidence: 0.58,
minTrackingConfidence: 0.58,
});

modelReadyRef.current = true;
setStatus("Pose model ready");
} catch (error) {
console.error(error);
modelReadyRef.current = false;
setStatus("Pose model failed to start");
setUi((prev) => ({
...prev,
live: false,
status: "Start failed",
}));
}
}, []);

const endSession = useCallback(() => {
stopCamera();
historyRef.current = [];
lastGoodGeometryRef.current = null;
smoothedRef.current = {
score: 0,
stability: 0,
alignment: 0,
lean: 0,
state: "ENTER FRAME",
};
setRecording(false);
setStatus("Session ended");
setUi({
score: 0,
stability: 0,
alignment: 0,
lean: 0,
state: "ENTER FRAME",
status: "Ready",
live: false,
});
drawScope(null, false);
}, [drawScope, stopCamera]);

const pushUiHistory = useCallback((snapshot: UiSnapshot) => {
historyRef.current.push(snapshot);
if (historyRef.current.length > HISTORY_SIZE) {
historyRef.current.shift();
}
}, []);

const updateUiFromHistory = useCallback(
(fallbackStatus?: string) => {
const current = historyRef.current;
if (!current.length) {
const next = {
...INITIAL_UI,
status: fallbackStatus ?? status,
};
setUi(next);
return;
}

const score = average(current.map((item) => item.score));
const stability = average(current.map((item) => item.stability));
const alignment = average(current.map((item) => item.alignment));
const lean = average(current.map((item) => item.lean));
const state = current[current.length - 1].state;

setUi({
score: Math.round(score),
stability: Math.round(stability),
alignment: Math.round(alignment),
lean: Number(lean.toFixed(2)),
state,
status: fallbackStatus ?? "Live",
live: true,
});
},
[status]
);

const processFrame = useCallback(() => {
const video = videoRef.current;
const pose = poseRef.current;
if (!mountedRef.current || !runningRef.current || !video || !pose) {
return;
}

const now = performance.now();

let liveThisFrame = false;

try {
if (video.readyState >= 2) {
const result = pose.detectForVideo(video, now);
const landmarks = result.landmarks?.[0];

if (landmarks && landmarks.length > 24) {
const leftShoulder = landmarks[11];
const rightShoulder = landmarks[12];
const leftHip = landmarks[23];
const rightHip = landmarks[24];

const geometry = computeShoulderData(leftShoulder, rightShoulder, leftHip, rightHip);

if (geometry) {
const varianceLean = Math.abs(geometry.lean - smoothedRef.current.lean);
const targetAlignment = geometry.alignment;
const targetStability = clamp(1 - varianceLean * 10) * 100;
const targetScore = clamp(targetAlignment / 100 * 0.58 + targetStability / 100 * 0.42) * 100;

smoothedRef.current.alignment = lerp(smoothedRef.current.alignment, targetAlignment, 0.14);
smoothedRef.current.stability = lerp(smoothedRef.current.stability, targetStability, 0.16);
smoothedRef.current.lean = lerp(smoothedRef.current.lean, geometry.lean, 0.14);
smoothedRef.current.score = lerp(smoothedRef.current.score, targetScore, 0.15);

smoothedRef.current.state = mapScoreToState(
smoothedRef.current.stability,
smoothedRef.current.alignment,
smoothedRef.current.lean,
smoothedRef.current.state
);

const bodyLineX = ((geometry.shoulderCenter.x + geometry.hipCenter.x) / 2) * (video.videoWidth || 1);

lastGoodGeometryRef.current = {
shoulderCenter: geometry.shoulderCenter,
hipCenter: geometry.hipCenter,
bodyLineX,
};

lastGoodDetectionRef.current = now;
liveThisFrame = true;

pushUiHistory({
score: smoothedRef.current.score,
stability: smoothedRef.current.stability,
alignment: smoothedRef.current.alignment,
lean: smoothedRef.current.lean,
state: smoothedRef.current.state,
status: "Live",
live: true,
});
}
}
}
} catch (error) {
console.error(error);
setStatus("Measurement read failed");
}

const held = now - lastGoodDetectionRef.current <= MAX_HOLD_MS;
drawScope(lastGoodGeometryRef.current, liveThisFrame || held);

if (now - lastUiUpdateRef.current > UI_REFRESH_MS) {
lastUiUpdateRef.current = now;

if (liveThisFrame || held) {
updateUiFromHistory("Live");
} else {
const previousState = smoothedRef.current.state === "DROP" ? "RECOVER" : "ENTER FRAME";
setUi((prev) => ({
...prev,
state: previousState,
status: "Enter frame",
live: false,
}));
}
}

rafRef.current = requestAnimationFrame(processFrame);
}, [drawScope, pushUiHistory, updateUiFromHistory]);

const startSession = useCallback(async () => {
await loadPoseModel();
await startCamera();

if (!runningRef.current || !modelReadyRef.current) {
setUi((prev) => ({
...prev,
status: "Start failed",
live: false,
}));
return;
}

historyRef.current = [];
lastUiUpdateRef.current = performance.now();
setStatus("Live measurement active");
setUi((prev) => ({
...prev,
status: "Live",
live: true,
}));

if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = requestAnimationFrame(processFrame);
}, [loadPoseModel, processFrame, startCamera]);

const flipCamera = useCallback(async () => {
usingFrontCameraRef.current = !usingFrontCameraRef.current;
await startSession();
}, [startSession]);

useEffect(() => {
mountedRef.current = true;

void startSession();

return () => {
mountedRef.current = false;
endSession();
if (poseRef.current?.close) poseRef.current.close();
poseRef.current = null;
modelReadyRef.current = false;
};
}, [endSession, startSession]);

return (
<main className="relative min-h-screen bg-black text-white overflow-hidden">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="absolute inset-0 h-full w-full object-cover"
style={{ transform: usingFrontCameraRef.current ? "scaleX(-1)" : "none" }}
/>

<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(24,33,100,0.30),rgba(0,0,0,0.72)_70%)]" />

<canvas
ref={overlayRef}
className="absolute inset-0 h-full w-full"
style={{ transform: usingFrontCameraRef.current ? "scaleX(-1)" : "none" }}
/>

<div className="relative z-10 mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 pb-8 pt-5">
<div className="flex items-start justify-between gap-4">
<div className="rounded-[28px] border border-white/10 bg-black/26 px-5 py-4 backdrop-blur-xl">
<div className="text-[11px] uppercase tracking-[0.4em] text-white/45">Axis Camera</div>
<div className="mt-2 text-[20px] leading-none text-white/86">Measurement Instrument</div>
<div
className={`mt-2 text-[28px] font-semibold leading-none ${
ui.state === "DROP"
? "text-[#ff6b6b]"
: ui.state === "SHIFT"
? "text-[#ffc15c]"
: ui.state === "RECOVER"
? "text-[#ffd86b]"
: ui.state === "LOCK"
? "text-[#75ffc0]"
: "text-white"
}`}
>
{ui.state}
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-black/26 px-5 py-4 text-right backdrop-blur-xl">
<div className="text-[11px] uppercase tracking-[0.4em] text-white/45">Status</div>
<div className="mt-2 text-[18px] text-white/86">{status}</div>
<div className="mt-2 text-[14px] text-white/55">Score {ui.score}</div>
</div>
</div>

<div className="flex-1" />

<div className="rounded-[30px] border border-white/10 bg-black/28 p-4 backdrop-blur-2xl">
<div className="grid grid-cols-2 gap-3">
<MetricCard label="Axis Score" value={String(ui.score)} accent="white" />
<MetricCard label="Stability" value={stabilityGrade} accent={gradeAccent(stabilityGrade)} />
<MetricCard label="Alignment" value={alignmentGrade} accent={gradeAccent(alignmentGrade)} />
<MetricCard label="Lean" value={leanGrade} accent={gradeAccent(leanGrade)} />
</div>

<div className="mt-4 grid grid-cols-3 gap-3">
<ControlButton onClick={endSession}>End Session</ControlButton>
<ControlButton onClick={flipCamera}>Flip Camera</ControlButton>
<ControlButton
onClick={() => setRecording((prev) => !prev)}
active={recording}
>
{recording ? "Recording" : "Record"}
</ControlButton>
</div>

<div className="mt-4 flex items-center justify-between rounded-[24px] border border-white/10 bg-black/35 px-4 py-3">
<div className="text-[12px] uppercase tracking-[0.28em] text-white/42">{cameraLabel}</div>
<div className="text-[13px] text-white/55">
Instrument underneath. Product on top.
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
accent: "white" | "green" | "yellow" | "red";
}) {
const colorClass =
accent === "green"
? "text-[#75ffc0]"
: accent === "yellow"
? "text-[#ffc15c]"
: accent === "red"
? "text-[#ff7c7c]"
: "text-white";

return (
<div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-5 py-4">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/42">{label}</div>
<div className={`mt-3 text-[48px] font-semibold leading-none ${colorClass}`}>{value}</div>
</div>
);
}

function ControlButton({
children,
onClick,
active = false,
}: {
children: React.ReactNode;
onClick: () => void;
active?: boolean;
}) {
return (
<button
onClick={onClick}
className={`rounded-[24px] border px-4 py-5 text-center text-[18px] font-medium transition ${
active
? "border-[#75ffc0]/45 bg-[#75ffc0]/14 text-white"
: "border-white/10 bg-white/[0.04] text-white/92 hover:bg-white/[0.08]"
}`}
>
{children}
</button>
);
}

function gradeAccent(grade: Grade): "white" | "green" | "yellow" | "red" {
if (grade === "A" || grade === "B") return "green";
if (grade === "C" || grade === "D") return "yellow";
if (grade === "F") return "red";
return "white";
}