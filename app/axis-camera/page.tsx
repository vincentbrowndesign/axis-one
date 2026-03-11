"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PoseLandmarkerResult = {
landmarks?: Array<Array<{ x: number; y: number; z?: number; visibility?: number }>>;
};

type FilesetResolverType = {
forVisionTasks(basePath: string): Promise<unknown>;
};

type PoseLandmarkerInstance = {
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

type AxisState = "ENTER FRAME" | "CENTER" | "SHIFT" | "DROP";
type Grade = "A" | "B" | "C" | "D" | "F" | "--";

type Point = {
x: number;
y: number;
};

type UiSnapshot = {
score: number;
stability: number;
alignment: number;
lean: number;
centerScore: number;
state: AxisState;
reading: number;
axisRecoveryMs: number | null;
status: string;
live: boolean;
};

type RecoveryTracker = {
active: boolean;
startMs: number | null;
holdStartMs: number | null;
lastCompletedMs: number | null;
};

const UI_REFRESH_MS = 220;
const MAX_HOLD_MS = 1000;
const HISTORY_SIZE = 18;

const CENTER_THRESHOLD = 0.82;
const SHIFT_THRESHOLD = 0.6;
const LEAN_MAX = 0.25;
const RECOVERY_HOLD_MS = 400;

const INITIAL_UI: UiSnapshot = {
score: 0,
stability: 0,
alignment: 0,
lean: 0,
centerScore: 0,
state: "ENTER FRAME",
reading: 0,
axisRecoveryMs: null,
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
Math.abs(leftShoulder.y - rightShoulder.y) /
Math.max(0.001, Math.abs(leftShoulder.x - rightShoulder.x));

const alignmentBase = clamp(1 - lean * 2.2) * 100;
const levelnessPenalty = clamp(shoulderSlope * 2.6);
const alignment = clamp(alignmentBase / 100 - levelnessPenalty * 0.35) * 100;

return {
shoulderCenter,
hipCenter,
lean,
torsoLength,
alignment,
};
}

function computeCenterScore(alignment: number, stability: number, lean: number) {
const alignmentN = alignment / 100;
const stabilityN = stability / 100;
const leanN = 1 - clamp(lean / LEAN_MAX, 0, 1);

return clamp(0.45 * alignmentN + 0.4 * stabilityN + 0.15 * leanN, 0, 1);
}

function stateFromCenterScore(centerScore: number): AxisState {
if (centerScore >= CENTER_THRESHOLD) return "CENTER";
if (centerScore >= SHIFT_THRESHOLD) return "SHIFT";
return "DROP";
}

function gradeAccent(grade: Grade): "white" | "green" | "yellow" | "red" {
if (grade === "A" || grade === "B") return "green";
if (grade === "C" || grade === "D") return "yellow";
if (grade === "F") return "red";
return "white";
}

function stateAccent(state: AxisState): "white" | "green" | "yellow" | "red" {
if (state === "CENTER") return "green";
if (state === "SHIFT") return "yellow";
if (state === "DROP") return "red";
return "white";
}

export default function AxisCameraPage() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayRef = useRef<HTMLCanvasElement | null>(null);

const streamRef = useRef<MediaStream | null>(null);
const rafRef = useRef<number | null>(null);
const poseRef = useRef<PoseLandmarkerInstance | null>(null);

const mountedRef = useRef(false);
const modelReadyRef = useRef(false);
const runningRef = useRef(false);
const usingFrontCameraRef = useRef(false);

const lastUiUpdateRef = useRef(0);
const lastGoodDetectionRef = useRef(0);

const recoveryRef = useRef<RecoveryTracker>({
active: false,
startMs: null,
holdStartMs: null,
lastCompletedMs: null,
});

const smoothedRef = useRef({
score: 0,
stability: 0,
alignment: 0,
lean: 0,
centerScore: 0,
state: "ENTER FRAME" as AxisState,
});

const lastGoodGeometryRef = useRef<{
shoulderCenter: Point;
hipCenter: Point;
driftX: number;
driftY: number;
} | null>(null);

const historyRef = useRef<UiSnapshot[]>([]);

const [ui, setUi] = useState<UiSnapshot>(INITIAL_UI);
const [status, setStatus] = useState("Ready");
const [cameraLabel, setCameraLabel] = useState<"Front View" | "Back View">("Back View");
const [recording, setRecording] = useState(false);
const [starting, setStarting] = useState(false);
const [hasStartedOnce, setHasStartedOnce] = useState(false);

const stabilityGrade = useMemo(
() => (ui.live ? gradeFromScore(ui.stability) : "--"),
[ui.live, ui.stability]
);
const alignmentGrade = useMemo(
() => (ui.live ? gradeFromScore(ui.alignment) : "--"),
[ui.live, ui.alignment]
);
const leanGrade = useMemo(() => {
if (!ui.live) return "--";
if (ui.lean <= 0.05) return "A";
if (ui.lean <= 0.09) return "B";
if (ui.lean <= 0.14) return "C";
if (ui.lean <= 0.2) return "D";
return "F";
}, [ui.live, ui.lean]);

const drawScope = useCallback(
(
geometry?: {
shoulderCenter: Point;
hipCenter: Point;
driftX: number;
driftY: number;
} | null,
live = false
) => {
const canvas = overlayRef.current;
const video = videoRef.current;
if (!canvas) return;

const width = video?.videoWidth || window.innerWidth;
const height = video?.videoHeight || window.innerHeight;

if (canvas.width !== width || canvas.height !== height) {
canvas.width = width;
canvas.height = height;
}

const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.clearRect(0, 0, width, height);

const scopeHeight = Math.min(height * 0.34, width * 0.52);
const cx = width / 2;
const cy = height * 0.43;
const lineTop = cy - scopeHeight / 2;
const lineBottom = cy + scopeHeight / 2;

ctx.save();

ctx.strokeStyle = "rgba(255,255,255,0.16)";
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(cx, lineTop);
ctx.lineTo(cx, lineBottom);
ctx.stroke();

ctx.strokeStyle = "rgba(255,255,255,0.12)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(cx - 34, cy);
ctx.lineTo(cx + 34, cy);
ctx.stroke();

ctx.beginPath();
ctx.arc(cx, cy, 16, 0, Math.PI * 2);
ctx.stroke();

ctx.fillStyle = "rgba(255,255,255,0.22)";
ctx.beginPath();
ctx.arc(cx, cy, 4, 0, Math.PI * 2);
ctx.fill();

if (geometry && live) {
const dotX = cx + geometry.driftX * 180;
const dotY = cy + geometry.driftY * 120;

const lineColor =
ui.state === "DROP"
? "#ff6b6b"
: ui.state === "SHIFT"
? "#ffc15c"
: "#75ffc0";

ctx.strokeStyle = lineColor;
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(cx, cy);
ctx.lineTo(dotX, dotY);
ctx.stroke();

const angle = Math.atan2(dotY - cy, dotX - cx);
const arrowSize = 12;

ctx.beginPath();
ctx.moveTo(dotX, dotY);
ctx.lineTo(
dotX - arrowSize * Math.cos(angle - Math.PI / 6),
dotY - arrowSize * Math.sin(angle - Math.PI / 6)
);
ctx.moveTo(dotX, dotY);
ctx.lineTo(
dotX - arrowSize * Math.cos(angle + Math.PI / 6),
dotY - arrowSize * Math.sin(angle + Math.PI / 6)
);
ctx.stroke();

ctx.fillStyle = lineColor;
ctx.beginPath();
ctx.arc(dotX, dotY, 10, 0, Math.PI * 2);
ctx.fill();
}

ctx.restore();
},
[ui.state]
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

const video = videoRef.current;
if (video) {
video.pause();
video.srcObject = null;
}
}, []);

const openCameraStream = useCallback(async (front: boolean) => {
const video = videoRef.current;
if (!video) throw new Error("Video element missing");

const constraintsList: MediaStreamConstraints[] = front
? [
{
audio: false,
video: {
facingMode: "user",
width: { ideal: 1080 },
height: { ideal: 1920 },
},
},
{
audio: false,
video: true,
},
]
: [
{
audio: false,
video: {
facingMode: { ideal: "environment" },
width: { ideal: 1080 },
height: { ideal: 1920 },
},
},
{
audio: false,
video: {
facingMode: "environment",
},
},
{
audio: false,
video: true,
},
];

let lastError: unknown = null;

for (const constraints of constraintsList) {
try {
const stream = await navigator.mediaDevices.getUserMedia(constraints);
streamRef.current = stream;
video.srcObject = stream;
await video.play();

video.width = video.videoWidth || 720;
video.height = video.videoHeight || 1280;

return stream;
} catch (error) {
lastError = error;
}
}

throw lastError ?? new Error("Unable to open camera");
}, []);

const startCamera = useCallback(async () => {
try {
stopCamera();
setStatus("Starting camera");

try {
await openCameraStream(usingFrontCameraRef.current);
} catch (firstError) {
console.warn("Preferred camera failed trying fallback", firstError);
usingFrontCameraRef.current = !usingFrontCameraRef.current;
await openCameraStream(usingFrontCameraRef.current);
}

runningRef.current = true;
setCameraLabel(usingFrontCameraRef.current ? "Front View" : "Back View");
setStatus(modelReadyRef.current ? "Live measurement active" : "Loading pose model");
} catch (error) {
console.error(error);
setStatus("Camera failed to start");
setUi((prev) => ({
...prev,
live: false,
status: "Camera failed",
state: "ENTER FRAME",
}));
}
}, [openCameraStream, stopCamera]);

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
status: "Pose model failed",
}));
throw error;
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
centerScore: 0,
state: "ENTER FRAME",
};

recoveryRef.current = {
active: false,
startMs: null,
holdStartMs: null,
lastCompletedMs: null,
};

setRecording(false);
setStatus("Ready");
setUi({
...INITIAL_UI,
status: "Ready",
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
setUi({
...INITIAL_UI,
status: fallbackStatus ?? status,
});
return;
}

const score = average(current.map((item) => item.score));
const stability = average(current.map((item) => item.stability));
const alignment = average(current.map((item) => item.alignment));
const lean = average(current.map((item) => item.lean));
const centerScore = average(current.map((item) => item.centerScore));
const reading = Math.round(score);
const state = current[current.length - 1].state;
const axisRecoveryMs = recoveryRef.current.lastCompletedMs;

setUi({
score: Math.round(score),
stability: Math.round(stability),
alignment: Math.round(alignment),
lean: Number(lean.toFixed(2)),
centerScore: Number(centerScore.toFixed(2)),
state,
reading,
axisRecoveryMs,
status: fallbackStatus ?? "Live",
live: true,
});
},
[status]
);

const processFrame = useCallback(() => {
const video = videoRef.current;
const pose = poseRef.current;

if (!mountedRef.current || !runningRef.current || !video || !pose) return;

const now = performance.now();
let liveThisFrame = false;

try {
if (video.readyState >= 2) {
let result: PoseLandmarkerResult | null = null;

try {
result = pose.detectForVideo(video, now);
} catch (error) {
console.warn("Pose read skipped", error);
result = null;
}

const landmarks = result?.landmarks?.[0];

if (landmarks && landmarks.length > 24) {
const geometry = computeShoulderData(landmarks[11], landmarks[12], landmarks[23], landmarks[24]);

if (geometry) {
const varianceLean = Math.abs(geometry.lean - smoothedRef.current.lean);
const targetAlignment = geometry.alignment;
const targetStability = clamp(1 - varianceLean * 10) * 100;
const targetCenterScore = computeCenterScore(
targetAlignment,
targetStability,
geometry.lean
);
const targetScore = targetCenterScore * 100;

smoothedRef.current.alignment = lerp(smoothedRef.current.alignment, targetAlignment, 0.14);
smoothedRef.current.stability = lerp(smoothedRef.current.stability, targetStability, 0.16);
smoothedRef.current.lean = lerp(smoothedRef.current.lean, geometry.lean, 0.14);
smoothedRef.current.centerScore = lerp(
smoothedRef.current.centerScore,
targetCenterScore,
0.18
);
smoothedRef.current.score = lerp(smoothedRef.current.score, targetScore, 0.15);
smoothedRef.current.state = stateFromCenterScore(smoothedRef.current.centerScore);

const prevState = historyRef.current.length
? historyRef.current[historyRef.current.length - 1].state
: "ENTER FRAME";

if (
!recoveryRef.current.active &&
prevState === "CENTER" &&
(smoothedRef.current.state === "SHIFT" || smoothedRef.current.state === "DROP")
) {
recoveryRef.current.active = true;
recoveryRef.current.startMs = now;
recoveryRef.current.holdStartMs = null;
}

if (recoveryRef.current.active) {
if (smoothedRef.current.state === "CENTER") {
if (recoveryRef.current.holdStartMs === null) {
recoveryRef.current.holdStartMs = now;
}

if (
recoveryRef.current.startMs !== null &&
now - recoveryRef.current.holdStartMs >= RECOVERY_HOLD_MS
) {
recoveryRef.current.lastCompletedMs = now - recoveryRef.current.startMs;
recoveryRef.current.active = false;
recoveryRef.current.startMs = null;
recoveryRef.current.holdStartMs = null;
}
} else {
recoveryRef.current.holdStartMs = null;
}
}

const driftX = clamp((geometry.hipCenter.x - 0.5) * 2.4, -1, 1);
const driftY = clamp((geometry.hipCenter.y - 0.52) * 2.0, -1, 1);

lastGoodGeometryRef.current = {
shoulderCenter: geometry.shoulderCenter,
hipCenter: geometry.hipCenter,
driftX,
driftY,
};

lastGoodDetectionRef.current = now;
liveThisFrame = true;

pushUiHistory({
score: smoothedRef.current.score,
stability: smoothedRef.current.stability,
alignment: smoothedRef.current.alignment,
lean: smoothedRef.current.lean,
centerScore: smoothedRef.current.centerScore,
state: smoothedRef.current.state,
reading: Math.round(smoothedRef.current.score),
axisRecoveryMs: recoveryRef.current.lastCompletedMs,
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
setUi((prev) => ({
...prev,
state: "ENTER FRAME",
status: "Enter frame",
live: false,
}));
}
}

if (runningRef.current) {
rafRef.current = requestAnimationFrame(processFrame);
}
}, [drawScope, pushUiHistory, updateUiFromHistory]);

const startSession = useCallback(async () => {
if (starting) return;

setStarting(true);
setHasStartedOnce(true);

try {
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

if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}

setStatus("Live measurement active");
setUi((prev) => ({
...prev,
status: "Live",
live: true,
}));

rafRef.current = requestAnimationFrame(processFrame);
} finally {
setStarting(false);
}
}, [loadPoseModel, processFrame, startCamera, starting]);

const flipCamera = useCallback(async () => {
usingFrontCameraRef.current = !usingFrontCameraRef.current;
await startSession();
}, [startSession]);

useEffect(() => {
mountedRef.current = true;
drawScope(null, false);

return () => {
mountedRef.current = false;
endSession();
if (poseRef.current?.close) poseRef.current.close();
poseRef.current = null;
modelReadyRef.current = false;
};
}, [drawScope, endSession]);

const axisRecoveryLabel =
ui.axisRecoveryMs === null ? "--" : `${(ui.axisRecoveryMs / 1000).toFixed(2)}s`;

return (
<main className="relative min-h-screen overflow-hidden bg-black text-white">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="absolute inset-0 h-full w-full object-cover"
style={{ transform: usingFrontCameraRef.current ? "scaleX(-1)" : "none" }}
/>

<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(18,31,64,0.22),rgba(0,0,0,0.74)_70%)]" />

<canvas
ref={overlayRef}
className="absolute inset-0 h-full w-full"
style={{ transform: usingFrontCameraRef.current ? "scaleX(-1)" : "none" }}
/>

<div className="relative z-10 mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 pb-8 pt-5">
<div className="flex items-start justify-between gap-4">
<div className="rounded-[28px] border border-white/10 bg-black/28 px-5 py-4 backdrop-blur-xl">
<div className="text-[12px] uppercase tracking-[0.42em] text-white/44">AXIS SCOPE</div>
<div className="mt-2 text-[18px] text-white/80">Measure your center.</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-black/28 px-5 py-4 text-right backdrop-blur-xl">
<div className="text-[11px] uppercase tracking-[0.4em] text-white/45">Status</div>
<div className="mt-2 text-[18px] text-white/86">{status}</div>
<div className="mt-2 text-[13px] text-white/55">{cameraLabel}</div>
</div>
</div>

{!ui.live && (
<div className="mt-5">
<button
onClick={startSession}
disabled={starting}
className="rounded-[24px] border border-white/10 bg-white/[0.06] px-6 py-4 text-[18px] font-medium text-white transition hover:bg-white/[0.1] disabled:opacity-60"
>
{starting ? "Starting…" : hasStartedOnce ? "Start Measurement" : "Allow Camera and Start"}
</button>
</div>
)}

<div className="flex-1" />

<div className="rounded-[30px] border border-white/10 bg-black/28 p-4 backdrop-blur-2xl">
<div className="grid grid-cols-2 gap-3">
<MetricCard
label="State"
value={ui.state}
accent={stateAccent(ui.state)}
textSize="text-[34px]"
/>
<MetricCard
label="Reading"
value={String(ui.reading)}
accent="white"
textSize="text-[52px]"
/>
<MetricCard
label="Axis Recovery"
value={axisRecoveryLabel}
accent="green"
textSize="text-[36px]"
/>
<MetricCard
label="Stability"
value={stabilityGrade}
accent={gradeAccent(stabilityGrade)}
textSize="text-[52px]"
/>
</div>

<div className="mt-3 grid grid-cols-2 gap-3">
<SmallMetric
label="Alignment"
value={alignmentGrade}
accent={gradeAccent(alignmentGrade)}
/>
<SmallMetric label="Lean" value={leanGrade} accent={gradeAccent(leanGrade)} />
</div>

<div className="mt-4 grid grid-cols-3 gap-3">
<ControlButton onClick={endSession}>End Session</ControlButton>
<ControlButton onClick={flipCamera}>Flip Camera</ControlButton>
<ControlButton onClick={() => setRecording((prev) => !prev)} active={recording}>
{recording ? "Recording" : "Record"}
</ControlButton>
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
textSize,
}: {
label: string;
value: string;
accent: "white" | "green" | "yellow" | "red";
textSize: string;
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
<div className={`mt-3 ${textSize} font-semibold leading-none ${colorClass}`}>{value}</div>
</div>
);
}

function SmallMetric({
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
<div className="rounded-[22px] border border-white/10 bg-white/[0.035] px-4 py-3">
<div className="text-[11px] uppercase tracking-[0.32em] text-white/42">{label}</div>
<div className={`mt-2 text-[30px] font-semibold leading-none ${colorClass}`}>{value}</div>
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