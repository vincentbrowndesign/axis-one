"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Landmark = {
x: number;
y: number;
z?: number;
visibility?: number;
};

type PoseLandmarkerResult = {
landmarks?: Landmark[][];
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

type AxisState = "ALIGNED" | "SHIFT" | "DROP" | "ENTER FRAME";
type DecisionAction = "PASS" | "DRIVE" | "SHOOT" | "HOLD";
type SessionPhase = "idle" | "starting" | "live";

type EventTone = "green" | "blue" | "yellow";

type EventItem = {
id: string;
title: string;
subtitle: string;
value: string;
tone: EventTone;
ts: string;
};

type DriftPoint = {
x: number;
y: number;
};

type BodyMetrics = {
nose: Landmark;
ls: Landmark;
rs: Landmark;
lh: Landmark;
rh: Landmark;
shoulderMid: { x: number; y: number };
hipMid: { x: number; y: number };
center: { x: number; y: number };
lean: number;
alignment: number;
stability: number;
centerScore: number;
tiltDegrees: number;
state: AxisState;
};

const UI_REFRESH_MS = 220;
const MAX_TRAIL_POINTS = 18;
const MAX_EVENTS = 8;

const SMOOTH_STABILITY = 0.12;
const SMOOTH_TILT = 0.18;
const SMOOTH_WINDOW = 0.12;
const SMOOTH_QUALITY = 0.14;

const ALIGNED_THRESHOLD = 0.8;
const SHIFT_THRESHOLD = 0.58;

const STATE_HOLD_MS = 280;
const LOST_GRACE_MS = 6000;

function clamp(value: number, min = 0, max = 1) {
return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
return a + (b - a) * t;
}

function shouldUpdateNumber(next: number, prev: number, epsilon: number) {
return Math.abs(next - prev) >= epsilon;
}

function nowTime() {
return new Date().toLocaleTimeString([], {
hour: "numeric",
minute: "2-digit",
second: "2-digit",
});
}

function gradeQuality(score: number): string {
if (score >= 85) return "GOOD";
if (score >= 70) return "OK";
return "LOW";
}

function pointVisible(p?: Landmark) {
return Boolean(p && (p.visibility ?? 1) > 0.35);
}

function midpoint(a: Landmark, b: Landmark) {
return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function computeBodyMetrics(landmarks?: Landmark[]): BodyMetrics | null {
if (!landmarks || landmarks.length < 25) return null;

const ls = landmarks[11];
const rs = landmarks[12];
const lh = landmarks[23];
const rh = landmarks[24];
const nose = landmarks[0];

if (![ls, rs, lh, rh, nose].every(pointVisible)) return null;

const shoulderMid = midpoint(ls, rs);
const hipMid = midpoint(lh, rh);

const dx = shoulderMid.x - hipMid.x;
const dy = shoulderMid.y - hipMid.y;
const torsoLength = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);

const lean = Math.abs(dx) / torsoLength;

const shoulderSlope =
Math.abs(ls.y - rs.y) / Math.max(Math.abs(ls.x - rs.x), 0.001);

const tiltDegrees = Math.min(
25,
Math.abs(Math.atan2(ls.y - rs.y, rs.x - ls.x)) * (180 / Math.PI)
);

const alignment = clamp(1 - lean * 1.6 - shoulderSlope * 0.6);
const stability = clamp(1 - lean * 1.1 - shoulderSlope * 0.25);
const centerScore = clamp(alignment * 0.56 + stability * 0.44);

const state: AxisState =
centerScore >= ALIGNED_THRESHOLD
? "ALIGNED"
: centerScore >= SHIFT_THRESHOLD
? "SHIFT"
: "DROP";

const center = {
x: hipMid.x,
y: (shoulderMid.y + hipMid.y) / 2,
};

return {
nose,
ls,
rs,
lh,
rh,
shoulderMid,
hipMid,
center,
lean,
alignment,
stability,
centerScore,
tiltDegrees,
state,
};
}

function toneClass(tone: EventTone) {
if (tone === "green") return "text-[#87f5a6] border-[#87f5a6]/25 bg-[#87f5a6]/10";
if (tone === "blue") return "text-[#79b8ff] border-[#79b8ff]/25 bg-[#79b8ff]/10";
return "text-[#f0d46c] border-[#f0d46c]/25 bg-[#f0d46c]/10";
}

export default function AxisCameraPage() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);

const poseRef = useRef<PoseLandmarkerInstance | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const rafRef = useRef<number | null>(null);

const mountedRef = useRef(false);
const runningRef = useRef(false);
const modelReadyRef = useRef(false);
const facingModeRef = useRef<"user" | "environment">("user");

const lastUiUpdateRef = useRef(0);
const lastDetectionRef = useRef(0);

const smoothedRef = useRef({
stability: 72,
tilt: 6,
windowMs: 640,
quality: 82,
});

const publishedRef = useRef({
score: 82,
stability: 76,
alignment: 640,
lean: 7,
});

const stateStableRef = useRef<{
current: AxisState;
pending: AxisState | null;
since: number | null;
}>({
current: "ENTER FRAME",
pending: null,
since: null,
});

const trailRef = useRef<DriftPoint[]>([]);
const latestBodyRef = useRef<BodyMetrics | null>(null);
const previousStateRef = useRef<AxisState>("ENTER FRAME");

const [phase, setPhase] = useState<SessionPhase>("idle");
const [status, setStatus] = useState("Motion Ready");
const [stateLabel, setStateLabel] = useState<AxisState>("ENTER FRAME");
const [stability, setStability] = useState(76);
const [decisionWindow, setDecisionWindow] = useState(657);
const [decisionQuality, setDecisionQuality] = useState("GOOD");
const [tiltLoad, setTiltLoad] = useState(7);
const [decisionAction, setDecisionAction] = useState<DecisionAction>("PASS");
const [events, setEvents] = useState<EventItem[]>([]);
const [isPaused, setIsPaused] = useState(false);
const [cameraLabel, setCameraLabel] = useState("Front");
const [isFlipping, setIsFlipping] = useState(false);

const stopStream = useCallback(() => {
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

const loadPoseModel = useCallback(async () => {
if (modelReadyRef.current || poseRef.current) return;

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
}, []);

const ensureCamera = useCallback(async () => {
if (streamRef.current && videoRef.current?.srcObject) {
const video = videoRef.current;
if (video && video.paused) await video.play();
return;
}

const video = videoRef.current;
if (!video) throw new Error("Video missing");

const constraints: MediaStreamConstraints = {
audio: false,
video: {
facingMode: { ideal: facingModeRef.current },
width: { ideal: 1080 },
height: { ideal: 1920 },
},
};

const stream = await navigator.mediaDevices.getUserMedia(constraints);
streamRef.current = stream;
video.srcObject = stream;
await video.play();
setCameraLabel(facingModeRef.current === "user" ? "Front" : "Back");
}, []);

const pushEvent = useCallback((item: Omit<EventItem, "id" | "ts">) => {
setEvents((prev) =>
[
{
...item,
id: `${Date.now()}-${Math.random()}`,
ts: nowTime(),
},
...prev,
].slice(0, MAX_EVENTS)
);
}, []);

const drawScope = useCallback(() => {
const canvas = scopeCanvasRef.current;
const video = videoRef.current;
if (!canvas) return;

const width = canvas.clientWidth || 900;
const height = canvas.clientHeight || 900;

if (canvas.width !== width || canvas.height !== height) {
canvas.width = width;
canvas.height = height;
}

const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.clearRect(0, 0, width, height);

const cx = width / 2;
const cy = height / 2;
const pad = 0;
const radius = Math.min(width, height) / 2 - 24;

if (video && video.videoWidth && video.videoHeight) {
const sourceAspect = video.videoWidth / video.videoHeight;
const destAspect = width / height;

let sx = 0;
let sy = 0;
let sw = video.videoWidth;
let sh = video.videoHeight;

if (sourceAspect > destAspect) {
sw = video.videoHeight * destAspect;
sx = (video.videoWidth - sw) / 2;
} else {
sh = video.videoWidth / destAspect;
sy = (video.videoHeight - sh) / 2;
}

ctx.save();
ctx.globalAlpha = 0.18;
ctx.filter = "grayscale(1) blur(0.6px) contrast(1.08) brightness(0.82)";
if (facingModeRef.current === "user") {
ctx.translate(width, 0);
ctx.scale(-1, 1);
}
ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
ctx.restore();
}

const glow = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
glow.addColorStop(0, "rgba(120,255,175,0.18)");
glow.addColorStop(0.45, "rgba(120,255,175,0.06)");
glow.addColorStop(1, "rgba(120,255,175,0)");
ctx.fillStyle = glow;
ctx.fillRect(0, 0, width, height);

ctx.save();

ctx.strokeStyle = "rgba(255,255,255,0.06)";
ctx.lineWidth = 1;

for (let i = 1; i <= 5; i += 1) {
const y = (height / 6) * i;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}

for (let i = 1; i <= 5; i += 1) {
const x = (width / 6) * i;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}

ctx.strokeStyle = "rgba(255,255,255,0.11)";
ctx.lineWidth = 1.5;
[0.18, 0.34, 0.56].forEach((ratio) => {
ctx.beginPath();
ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
ctx.stroke();
});

ctx.strokeStyle = "rgba(255,255,255,0.14)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(cx, 0);
ctx.lineTo(cx, height);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(0, cy);
ctx.lineTo(width, cy);
ctx.stroke();

const body = latestBodyRef.current;

if (body) {
const toCanvas = (p: { x: number; y: number }) => {
const xBase = facingModeRef.current === "user" ? 1 - p.x : p.x;
return {
x: xBase * width,
y: p.y * height,
};
};

const nose = toCanvas(body.nose);
const ls = toCanvas(body.ls);
const rs = toCanvas(body.rs);
const lh = toCanvas(body.lh);
const rh = toCanvas(body.rh);
const center = toCanvas(body.center);

ctx.save();
ctx.strokeStyle = "rgba(130,255,180,0.96)";
ctx.lineWidth = 4;
ctx.lineJoin = "round";
ctx.lineCap = "round";

ctx.beginPath();
ctx.moveTo(ls.x, ls.y);
ctx.quadraticCurveTo((ls.x + nose.x) / 2, (ls.y + nose.y) / 2, nose.x, nose.y);
ctx.quadraticCurveTo((nose.x + rs.x) / 2, (nose.y + rs.y) / 2, rs.x, rs.y);
ctx.lineTo(rh.x, rh.y);
ctx.quadraticCurveTo(center.x, rh.y + 18, lh.x, lh.y);
ctx.closePath();
ctx.stroke();

ctx.strokeStyle = "rgba(130,255,180,0.72)";
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(ls.x, ls.y);
ctx.lineTo(rs.x, rs.y);
ctx.stroke();

ctx.strokeStyle = "rgba(130,255,180,0.52)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo((ls.x + rs.x) / 2, (ls.y + rs.y) / 2);
ctx.lineTo((lh.x + rh.x) / 2, (lh.y + rh.y) / 2);
ctx.stroke();

ctx.fillStyle = "rgba(130,255,180,0.95)";
ctx.beginPath();
ctx.arc(nose.x, nose.y, 6, 0, Math.PI * 2);
ctx.fill();

if (trailRef.current.length > 1) {
ctx.strokeStyle = "rgba(130,255,180,0.44)";
ctx.lineWidth = 3;
ctx.beginPath();
trailRef.current.forEach((p, index) => {
const c = toCanvas(p);
if (index === 0) ctx.moveTo(c.x, c.y);
else ctx.lineTo(c.x, c.y);
});
ctx.stroke();
}

ctx.fillStyle = "rgba(130,255,180,1)";
ctx.shadowColor = "rgba(130,255,180,0.7)";
ctx.shadowBlur = 24;
ctx.beginPath();
ctx.arc(center.x, center.y, 9, 0, Math.PI * 2);
ctx.fill();
ctx.restore();
}

ctx.restore();
}, []);

const processFrame = useCallback(() => {
const video = videoRef.current;
const pose = poseRef.current;
if (!mountedRef.current || !runningRef.current || !video || !pose) return;

const now = performance.now();
let foundPose = false;

if (!isPaused && video.readyState >= 2) {
let result: PoseLandmarkerResult | null = null;

try {
result = pose.detectForVideo(video, now);
} catch {
result = null;
}

const body = computeBodyMetrics(result?.landmarks?.[0]);

if (body) {
foundPose = true;
latestBodyRef.current = body;
lastDetectionRef.current = now;

smoothedRef.current.stability = lerp(
smoothedRef.current.stability,
body.stability * 100,
SMOOTH_STABILITY
);
smoothedRef.current.tilt = lerp(
smoothedRef.current.tilt,
body.tiltDegrees,
SMOOTH_TILT
);
smoothedRef.current.windowMs = lerp(
smoothedRef.current.windowMs,
540 + body.centerScore * 240,
SMOOTH_WINDOW
);
smoothedRef.current.quality = lerp(
smoothedRef.current.quality,
body.centerScore * 100,
SMOOTH_QUALITY
);

const nextState = body.state;
const stable = stateStableRef.current;

if (stable.current === "ENTER FRAME") {
stable.current = nextState;
} else if (nextState !== stable.current) {
if (stable.pending !== nextState) {
stable.pending = nextState;
stable.since = now;
} else if (stable.since !== null && now - stable.since >= STATE_HOLD_MS) {
stable.current = nextState;
stable.pending = null;
stable.since = null;
}
} else {
stable.pending = null;
stable.since = null;
}

const publishedStability = Math.round(smoothedRef.current.stability);
const publishedTilt = Number(smoothedRef.current.tilt.toFixed(1));
const publishedWindow = Math.round(smoothedRef.current.windowMs);
const publishedQuality = Math.round(smoothedRef.current.quality);

if (shouldUpdateNumber(publishedStability, publishedRef.current.stability, 1)) {
publishedRef.current.stability = publishedStability;
}
if (shouldUpdateNumber(publishedTilt, publishedRef.current.lean, 0.2)) {
publishedRef.current.lean = publishedTilt;
}
if (shouldUpdateNumber(publishedWindow, publishedRef.current.alignment, 2)) {
publishedRef.current.alignment = publishedWindow;
}
if (shouldUpdateNumber(publishedQuality, publishedRef.current.score, 1)) {
publishedRef.current.score = publishedQuality;
}

trailRef.current.push({ x: body.center.x, y: body.center.y });
if (trailRef.current.length > MAX_TRAIL_POINTS) {
trailRef.current.shift();
}

const stableState = stable.current;

if (stableState !== previousStateRef.current) {
if (stableState === "ALIGNED") {
pushEvent({
title: "CLEAN WINDOW",
subtitle: `${previousStateRef.current} → ALIGNED`,
value: `Window ${publishedWindow} ms`,
tone: "green",
});
} else if (stableState === "SHIFT") {
pushEvent({
title: "STATE SHIFT",
subtitle: `${previousStateRef.current} → SHIFT`,
value: `Tilt ${publishedTilt.toFixed(1)}°`,
tone: "yellow",
});
} else if (stableState === "DROP") {
pushEvent({
title: "RECOVERY FOUND",
subtitle: `${previousStateRef.current} → DROP`,
value: `Stability ${publishedStability}`,
tone: "blue",
});
}

previousStateRef.current = stableState;
}

if (now - lastUiUpdateRef.current >= UI_REFRESH_MS) {
lastUiUpdateRef.current = now;
setStateLabel(stableState);
setStability(Math.round(publishedRef.current.stability));
setTiltLoad(Number(publishedRef.current.lean.toFixed(1)));
setDecisionWindow(Math.round(publishedRef.current.alignment));
setDecisionQuality(gradeQuality(publishedRef.current.score));
setStatus("Motion Ready");
}
}
}

const lostFor = now - lastDetectionRef.current;
if (!foundPose && lostFor <= LOST_GRACE_MS && latestBodyRef.current) {
if (now - lastUiUpdateRef.current >= UI_REFRESH_MS) {
lastUiUpdateRef.current = now;
setStatus("Tracking lost");
}
}

drawScope();

if (runningRef.current) {
rafRef.current = requestAnimationFrame(processFrame);
}
}, [drawScope, isPaused, pushEvent]);

const startSystem = useCallback(async () => {
if (phase === "starting" || phase === "live") return;

setPhase("starting");
setStatus("Starting");

try {
await loadPoseModel();
await ensureCamera();

runningRef.current = true;
setPhase("live");
setStatus("Motion Ready");

if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = requestAnimationFrame(processFrame);
} catch (error) {
console.error(error);
setPhase("idle");
setStatus("Camera failed");
}
}, [ensureCamera, loadPoseModel, phase, processFrame]);

const flipCamera = useCallback(async () => {
if (isFlipping) return;

setIsFlipping(true);
setStatus("Flipping camera");

const wasLive = phase === "live";
runningRef.current = false;

if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}

stopStream();
facingModeRef.current = facingModeRef.current === "user" ? "environment" : "user";

try {
await ensureCamera();

if (wasLive) {
runningRef.current = true;
setPhase("live");
setStatus("Motion Ready");
rafRef.current = requestAnimationFrame(processFrame);
} else {
setStatus("Motion Ready");
}
} catch (error) {
console.error(error);
setPhase("idle");
setStatus("Camera failed");
} finally {
setIsFlipping(false);
}
}, [ensureCamera, isFlipping, phase, processFrame, stopStream]);

const resetSystem = useCallback(() => {
trailRef.current = [];
latestBodyRef.current = null;
previousStateRef.current = "ENTER FRAME";
stateStableRef.current = {
current: "ENTER FRAME",
pending: null,
since: null,
};
publishedRef.current = {
score: 82,
stability: 76,
alignment: 640,
lean: 7,
};
smoothedRef.current = {
stability: 72,
tilt: 6,
windowMs: 640,
quality: 82,
};
setEvents([]);
setStateLabel("ENTER FRAME");
setStability(76);
setDecisionWindow(640);
setDecisionQuality("GOOD");
setTiltLoad(7);
setStatus("Motion Ready");
drawScope();
}, [drawScope]);

useEffect(() => {
mountedRef.current = true;
drawScope();

return () => {
mountedRef.current = false;
runningRef.current = false;

if (rafRef.current) cancelAnimationFrame(rafRef.current);
stopStream();
if (poseRef.current?.close) poseRef.current.close();
poseRef.current = null;
modelReadyRef.current = false;
};
}, [drawScope, stopStream]);

const stateColor = useMemo(() => {
if (stateLabel === "ALIGNED") return "text-[#87f5a6]";
if (stateLabel === "SHIFT") return "text-[#d7f06c]";
if (stateLabel === "DROP") return "text-[#79b8ff]";
return "text-white";
}, [stateLabel]);

return (
<main className="min-h-screen bg-black text-white">
<video ref={videoRef} playsInline muted autoPlay className="hidden" />

<div className="mx-auto max-w-5xl px-4 pb-16 pt-6 md:pt-8">
<section className="rounded-[34px] border border-white/8 bg-white/[0.02] p-5 shadow-[0_0_60px_rgba(0,0,0,0.45)] md:p-6">
<div className="mb-4 flex items-center gap-3 text-[12px] uppercase tracking-[0.42em] text-white/55">
<span className="h-3 w-3 rounded-full bg-[#87f5a6]" />
AXIS RUN INSTRUMENT
</div>

<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
<div>
<h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
State.Window.Decision.
</h1>
<p className="mt-3 max-w-3xl text-lg text-white/65">
Axis captures movement transitions automatically and logs live state events.
</p>
</div>

<div className="text-right text-sm uppercase tracking-[0.28em] text-white/45">
{cameraLabel} Camera
</div>
</div>

<div className="mt-6 flex flex-wrap gap-3">
<button
onClick={() => setStatus("Motion Ready")}
className="rounded-[22px] border border-white/70 px-5 py-3 text-xl font-medium"
>
Motion Ready
</button>

<button
onClick={startSystem}
disabled={phase === "starting"}
className="rounded-[22px] bg-white px-5 py-3 text-xl font-semibold text-black disabled:opacity-60"
>
{phase === "starting" ? "Starting..." : phase === "live" ? "Live" : "Start"}
</button>

<button
onClick={flipCamera}
disabled={isFlipping}
className="rounded-[22px] border border-white/70 px-5 py-3 text-xl font-medium disabled:opacity-60"
>
{isFlipping ? "Flipping..." : "Flip Camera"}
</button>

<button
onClick={() => setIsPaused((prev) => !prev)}
className="rounded-[22px] border border-white/70 px-5 py-3 text-xl font-medium"
>
{isPaused ? "Resume" : "Pause"}
</button>

<button
onClick={resetSystem}
className="rounded-[22px] border border-white/70 px-5 py-3 text-xl font-medium"
>
Reset
</button>
</div>

<div className="my-6 h-px bg-white/16" />

<section>
<div className="mb-3 flex items-start justify-between gap-4">
<div>
<div className="text-[34px] font-semibold leading-none md:text-[44px]">AXIS SCOPE</div>
<div className="mt-1 text-[12px] uppercase tracking-[0.36em] text-white/42">
LIVE STATE FIELD
</div>
</div>

<div className="text-right">
<div className={`text-[32px] font-semibold leading-none md:text-[44px] ${stateColor}`}>
{stateLabel}
</div>
<div className="mt-2 text-sm uppercase tracking-[0.28em] text-white/45">{status}</div>
</div>
</div>

<canvas
ref={scopeCanvasRef}
className="block h-[56vh] min-h-[420px] w-full rounded-[28px] md:h-[68vh] md:min-h-[620px]"
/>
</section>

<div className="mt-5 grid gap-4 md:grid-cols-4">
<CompactMetric
label="Stability"
value={`${stability}%`}
tone="green"
/>
<CompactMetric
label="Decision Window"
value={`${decisionWindow} ms`}
tone="blue"
/>
<CompactMetric
label="Quality"
value={decisionQuality}
tone="green"
/>
<CompactMetric
label="Tilt Load"
value={`${tiltLoad.toFixed(1)}°`}
tone="yellow"
/>
</div>

<div className="mt-5 grid gap-5 md:grid-cols-[0.8fr_1.2fr]">
<section className="rounded-[28px] border border-white/8 bg-white/[0.015] p-5">
<div className="mb-5 text-[12px] uppercase tracking-[0.42em] text-white/50">
DECISION INPUT
</div>

<div className="grid grid-cols-2 gap-3">
{(["SHOOT", "DRIVE", "PASS", "HOLD"] as DecisionAction[]).map((action) => {
const active = decisionAction === action;
return (
<button
key={action}
onClick={() => setDecisionAction(action)}
className={`rounded-[20px] border px-5 py-5 text-left text-[18px] transition md:text-[22px] ${
active
? "border-white/80 bg-white/[0.03] text-white"
: "border-white/10 bg-white/[0.02] text-white/70"
}`}
>
{action}
</button>
);
})}
</div>
</section>

<section className="rounded-[28px] border border-white/8 bg-white/[0.015] p-5">
<div className="mb-5 flex items-center justify-between gap-4">
<div className="text-[12px] uppercase tracking-[0.42em] text-white/50">
EVENT HISTORY
</div>
<div className="text-lg text-white/45">{events.length} events</div>
</div>

<div className="space-y-3">
{events.length === 0 ? (
<div className="rounded-[20px] border border-white/10 p-5 text-xl text-white/50">
No events yet.
</div>
) : (
events.map((event) => (
<div
key={event.id}
className="rounded-[20px] border border-white/10 bg-black/60 p-4"
>
<div className="flex items-start justify-between gap-4">
<div className="flex min-w-0 items-start gap-3">
<span
className={`mt-1 h-3.5 w-3.5 rounded-full ${
event.tone === "green"
? "bg-[#87f5a6]"
: event.tone === "blue"
? "bg-[#79b8ff]"
: "bg-[#f0d46c]"
}`}
/>
<div className="min-w-0">
<div className="text-[20px] font-semibold leading-tight md:text-[24px]">
{event.title}
</div>
<div className="mt-1 text-[15px] text-white/45 md:text-[17px]">
{event.ts}
</div>
</div>
</div>

<span
className={`shrink-0 rounded-full border px-4 py-2 text-[16px] font-medium md:text-[18px] ${toneClass(
event.tone
)}`}
>
{event.tone === "green"
? "GOOD"
: event.tone === "blue"
? "RECOVER"
: "SHIFT"}
</span>
</div>

<div className="mt-3 text-[18px] text-white/58 md:text-[22px]">
{event.subtitle}
</div>
<div className="mt-2 text-[17px] text-white/60 md:text-[20px]">
{event.value} &nbsp; Action {decisionAction}
</div>
</div>
))
)}
</div>
</section>
</div>
</section>
</div>
</main>
);
}

function CompactMetric({
label,
value,
tone,
}: {
label: string;
value: string;
tone: "green" | "blue" | "yellow";
}) {
const dotClass =
tone === "green"
? "bg-[#87f5a6] shadow-[0_0_20px_rgba(135,245,166,0.65)]"
: tone === "blue"
? "bg-[#79b8ff] shadow-[0_0_20px_rgba(121,184,255,0.65)]"
: "bg-[#d7f06c] shadow-[0_0_20px_rgba(215,240,108,0.55)]";

return (
<section className="rounded-[24px] border border-white/8 bg-white/[0.015] p-4">
<div className="mb-3 flex items-center justify-between gap-4">
<div className="text-[11px] uppercase tracking-[0.34em] text-white/48">{label}</div>
<span className={`h-3.5 w-3.5 rounded-full ${dotClass}`} />
</div>
<div className="text-[30px] font-semibold leading-none md:text-[38px]">{value}</div>
</section>
);
}