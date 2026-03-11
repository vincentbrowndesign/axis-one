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
velocity: number;
state: AxisState;
};

const UI_REFRESH_MS = 220;
const MAX_TRAIL_POINTS = 22;
const MAX_EVENTS = 8;

const SMOOTH_STABILITY = 0.18;
const SMOOTH_TILT = 0.16;
const SMOOTH_WINDOW = 0.12;
const SMOOTH_QUALITY = 0.14;
const SMOOTH_VELOCITY = 0.2;

const ALIGNED_THRESHOLD = 0.82;
const SHIFT_THRESHOLD = 0.58;

const STATE_HOLD_MS = 240;
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

function distance2D(a: { x: number; y: number }, b: { x: number; y: number }) {
const dx = a.x - b.x;
const dy = a.y - b.y;
return Math.sqrt(dx * dx + dy * dy);
}

function computeBodyMetrics(
landmarks: Landmark[] | undefined,
previousCenter: { x: number; y: number } | null,
dtMs: number
): BodyMetrics | null {
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

const center = {
x: hipMid.x,
y: (shoulderMid.y + hipMid.y) / 2,
};

const rawAlignment = clamp(1 - lean * 1.45 - shoulderSlope * 0.58);

let velocity = 0;
if (previousCenter && dtMs > 0) {
const dist = distance2D(center, previousCenter);
velocity = dist / dtMs;
}

const velocityPenalty = clamp(velocity * 22, 0, 1);
const leanPenalty = clamp(lean * 0.9, 0, 1);
const tiltPenalty = clamp((tiltDegrees / 25) * 0.55, 0, 1);

const rawStability = clamp(
1 - (velocityPenalty * 0.6 + leanPenalty * 0.25 + tiltPenalty * 0.15),
0,
1
);

const centerScore = clamp(rawAlignment * 0.48 + rawStability * 0.52);

const state: AxisState =
centerScore >= ALIGNED_THRESHOLD
? "ALIGNED"
: centerScore >= SHIFT_THRESHOLD
? "SHIFT"
: "DROP";

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
alignment: rawAlignment,
stability: rawStability,
centerScore,
tiltDegrees,
velocity,
state,
};
}

function toneClass(tone: EventTone) {
if (tone === "green") return "text-[#5CFF9A] border-[#5CFF9A]/20 bg-[#5CFF9A]/8";
if (tone === "blue") return "text-[#5FB3FF] border-[#5FB3FF]/20 bg-[#5FB3FF]/8";
return "text-[#FFD95A] border-[#FFD95A]/20 bg-[#FFD95A]/8";
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
const lastFrameTsRef = useRef<number | null>(null);
const previousCenterRef = useRef<{ x: number; y: number } | null>(null);

const smoothedRef = useRef({
stability: 74,
tilt: 6,
windowMs: 640,
quality: 82,
velocity: 0,
});

const publishedRef = useRef({
score: 82,
stability: 76,
alignment: 640,
lean: 7,
velocity: 0,
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
const [velocityRead, setVelocityRead] = useState(0);
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

const width = canvas.clientWidth || 1200;
const height = canvas.clientHeight || 1200;

if (canvas.width !== width || canvas.height !== height) {
canvas.width = width;
canvas.height = height;
}

const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.clearRect(0, 0, width, height);

const cx = width / 2;
const cy = height / 2;
const radius = Math.min(width, height) / 2 - 20;

ctx.fillStyle = "#090909";
ctx.fillRect(0, 0, width, height);

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
ctx.globalAlpha = 0.17;
ctx.filter = "grayscale(1) blur(0.8px) contrast(1.05) brightness(0.7)";
if (facingModeRef.current === "user") {
ctx.translate(width, 0);
ctx.scale(-1, 1);
}
ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
ctx.restore();
}

const glow = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
glow.addColorStop(0, "rgba(92,255,154,0.08)");
glow.addColorStop(0.45, "rgba(92,255,154,0.03)");
glow.addColorStop(1, "rgba(92,255,154,0)");
ctx.fillStyle = glow;
ctx.fillRect(0, 0, width, height);

ctx.save();

ctx.strokeStyle = "rgba(255,255,255,0.045)";
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

ctx.strokeStyle = "rgba(210,220,220,0.08)";
ctx.lineWidth = 1.2;
[0.18, 0.34, 0.56].forEach((ratio) => {
ctx.beginPath();
ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
ctx.stroke();
});

ctx.strokeStyle = "rgba(255,255,255,0.11)";
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

const ls = toCanvas(body.ls);
const rs = toCanvas(body.rs);
const shoulderMid = toCanvas(body.shoulderMid);
const hipMid = toCanvas(body.hipMid);
const center = toCanvas(body.center);

ctx.save();

// shoulder bar
ctx.strokeStyle = "rgba(92,255,154,0.7)";
ctx.lineWidth = 3.5;
ctx.beginPath();
ctx.moveTo(ls.x, ls.y);
ctx.lineTo(rs.x, rs.y);
ctx.stroke();

// spine / center line
ctx.strokeStyle = "rgba(92,255,154,0.42)";
ctx.lineWidth = 2.2;
ctx.beginPath();
ctx.moveTo(shoulderMid.x, shoulderMid.y);
ctx.lineTo(hipMid.x, hipMid.y);
ctx.stroke();

// motion trail
if (trailRef.current.length > 1) {
trailRef.current.forEach((p, i) => {
const c = toCanvas(p);
const alpha = (i + 1) / trailRef.current.length;
ctx.fillStyle = `rgba(92,255,154,${alpha * 0.35})`;
ctx.beginPath();
ctx.arc(c.x, c.y, 3 + alpha * 2, 0, Math.PI * 2);
ctx.fill();
});
}

// live center dot
ctx.fillStyle = "rgba(92,255,154,1)";
ctx.shadowColor = "rgba(92,255,154,0.65)";
ctx.shadowBlur = 24;
ctx.beginPath();
ctx.arc(center.x, center.y, 8.5, 0, Math.PI * 2);
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

const dtMs = lastFrameTsRef.current ? Math.max(now - lastFrameTsRef.current, 1) : 16;
const body = computeBodyMetrics(result?.landmarks?.[0], previousCenterRef.current, dtMs);

if (body) {
foundPose = true;
latestBodyRef.current = body;
lastDetectionRef.current = now;
lastFrameTsRef.current = now;
previousCenterRef.current = body.center;

smoothedRef.current.velocity = lerp(
smoothedRef.current.velocity,
body.velocity,
SMOOTH_VELOCITY
);
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
const publishedVelocity = Number(smoothedRef.current.velocity.toFixed(4));

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
if (shouldUpdateNumber(publishedVelocity, publishedRef.current.velocity, 0.0005)) {
publishedRef.current.velocity = publishedVelocity;
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
title: "VELOCITY SPIKE",
subtitle: `${previousStateRef.current} → DROP`,
value: `Velocity ${publishedVelocity.toFixed(4)}`,
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
setVelocityRead(publishedRef.current.velocity);
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
previousCenterRef.current = null;
lastFrameTsRef.current = null;
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
velocity: 0,
};
smoothedRef.current = {
stability: 72,
tilt: 6,
windowMs: 640,
quality: 82,
velocity: 0,
};
setEvents([]);
setStateLabel("ENTER FRAME");
setStability(76);
setDecisionWindow(640);
setDecisionQuality("GOOD");
setTiltLoad(7);
setVelocityRead(0);
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
if (stateLabel === "ALIGNED") return "text-[#5CFF9A]";
if (stateLabel === "SHIFT") return "text-[#FFD95A]";
if (stateLabel === "DROP") return "text-[#5FB3FF]";
return "text-white";
}, [stateLabel]);

return (
<main className="min-h-screen bg-[#050505] text-white">
<video ref={videoRef} playsInline muted autoPlay className="hidden" />

<div className="mx-auto max-w-6xl px-3 pb-10 pt-3 md:px-4 md:pt-4">
<section className="overflow-hidden rounded-[30px] border border-white/8 bg-[#0A0A0A] shadow-[0_0_80px_rgba(0,0,0,0.55)]">
<div className="flex items-center justify-between gap-4 border-b border-white/8 px-4 py-3 md:px-5">
<div>
<div className="text-[11px] uppercase tracking-[0.42em] text-white/46">
AXIS RUN INSTRUMENT
</div>
<div className="mt-1 text-[18px] font-semibold md:text-[22px]">
AXIS SCOPE
</div>
</div>

<div className="text-right">
<div className={`text-[24px] font-semibold leading-none md:text-[34px] ${stateColor}`}>
{stateLabel}
</div>
<div className="mt-1 text-[11px] uppercase tracking-[0.28em] text-white/42">
{status}
</div>
</div>
</div>

<div className="relative">
<canvas
ref={scopeCanvasRef}
className="block h-[70vh] min-h-[520px] w-full md:h-[76vh] md:min-h-[760px]"
/>

<div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-4 pt-4 md:px-5">
<div className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-white/55 backdrop-blur">
{cameraLabel} Camera
</div>
<div className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-white/55 backdrop-blur">
{phase === "live" ? "Live" : phase === "starting" ? "Starting" : "Idle"}
</div>
</div>

<div className="absolute inset-x-0 bottom-0 border-t border-white/8 bg-[rgba(8,8,8,0.82)] px-4 py-3 backdrop-blur-md md:px-5">
<div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
<RailMetric label="State" value={stateLabel} valueClass={stateColor} />
<RailMetric label="Stability" value={`${stability}%`} />
<RailMetric label="Window" value={`${decisionWindow} ms`} />
<RailMetric label="Tilt" value={`${tiltLoad.toFixed(1)}°`} />
<RailMetric label="Velocity" value={velocityRead.toFixed(4)} />
</div>
</div>
</div>

<div className="border-t border-white/8 px-4 py-3 md:px-5">
<div className="flex flex-wrap gap-3">
<button
onClick={() => setStatus("Motion Ready")}
className="rounded-[18px] border border-white/20 bg-[#111111] px-4 py-3 text-[16px] font-medium"
>
Motion Ready
</button>

<button
onClick={startSystem}
disabled={phase === "starting"}
className="rounded-[18px] bg-white px-4 py-3 text-[16px] font-semibold text-black disabled:opacity-60"
>
{phase === "starting" ? "Starting..." : phase === "live" ? "Live" : "Start"}
</button>

<button
onClick={flipCamera}
disabled={isFlipping}
className="rounded-[18px] border border-white/20 bg-[#111111] px-4 py-3 text-[16px] font-medium disabled:opacity-60"
>
{isFlipping ? "Flipping..." : "Flip Camera"}
</button>

<button
onClick={() => setIsPaused((prev) => !prev)}
className="rounded-[18px] border border-white/20 bg-[#111111] px-4 py-3 text-[16px] font-medium"
>
{isPaused ? "Resume" : "Pause"}
</button>

<button
onClick={resetSystem}
className="rounded-[18px] border border-white/20 bg-[#111111] px-4 py-3 text-[16px] font-medium"
>
Reset
</button>

<div className="ml-auto rounded-[18px] border border-white/10 bg-[#0E0E0E] px-4 py-3 text-[16px] font-medium text-white/72">
Quality {decisionQuality}
</div>
</div>
</div>

<div className="grid gap-0 border-t border-white/8 md:grid-cols-[1.05fr_1.2fr]">
<section className="border-b border-white/8 px-4 py-4 md:border-b-0 md:border-r md:border-white/8 md:px-5">
<div className="mb-4 text-[11px] uppercase tracking-[0.42em] text-white/42">
EVENT HISTORY
</div>

<div className="space-y-3">
{events.length === 0 ? (
<div className="rounded-[18px] border border-white/10 bg-[#0C0C0C] p-4 text-[18px] text-white/45">
No events yet.
</div>
) : (
events.map((event) => (
<div
key={event.id}
className="rounded-[18px] border border-white/10 bg-[#0C0C0C] p-4"
>
<div className="flex items-start justify-between gap-4">
<div className="min-w-0">
<div className="flex items-center gap-3">
<span
className={`h-3 w-3 rounded-full ${
event.tone === "green"
? "bg-[#5CFF9A]"
: event.tone === "blue"
? "bg-[#5FB3FF]"
: "bg-[#FFD95A]"
}`}
/>
<div className="truncate text-[19px] font-semibold">
{event.title}
</div>
</div>
<div className="mt-1 text-[14px] text-white/40">{event.ts}</div>
</div>

<span
className={`shrink-0 rounded-full border px-3 py-1.5 text-[14px] font-medium ${toneClass(
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

<div className="mt-3 text-[16px] text-white/56">{event.subtitle}</div>
<div className="mt-2 text-[16px] text-white/64">{event.value}</div>
</div>
))
)}
</div>
</section>

<section className="px-4 py-4 md:px-5">
<div className="mb-4 text-[11px] uppercase tracking-[0.42em] text-white/42">
LIVE LOGIC
</div>

<div className="grid gap-3 md:grid-cols-2">
<LogicCard
label="What is primary"
value="Body relationship to center"
/>
<LogicCard
label="What is measured"
value="Velocity plus tilt plus lean"
/>
<LogicCard
label="What decides state"
value="Center score with hold time"
/>
<LogicCard
label="What is shown"
value="Ghost image, axis line, center dot, short trail"
/>
</div>
</section>
</div>
</section>
</div>
</main>
);
}

function RailMetric({
label,
value,
valueClass = "text-white",
}: {
label: string;
value: string;
valueClass?: string;
}) {
return (
<div>
<div className="text-[10px] uppercase tracking-[0.28em] text-white/40">{label}</div>
<div className={`mt-1 text-[18px] font-semibold md:text-[22px] ${valueClass}`}>{value}</div>
</div>
);
}

function LogicCard({
label,
value,
}: {
label: string;
value: string;
}) {
return (
<div className="rounded-[18px] border border-white/10 bg-[#0C0C0C] p-4">
<div className="text-[11px] uppercase tracking-[0.3em] text-white/40">{label}</div>
<div className="mt-3 text-[18px] text-white/78">{value}</div>
</div>
);
}