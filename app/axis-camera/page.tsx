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
const MAX_EVENTS = 10;

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
facingMode: "user",
width: { ideal: 1080 },
height: { ideal: 1920 },
},
};

const stream = await navigator.mediaDevices.getUserMedia(constraints);
streamRef.current = stream;
video.srcObject = stream;
await video.play();
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
const pad = 36;
const radius = Math.min(width, height) / 2 - pad;

const glow = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
glow.addColorStop(0, "rgba(90,255,170,0.22)");
glow.addColorStop(0.45, "rgba(90,255,170,0.08)");
glow.addColorStop(1, "rgba(90,255,170,0)");
ctx.fillStyle = glow;
ctx.fillRect(0, 0, width, height);

ctx.save();
ctx.beginPath();
ctx.rect(pad, pad, width - pad * 2, height - pad * 2);
ctx.clip();

if (video && video.videoWidth && video.videoHeight) {
const sourceAspect = video.videoWidth / video.videoHeight;
const destAspect = (width - pad * 2) / (height - pad * 2);

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
ctx.filter = "grayscale(1) blur(1px) contrast(1.1)";
ctx.drawImage(video, sx, sy, sw, sh, pad, pad, width - pad * 2, height - pad * 2);
ctx.restore();
}

ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;

for (let i = 1; i <= 4; i += 1) {
const y = pad + ((height - pad * 2) / 5) * i;
ctx.beginPath();
ctx.moveTo(pad, y);
ctx.lineTo(width - pad, y);
ctx.stroke();
}

for (let i = 1; i <= 4; i += 1) {
const x = pad + ((width - pad * 2) / 5) * i;
ctx.beginPath();
ctx.moveTo(x, pad);
ctx.lineTo(x, height - pad);
ctx.stroke();
}

ctx.strokeStyle = "rgba(255,255,255,0.12)";
ctx.lineWidth = 1.5;
[0.22, 0.42, 0.68].forEach((ratio) => {
ctx.beginPath();
ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
ctx.stroke();
});

ctx.strokeStyle = "rgba(255,255,255,0.16)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(cx, pad);
ctx.lineTo(cx, height - pad);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(pad, cy);
ctx.lineTo(width - pad, cy);
ctx.stroke();

const body = latestBodyRef.current;

if (body) {
const toCanvas = (p: { x: number; y: number }) => ({
x: pad + p.x * (width - pad * 2),
y: pad + p.y * (height - pad * 2),
});

const nose = toCanvas(body.nose);
const ls = toCanvas(body.ls);
const rs = toCanvas(body.rs);
const lh = toCanvas(body.lh);
const rh = toCanvas(body.rh);
const center = toCanvas(body.center);

ctx.save();
ctx.strokeStyle = "rgba(126,255,176,0.95)";
ctx.lineWidth = 4;
ctx.lineJoin = "round";
ctx.lineCap = "round";

ctx.beginPath();
ctx.moveTo(ls.x, ls.y);
ctx.quadraticCurveTo((ls.x + nose.x) / 2, (ls.y + nose.y) / 2, nose.x, nose.y);
ctx.quadraticCurveTo((nose.x + rs.x) / 2, (nose.y + rs.y) / 2, rs.x, rs.y);
ctx.lineTo(rh.x, rh.y);
ctx.quadraticCurveTo(center.x, rh.y + 16, lh.x, lh.y);
ctx.closePath();
ctx.stroke();

ctx.strokeStyle = "rgba(126,255,176,0.72)";
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(ls.x, ls.y);
ctx.lineTo(rs.x, rs.y);
ctx.stroke();

ctx.strokeStyle = "rgba(126,255,176,0.55)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo((ls.x + rs.x) / 2, (ls.y + rs.y) / 2);
ctx.lineTo((lh.x + rh.x) / 2, (lh.y + rh.y) / 2);
ctx.stroke();

ctx.fillStyle = "rgba(126,255,176,0.95)";
ctx.beginPath();
ctx.arc(nose.x, nose.y, 7, 0, Math.PI * 2);
ctx.fill();

if (trailRef.current.length > 1) {
ctx.strokeStyle = "rgba(126,255,176,0.55)";
ctx.lineWidth = 3;
ctx.beginPath();
trailRef.current.forEach((p, index) => {
const c = toCanvas(p);
if (index === 0) ctx.moveTo(c.x, c.y);
else ctx.lineTo(c.x, c.y);
});
ctx.stroke();
}

ctx.fillStyle = "rgba(126,255,176,1)";
ctx.shadowColor = "rgba(126,255,176,0.65)";
ctx.shadowBlur = 22;
ctx.beginPath();
ctx.arc(center.x, center.y, 10, 0, Math.PI * 2);
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
if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}
if (poseRef.current?.close) poseRef.current.close();
poseRef.current = null;
modelReadyRef.current = false;
};
}, [drawScope]);

const stateColor = useMemo(() => {
if (stateLabel === "ALIGNED") return "text-[#87f5a6]";
if (stateLabel === "SHIFT") return "text-[#f0d46c]";
if (stateLabel === "DROP") return "text-[#79b8ff]";
return "text-white";
}, [stateLabel]);

return (
<main className="min-h-screen bg-black text-white">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="hidden"
style={{ transform: "scaleX(-1)" }}
/>

<div className="mx-auto max-w-5xl px-4 pb-24 pt-10">
<section className="rounded-[34px] border border-white/8 bg-white/[0.02] p-6 shadow-[0_0_60px_rgba(0,0,0,0.45)]">
<div className="mb-5 flex items-center gap-3 text-[12px] uppercase tracking-[0.42em] text-white/55">
<span className="h-3 w-3 rounded-full bg-[#87f5a6]" />
AXIS RUN INSTRUMENT
</div>

<h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
State.Window.Decision.
</h1>

<p className="mt-4 max-w-3xl text-lg text-white/65">
Axis captures movement transitions automatically and logs live state events.
</p>

<div className="mt-8 flex flex-wrap gap-4">
<button
onClick={() => setStatus("Motion Ready")}
className="rounded-[24px] border border-white/80 px-7 py-4 text-2xl font-medium"
>
Motion Ready
</button>

<button
onClick={startSystem}
disabled={phase === "starting"}
className="rounded-[24px] bg-white px-7 py-4 text-2xl font-semibold text-black disabled:opacity-60"
>
{phase === "starting" ? "Starting..." : "Start"}
</button>

<button
onClick={() => setIsPaused((prev) => !prev)}
className="rounded-[24px] border border-white/80 px-7 py-4 text-2xl font-medium"
>
{isPaused ? "Resume" : "Pause"}
</button>

<button
onClick={resetSystem}
className="rounded-[24px] border border-white/80 px-7 py-4 text-2xl font-medium"
>
Reset
</button>
</div>

<div className="my-8 h-px bg-white/20" />

<section className="rounded-[34px] border border-white/8 bg-white/[0.015] p-5">
<div className="mb-4 flex items-start justify-between">
<div>
<div className="text-2xl font-semibold">AXIS SCOPE</div>
<div className="text-[12px] uppercase tracking-[0.36em] text-white/45">
LIVE STATE FIELD
</div>
</div>

<div className={`text-3xl font-semibold ${stateColor}`}>{stateLabel}</div>
</div>

<div className="overflow-hidden rounded-[28px] border border-white/8 bg-black">
<canvas
ref={scopeCanvasRef}
className="block h-[520px] w-full md:h-[700px]"
/>
</div>
</section>

<div className="mt-6 grid gap-6 md:grid-cols-3">
<StatChartCard
label="STABILITY"
value={`${stability}%`}
sublabel={stability >= 84 ? "body ready" : "body moving"}
tone="green"
values={[74, 76, 81, 79, 83, 88, 88, 84, 83, 85, 80, 79, 75, 76, 74, 73, 74, 76]}
/>

<StatChartCard
label="DECISION WINDOW"
value={`${decisionWindow} ms`}
sublabel="live window"
tone="blue"
values={[54, 54, 55, 56, 57, 59, 61, 63, 65, 66, 68, 69, 70, 71, 71, 71, 71, 70]}
/>

<StatChartCard
label="DECISION QUALITY"
value={decisionQuality}
sublabel="state and action fit"
tone="green"
values={[83, 82, 82, 80, 80, 80, 79, 80, 80, 78, 78, 77, 78, 77, 79, 80, 81, 84]}
/>
</div>

<div className="mt-6 grid gap-6 md:grid-cols-[1.25fr_0.9fr]">
<section className="rounded-[34px] border border-white/8 bg-white/[0.015] p-6">
<div className="mb-6 text-[12px] uppercase tracking-[0.42em] text-white/50">
LIVE STATE
</div>

<LargeMetric label="Axis State" value={stateLabel} valueClass={stateColor} />
<LargeMetric label="Tilt Load" value={`${tiltLoad.toFixed(1)}°`} />
<LargeMetric label="Decision Action" value={decisionAction} />
<LargeMetric label="Read" value={decisionQuality} valueClass="text-[#87f5a6]" />
</section>

<section className="rounded-[34px] border border-white/8 bg-white/[0.015] p-6">
<div className="mb-6 text-[12px] uppercase tracking-[0.42em] text-white/50">
DECISION INPUT
</div>

<div className="grid grid-cols-2 gap-4">
{(["SHOOT", "DRIVE", "PASS", "HOLD"] as DecisionAction[]).map((action) => {
const active = decisionAction === action;
return (
<button
key={action}
onClick={() => setDecisionAction(action)}
className={`rounded-[22px] border px-6 py-7 text-left text-2xl transition ${
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
</div>

<section className="mt-6 rounded-[34px] border border-white/8 bg-white/[0.015] p-6">
<div className="mb-6 flex items-center justify-between">
<div className="text-[12px] uppercase tracking-[0.42em] text-white/50">
EVENT HISTORY
</div>
<div className="text-xl text-white/45">{events.length} events</div>
</div>

<div className="space-y-4">
{events.length === 0 ? (
<div className="rounded-[24px] border border-white/10 p-6 text-2xl text-white/50">
No events yet.
</div>
) : (
events.map((event) => (
<div
key={event.id}
className="rounded-[24px] border border-white/10 bg-black/60 p-5"
>
<div className="flex items-center justify-between gap-4">
<div className="flex items-center gap-3">
<span
className={`h-4 w-4 rounded-full ${
event.tone === "green"
? "bg-[#87f5a6]"
: event.tone === "blue"
? "bg-[#79b8ff]"
: "bg-[#f0d46c]"
}`}
/>
<div className="text-2xl font-semibold">{event.title}</div>
<div className="text-lg text-white/45">{event.ts}</div>
</div>

<span
className={`rounded-full border px-4 py-2 text-xl font-medium ${toneClass(
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

<div className="mt-3 text-xl text-white/55">{event.subtitle}</div>
<div className="mt-3 text-xl text-white/60">
{event.value} &nbsp; Action {decisionAction}
</div>
</div>
))
)}
</div>
</section>
</section>
</div>
</main>
);
}

function LargeMetric({
label,
value,
valueClass = "text-white",
}: {
label: string;
value: string;
valueClass?: string;
}) {
return (
<div className="mb-4 rounded-[24px] border border-white/80 px-6 py-6">
<div className="mb-3 text-xl text-white/55">{label}</div>
<div className={`text-5xl font-semibold ${valueClass}`}>{value}</div>
</div>
);
}

function StatChartCard({
label,
value,
sublabel,
tone,
values,
}: {
label: string;
value: string;
sublabel: string;
tone: "green" | "blue" | "yellow";
values: number[];
}) {
return (
<section className="rounded-[34px] border border-white/8 bg-white/[0.015] p-6">
<div className="mb-3 flex items-start justify-between">
<div className="text-[12px] uppercase tracking-[0.42em] text-white/50">{label}</div>
<span
className={`h-4 w-4 rounded-full ${
tone === "green"
? "bg-[#87f5a6] shadow-[0_0_20px_rgba(135,245,166,0.65)]"
: tone === "blue"
? "bg-[#79b8ff] shadow-[0_0_20px_rgba(121,184,255,0.65)]"
: "bg-[#f0d46c] shadow-[0_0_20px_rgba(240,212,108,0.65)]"
}`}
/>
</div>

<div className="text-6xl font-semibold">{value}</div>

<div className="mt-5 h-[180px]">
<MiniLineChart
values={values}
color={tone === "green" ? "#87f5a6" : tone === "blue" ? "#79b8ff" : "#f0d46c"}
/>
</div>

<div className="mt-4 text-2xl text-white/50">{sublabel}</div>
</section>
);
}

function MiniLineChart({
values,
color,
}: {
values: number[];
color: string;
}) {
const width = 1000;
const height = 240;
const padX = 20;
const padY = 24;

const min = Math.min(...values);
const max = Math.max(...values);
const span = Math.max(max - min, 1);

const points = values.map((v, i) => {
const x = padX + (i / Math.max(values.length - 1, 1)) * (width - padX * 2);
const y = height - padY - ((v - min) / span) * (height - padY * 2);
return [x, y] as const;
});

const d = points
.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
.join(" ");

return (
<svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible">
<path
d={d}
fill="none"
stroke={color}
strokeWidth="10"
strokeLinecap="round"
strokeLinejoin="round"
/>
</svg>
);
}