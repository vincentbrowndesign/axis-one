'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

type AxisState = 'ALIGNED' | 'SHIFT' | 'DROP' | 'LOST';

type AxisEvent = {
id: string;
at: string;
state: AxisState;
tilt: number;
stability: number;
velocity: number;
windowMs: number;
comDriftPx: number;
};

type Point = { x: number; y: number };

type Calibration = {
leftBoundary: Point | null;
rightBoundary: Point | null;
target: Point | null;
playerStart: Point | null;
};

const BG = '#0B0B0B';
const SURFACE = '#101010';
const TEXT = '#F5F5F5';
const MUTED = '#8D8D8D';
const LINE = '#2A2A2A';
const AXIS_GREEN = '#39FF14';
const ALIGNED = '#00FF9C';
const SHIFT = '#FFD400';
const DROP = '#3FA7FF';
const LOST = '#7A7A7A';

const HOLD_MS_TO_START = 180;
const MAX_HISTORY = 24;
const CLEAN_WINDOW_MIN_MS = 350;

const STACK_ALIGNED_PX = 22;
const STACK_SHIFT_PX = 46;
const COM_ALIGNED_PX = 26;
const COM_SHIFT_PX = 54;
const BODY_AXIS_SHIFT_DEG = 7;
const BODY_AXIS_DROP_DEG = 16;
const DOWNWARD_DROP_VELOCITY = 20;

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function dist(a: Point, b: Point) {
return Math.hypot(a.x - b.x, a.y - b.y);
}

function mean(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function formatNow() {
return new Date().toLocaleTimeString([], {
hour: 'numeric',
minute: '2-digit',
second: '2-digit',
});
}

function stateColor(state: AxisState) {
switch (state) {
case 'ALIGNED':
return ALIGNED;
case 'SHIFT':
return SHIFT;
case 'DROP':
return DROP;
case 'LOST':
default:
return LOST;
}
}

function labelForEvent(event: AxisEvent) {
if (event.state === 'LOST') return 'Tracking lost';
return `Velocity ${event.velocity.toFixed(4)} • Drift ${event.comDriftPx.toFixed(1)} px`;
}

function midpoint(a?: { x: number; y: number }, b?: { x: number; y: number }): Point | null {
if (!a || !b) return null;
return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function toPx(point: Point, width: number, height: number): Point {
return { x: point.x * width, y: point.y * height };
}

function safePointAverage(points: Array<Point | null>): Point | null {
const valid = points.filter(Boolean) as Point[];
if (!valid.length) return null;
return {
x: valid.reduce((sum, p) => sum + p.x, 0) / valid.length,
y: valid.reduce((sum, p) => sum + p.y, 0) / valid.length,
};
}

export default function Page() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const wrapRef = useRef<HTMLDivElement | null>(null);
const poseRef = useRef<PoseLandmarker | null>(null);
const rafRef = useRef<number | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const holdTimerRef = useRef<number | null>(null);

const lastComRef = useRef<Point | null>(null);
const lastStateRef = useRef<AxisState>('LOST');
const alignedStartRef = useRef<number | null>(null);
const lastAlignedEventAtRef = useRef<number>(0);

const recentTiltRef = useRef<number[]>([]);
const recentDriftRef = useRef<number[]>([]);
const recentStackRef = useRef<number[]>([]);

const currentMetricsRef = useRef({
state: 'LOST' as AxisState,
tilt: 0,
stability: 0,
velocity: 0,
windowMs: 0,
comDriftPx: 0,
});

const [ready, setReady] = useState(false);
const [cameraLive, setCameraLive] = useState(false);
const [isHolding, setIsHolding] = useState(false);
const [isCapturing, setIsCapturing] = useState(false);
const [quality, setQuality] = useState<'GOOD' | 'LOW' | 'NO SIGNAL'>('NO SIGNAL');
const [axisState, setAxisState] = useState<AxisState>('LOST');
const [tilt, setTilt] = useState(0);
const [stability, setStability] = useState(0);
const [velocity, setVelocity] = useState(0);
const [windowMs, setWindowMs] = useState(0);
const [comDriftPx, setComDriftPx] = useState(0);
const [history, setHistory] = useState<AxisEvent[]>([]);
const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
const [selectedPoint, setSelectedPoint] = useState<keyof Calibration | null>('leftBoundary');
const [calibration, setCalibration] = useState<Calibration>({
leftBoundary: null,
rightBoundary: null,
target: null,
playerStart: null,
});

const selectedEvent = useMemo(
() => history.find((item) => item.id === selectedEventId) ?? history[0] ?? null,
[history, selectedEventId]
);

const axisShape = useMemo(() => history.slice(0, 10).reverse(), [history]);

const pushEvent = useCallback((event: AxisEvent) => {
setHistory((prev) => [event, ...prev].slice(0, MAX_HISTORY));
setSelectedEventId(event.id);
}, []);

const syncMetricsToState = useCallback((next: {
state: AxisState;
tilt: number;
stability: number;
velocity: number;
windowMs: number;
comDriftPx: number;
}) => {
currentMetricsRef.current = next;
setAxisState(next.state);
setTilt(next.tilt);
setStability(next.stability);
setVelocity(next.velocity);
setWindowMs(next.windowMs);
setComDriftPx(next.comDriftPx);
}, []);

const drawReticle = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
const cx = w / 2;
const cy = h / 2;

ctx.save();
ctx.strokeStyle = 'rgba(255,255,255,0.07)';
ctx.lineWidth = 1;

[0.12, 0.22, 0.34].forEach((ratio) => {
ctx.beginPath();
ctx.arc(cx, cy, Math.min(w, h) * ratio, 0, Math.PI * 2);
ctx.stroke();
});

ctx.beginPath();
ctx.moveTo(cx - 90, cy);
ctx.lineTo(cx + 90, cy);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(cx, cy - 90);
ctx.lineTo(cx, cy + 90);
ctx.stroke();

ctx.restore();
}, []);

const drawCalibration = useCallback(
(ctx: CanvasRenderingContext2D) => {
const points: Array<[keyof Calibration, string]> = [
['leftBoundary', 'L'],
['rightBoundary', 'R'],
['target', 'T'],
['playerStart', 'S'],
];

points.forEach(([key, label]) => {
const point = calibration[key];
if (!point) return;

ctx.save();
ctx.strokeStyle = 'rgba(255,255,255,0.5)';
ctx.fillStyle = 'rgba(11,11,11,0.82)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
ctx.fill();
ctx.stroke();
ctx.font = '12px Inter, Arial, sans-serif';
ctx.fillStyle = '#FFFFFF';
ctx.fillText(label, point.x + 12, point.y + 4);
ctx.restore();
});
},
[calibration]
);

const drawInstrument = useCallback(
(
poseLandmarks: Array<{ x: number; y: number; visibility?: number }> | null,
bodyAxisPoints: Point[] | null,
com: Point | null,
state: AxisState,
driftPx: number
) => {
const canvas = canvasRef.current;
const wrap = wrapRef.current;
if (!canvas || !wrap) return;

const rect = wrap.getBoundingClientRect();
const dpr = window.devicePixelRatio || 1;

canvas.width = rect.width * dpr;
canvas.height = rect.height * dpr;
canvas.style.width = `${rect.width}px`;
canvas.style.height = `${rect.height}px`;

const ctx = canvas.getContext('2d');
if (!ctx) return;

ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.clearRect(0, 0, rect.width, rect.height);

drawReticle(ctx, rect.width, rect.height);
drawCalibration(ctx);

const axisX = calibration.playerStart?.x ?? rect.width / 2;
const axisColor = state === 'ALIGNED' ? AXIS_GREEN : stateColor(state);

ctx.save();
ctx.strokeStyle = axisColor;
ctx.globalAlpha = state === 'ALIGNED' ? 0.95 : 0.68;
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(axisX, 0);
ctx.lineTo(axisX, rect.height);
ctx.stroke();
ctx.restore();

if (poseLandmarks) {
const pairs = [
[11, 12],
[11, 23],
[12, 24],
[23, 24],
[23, 25],
[24, 26],
[25, 27],
[26, 28],
];

ctx.save();
ctx.strokeStyle = 'rgba(255,255,255,0.30)';
ctx.lineWidth = 1.15;

pairs.forEach(([a, b]) => {
const pa = poseLandmarks[a];
const pb = poseLandmarks[b];
if (!pa || !pb) return;
ctx.beginPath();
ctx.moveTo(pa.x * rect.width, pa.y * rect.height);
ctx.lineTo(pb.x * rect.width, pb.y * rect.height);
ctx.stroke();
});

ctx.restore();
}

if (bodyAxisPoints && bodyAxisPoints.length >= 2) {
ctx.save();
ctx.strokeStyle = axisColor;
ctx.lineWidth = 3;
ctx.globalAlpha = 0.9;
ctx.beginPath();
ctx.moveTo(bodyAxisPoints[0].x, bodyAxisPoints[0].y);
for (let i = 1; i < bodyAxisPoints.length; i += 1) {
ctx.lineTo(bodyAxisPoints[i].x, bodyAxisPoints[i].y);
}
ctx.stroke();
ctx.restore();

ctx.save();
ctx.fillStyle = axisColor;
bodyAxisPoints.forEach((p) => {
ctx.beginPath();
ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
ctx.fill();
});
ctx.restore();
}

if (com) {
const pulse = 6 + Math.min(12, driftPx * 0.12);

ctx.save();
ctx.fillStyle = stateColor(state);
ctx.shadowBlur = state === 'ALIGNED' ? 18 : 10;
ctx.shadowColor = stateColor(state);
ctx.beginPath();
ctx.arc(com.x, com.y, pulse, 0, Math.PI * 2);
ctx.fill();
ctx.restore();

ctx.save();
ctx.strokeStyle = stateColor(state);
ctx.globalAlpha = 0.8;
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(axisX, com.y);
ctx.lineTo(com.x, com.y);
ctx.stroke();
ctx.restore();
}
},
[calibration, drawCalibration, drawReticle]
);

const addStateEventIfNeeded = useCallback(
(
state: AxisState,
tiltValue: number,
stabilityValue: number,
velocityValue: number,
windowValue: number,
driftValue: number
) => {
const previous = lastStateRef.current;

if (!isCapturing || previous === state) {
lastStateRef.current = state;
return;
}

lastStateRef.current = state;

pushEvent({
id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
at: formatNow(),
state,
tilt: tiltValue,
stability: stabilityValue,
velocity: velocityValue,
windowMs: windowValue,
comDriftPx: driftValue,
});
},
[isCapturing, pushEvent]
);

const computeCom = useCallback((landmarks: Array<{ x: number; y: number }>, width: number, height: number) => {
const weightedPoints = [
{ idx: 11, w: 0.08 },
{ idx: 12, w: 0.08 },
{ idx: 23, w: 0.22 },
{ idx: 24, w: 0.22 },
{ idx: 25, w: 0.10 },
{ idx: 26, w: 0.10 },
{ idx: 27, w: 0.10 },
{ idx: 28, w: 0.10 },
];

let sumW = 0;
let sumX = 0;
let sumY = 0;

weightedPoints.forEach(({ idx, w }) => {
const lm = landmarks[idx];
if (!lm) return;
sumW += w;
sumX += lm.x * width * w;
sumY += lm.y * height * w;
});

if (!sumW) return null;

return {
x: sumX / sumW,
y: sumY / sumW,
};
}, []);

const inferState = useCallback(
(bodyAxisDeg: number, stackSpread: number, comDrift: number, bodyVelocity: number): AxisState => {
if (
bodyAxisDeg <= BODY_AXIS_SHIFT_DEG &&
stackSpread <= STACK_ALIGNED_PX &&
comDrift <= COM_ALIGNED_PX
) {
return 'ALIGNED';
}

if (
bodyVelocity >= DOWNWARD_DROP_VELOCITY ||
bodyAxisDeg >= BODY_AXIS_DROP_DEG ||
stackSpread >= STACK_SHIFT_PX ||
comDrift >= COM_SHIFT_PX
) {
return 'DROP';
}

return 'SHIFT';
},
[]
);

const processFrame = useCallback(async () => {
const video = videoRef.current;
const pose = poseRef.current;
const wrap = wrapRef.current;

if (!video || !pose || !wrap || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
return;
}

const nowMs = performance.now();

let result: ReturnType<PoseLandmarker['detectForVideo']>;
try {
result = pose.detectForVideo(video, nowMs);
} catch (error) {
console.error('detectForVideo failed', error);
rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
return;
}

if (!result) {
rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
return;
}

const landmarks = result.landmarks?.[0] ?? null;
const width = wrap.clientWidth;
const height = wrap.clientHeight;

if (!landmarks) {
setQuality('NO SIGNAL');

syncMetricsToState({
state: 'LOST',
tilt: 0,
stability: 0,
velocity: 0,
windowMs: 0,
comDriftPx: 0,
});

drawInstrument(null, null, null, 'LOST', 0);
addStateEventIfNeeded('LOST', 0, 0, 0, 0, 0);

rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
return;
}

const shoulderMidNorm = midpoint(landmarks[11], landmarks[12]);
const hipMidNorm = midpoint(landmarks[23], landmarks[24]);
const kneeMidNorm = midpoint(landmarks[25], landmarks[26]);
const ankleMidNorm = midpoint(landmarks[27], landmarks[28]);

if (!shoulderMidNorm || !hipMidNorm || !kneeMidNorm || !ankleMidNorm) {
setQuality('LOW');

syncMetricsToState({
state: 'LOST',
tilt: 0,
stability: 0,
velocity: 0,
windowMs: 0,
comDriftPx: 0,
});

drawInstrument(landmarks, null, null, 'LOST', 0);
addStateEventIfNeeded('LOST', 0, 0, 0, 0, 0);

rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
return;
}

const shoulderMid = toPx(shoulderMidNorm, width, height);
const hipMid = toPx(hipMidNorm, width, height);
const kneeMid = toPx(kneeMidNorm, width, height);
const ankleMid = toPx(ankleMidNorm, width, height);

const bodyAxisPoints = [shoulderMid, hipMid, kneeMid, ankleMid];

const dx = shoulderMid.x - ankleMid.x;
const dy = ankleMid.y - shoulderMid.y;
const bodyAxisDeg = Math.abs((Math.atan2(dx, Math.max(1, dy)) * 180) / Math.PI);

const stackSpread = Math.max(
Math.abs(shoulderMid.x - ankleMid.x),
Math.abs(hipMid.x - ankleMid.x),
Math.abs(kneeMid.x - ankleMid.x)
);

const com = computeCom(landmarks, width, height);
const axisX = calibration.playerStart?.x ?? width / 2;
const drift = com ? Math.abs(com.x - axisX) : 0;

const bodyMid = safePointAverage([shoulderMid, hipMid, kneeMid, ankleMid]);
let nextVelocity = 0;
if (bodyMid && lastComRef.current) {
nextVelocity = dist(bodyMid, lastComRef.current);
}
lastComRef.current = bodyMid;

recentTiltRef.current = [...recentTiltRef.current.slice(-24), bodyAxisDeg];
recentDriftRef.current = [...recentDriftRef.current.slice(-24), drift];
recentStackRef.current = [...recentStackRef.current.slice(-24), stackSpread];

const driftVariance = mean(
recentDriftRef.current.map((v) => Math.abs(v - mean(recentDriftRef.current)))
);
const stackVariance = mean(
recentStackRef.current.map((v) => Math.abs(v - mean(recentStackRef.current)))
);
const avgAxisTilt = mean(recentTiltRef.current);

const nextStability = clamp(
100 - driftVariance * 1.2 - stackVariance * 1.1 - avgAxisTilt * 1.7,
0,
100
);

const nextState = inferState(bodyAxisDeg, stackSpread, drift, nextVelocity);

let nextWindow = 0;
if (nextState === 'ALIGNED') {
if (alignedStartRef.current === null) alignedStartRef.current = nowMs;
nextWindow = nowMs - alignedStartRef.current;
} else {
alignedStartRef.current = null;
}

setQuality(nextStability > 35 ? 'GOOD' : 'LOW');

syncMetricsToState({
state: nextState,
tilt: bodyAxisDeg,
stability: nextStability,
velocity: nextVelocity,
windowMs: nextWindow,
comDriftPx: drift,
});

drawInstrument(landmarks, bodyAxisPoints, com, nextState, drift);
addStateEventIfNeeded(nextState, bodyAxisDeg, nextStability, nextVelocity, nextWindow, drift);

if (isCapturing && nextState === 'ALIGNED' && nextWindow >= CLEAN_WINDOW_MIN_MS) {
const now = Date.now();
if (now - lastAlignedEventAtRef.current > 900) {
lastAlignedEventAtRef.current = now;

pushEvent({
id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
at: formatNow(),
state: 'ALIGNED',
tilt: bodyAxisDeg,
stability: nextStability,
velocity: nextVelocity,
windowMs: nextWindow,
comDriftPx: drift,
});
}
}

rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
}, [
addStateEventIfNeeded,
calibration.playerStart,
computeCom,
drawInstrument,
inferState,
isCapturing,
pushEvent,
syncMetricsToState,
]);

const stopLoop = useCallback(() => {
if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}
}, []);

const startCamera = useCallback(async () => {
try {
const stream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: 'user',
width: { ideal: 1280 },
height: { ideal: 720 },
},
audio: false,
});

streamRef.current = stream;
const video = videoRef.current;
if (!video) return;

video.srcObject = stream;
await video.play();
setCameraLive(true);
} catch (error) {
console.error('Camera start failed', error);
setCameraLive(false);
}
}, []);

const stopCamera = useCallback(() => {
streamRef.current?.getTracks().forEach((track) => track.stop());
streamRef.current = null;
setCameraLive(false);
stopLoop();
}, [stopLoop]);

const boot = useCallback(async () => {
if (ready) return;

const vision = await FilesetResolver.forVisionTasks('/wasm');

poseRef.current = await PoseLandmarker.createFromOptions(vision, {
baseOptions: {
modelAssetPath: '/models/pose_landmarker_full.task',
delegate: 'GPU',
},
runningMode: 'VIDEO',
numPoses: 1,
minPoseDetectionConfidence: 0.5,
minPosePresenceConfidence: 0.5,
minTrackingConfidence: 0.5,
});

setReady(true);
await startCamera();
}, [ready, startCamera]);

useEffect(() => {
void boot();

return () => {
stopCamera();
poseRef.current?.close();
};
}, [boot, stopCamera]);

useEffect(() => {
if (!cameraLive || !ready) return;

stopLoop();
rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
}, [cameraLive, processFrame, ready, stopLoop]);

const beginCapture = useCallback(() => {
setIsCapturing(true);
lastStateRef.current = currentMetricsRef.current.state;
}, []);

const endCapture = useCallback(() => {
setIsHolding(false);

if (holdTimerRef.current) {
window.clearTimeout(holdTimerRef.current);
holdTimerRef.current = null;
}

if (!isCapturing) return;

setIsCapturing(false);

const snapshot = currentMetricsRef.current;
pushEvent({
id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
at: formatNow(),
state: snapshot.state,
tilt: snapshot.tilt,
stability: snapshot.stability,
velocity: snapshot.velocity,
windowMs: snapshot.windowMs,
comDriftPx: snapshot.comDriftPx,
});
}, [isCapturing, pushEvent]);

const onHoldStart = useCallback(() => {
setIsHolding(true);

if (holdTimerRef.current) {
window.clearTimeout(holdTimerRef.current);
}

holdTimerRef.current = window.setTimeout(() => {
beginCapture();
}, HOLD_MS_TO_START);
}, [beginCapture]);

const resetSession = useCallback(() => {
setHistory([]);
setSelectedEventId(null);
setIsCapturing(false);
setIsHolding(false);
alignedStartRef.current = null;
recentTiltRef.current = [];
recentDriftRef.current = [];
recentStackRef.current = [];
lastComRef.current = null;
lastStateRef.current = 'LOST';
lastAlignedEventAtRef.current = 0;

syncMetricsToState({
state: 'LOST',
tilt: 0,
stability: 0,
velocity: 0,
windowMs: 0,
comDriftPx: 0,
});
}, [syncMetricsToState]);

const nextCalibrationKey = useMemo(() => {
if (!calibration.leftBoundary) return 'leftBoundary';
if (!calibration.rightBoundary) return 'rightBoundary';
if (!calibration.target) return 'target';
if (!calibration.playerStart) return 'playerStart';
return null;
}, [calibration]);

const handleCanvasTap = useCallback(
(event: React.MouseEvent<HTMLCanvasElement>) => {
const key = selectedPoint ?? nextCalibrationKey;
if (!key) return;

const rect = event.currentTarget.getBoundingClientRect();
const point = {
x: event.clientX - rect.left,
y: event.clientY - rect.top,
};

setCalibration((prev) => ({ ...prev, [key]: point }));
setSelectedPoint(null);
},
[nextCalibrationKey, selectedPoint]
);

return (
<main
style={{
minHeight: '100vh',
background: BG,
color: TEXT,
fontFamily: 'Inter, Arial, sans-serif',
}}
>
<div
style={{
width: '100%',
maxWidth: 980,
margin: '0 auto',
padding: '18px 14px 48px',
}}
>
<section
style={{
border: `1px solid ${LINE}`,
background: SURFACE,
}}
>
<div
ref={wrapRef}
style={{
position: 'relative',
aspectRatio: '9 / 16',
background: '#050505',
overflow: 'hidden',
}}
>
<video
ref={videoRef}
playsInline
muted
autoPlay
style={{
position: 'absolute',
inset: 0,
width: '100%',
height: '100%',
objectFit: 'cover',
filter: 'brightness(0.42) contrast(1.05) saturate(0.78)',
transform: 'scaleX(-1)',
}}
/>

<canvas
ref={canvasRef}
onClick={handleCanvasTap}
style={{
position: 'absolute',
inset: 0,
width: '100%',
height: '100%',
cursor: nextCalibrationKey || selectedPoint ? 'crosshair' : 'default',
}}
/>

<div
style={{
position: 'absolute',
top: 12,
left: 12,
right: 12,
display: 'flex',
justifyContent: 'space-between',
alignItems: 'center',
pointerEvents: 'none',
}}
>
<div
style={{
color: stateColor(axisState),
fontSize: 13,
letterSpacing: '0.24em',
}}
>
STATE
</div>

<div
style={{
color: quality === 'GOOD' ? ALIGNED : quality === 'LOW' ? SHIFT : LOST,
fontSize: 12,
letterSpacing: '0.18em',
}}
>
QUALITY {quality}
</div>
</div>

<div
style={{
position: 'absolute',
left: 16,
bottom: 16,
display: 'grid',
gap: 4,
}}
>
<div
style={{
color: stateColor(axisState),
fontSize: 42,
lineHeight: 1,
fontWeight: 700,
letterSpacing: '-0.04em',
}}
>
{axisState}
</div>

<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
}}
>
AXIS LINE ACTIVE
</div>
</div>
</div>

<div
style={{
borderTop: `1px solid ${LINE}`,
display: 'grid',
gridTemplateColumns: '1fr 1fr',
}}
>
{[
['STABILITY', `${Math.round(stability)}%`],
['WINDOW', `${Math.round(windowMs)} ms`],
['BODY AXIS', `${tilt.toFixed(1)}°`],
['COM DRIFT', `${comDriftPx.toFixed(1)} px`],
].map(([label, value], index) => (
<div
key={label}
style={{
padding: '18px 14px',
borderRight: index % 2 === 0 ? `1px solid ${LINE}` : undefined,
borderBottom: index < 2 ? `1px solid ${LINE}` : undefined,
}}
>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.24em',
marginBottom: 8,
}}
>
{label}
</div>
<div style={{ fontSize: 28, letterSpacing: '-0.04em' }}>{value}</div>
</div>
))}
</div>

<div
style={{
borderTop: `1px solid ${LINE}`,
padding: 14,
display: 'grid',
gap: 12,
}}
>
<button
onMouseDown={onHoldStart}
onMouseUp={endCapture}
onMouseLeave={endCapture}
onTouchStart={onHoldStart}
onTouchEnd={endCapture}
style={{
appearance: 'none',
border: `1px solid ${isCapturing || isHolding ? AXIS_GREEN : LINE}`,
background: isCapturing ? 'rgba(57,255,20,0.08)' : 'transparent',
color: TEXT,
padding: '18px 16px',
fontSize: 18,
letterSpacing: '0.18em',
}}
>
{isCapturing ? 'CAPTURING' : 'HOLD TO CAPTURE'}
</button>

<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
<button
onClick={resetSession}
style={{
appearance: 'none',
border: `1px solid ${LINE}`,
background: 'transparent',
color: TEXT,
padding: '16px 14px',
fontSize: 14,
letterSpacing: '0.12em',
}}
>
RESET SESSION
</button>

<button
onClick={() => setSelectedPoint(nextCalibrationKey ?? 'leftBoundary')}
style={{
appearance: 'none',
border: `1px solid ${LINE}`,
background: 'transparent',
color: TEXT,
padding: '16px 14px',
fontSize: 14,
letterSpacing: '0.12em',
}}
>
{nextCalibrationKey
? `SET ${nextCalibrationKey.replace(/([A-Z])/g, ' $1').toUpperCase()}`
: 'EDIT CALIBRATION'}
</button>
</div>

<div
style={{
color: MUTED,
fontSize: 12,
letterSpacing: '0.08em',
lineHeight: 1.7,
}}
>
LEFT BOUNDARY • RIGHT BOUNDARY • TARGET • PLAYER START
</div>
</div>
</section>

<section
style={{
marginTop: 18,
border: `1px solid ${LINE}`,
background: SURFACE,
}}
>
<div
style={{
padding: '16px 14px',
borderBottom: `1px solid ${LINE}`,
display: 'flex',
justifyContent: 'space-between',
alignItems: 'center',
}}
>
<div>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
marginBottom: 6,
}}
>
SESSION
</div>
<div style={{ fontSize: 28, letterSpacing: '-0.04em' }}>AXIS HISTORY</div>
</div>

<div
style={{
color: stateColor(axisState),
fontSize: 13,
letterSpacing: '0.22em',
}}
>
{axisState}
</div>
</div>

<div style={{ padding: 14, borderBottom: `1px solid ${LINE}` }}>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
marginBottom: 10,
}}
>
AXIS SHAPE
</div>

<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
{axisShape.length ? (
axisShape.map((item) => (
<button
key={item.id}
onClick={() => setSelectedEventId(item.id)}
style={{
appearance: 'none',
border: `1px solid ${stateColor(item.state)}`,
background: 'transparent',
color: stateColor(item.state),
padding: '10px 12px',
fontSize: 12,
letterSpacing: '0.16em',
}}
>
{item.state}
</button>
))
) : (
<div style={{ color: MUTED, fontSize: 14 }}>No movement captured yet.</div>
)}
</div>
</div>

<div style={{ padding: 14, borderBottom: `1px solid ${LINE}` }}>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
marginBottom: 10,
}}
>
RECAP
</div>

{selectedEvent ? (
<div style={{ display: 'grid', gap: 8 }}>
<div
style={{
fontSize: 26,
color: stateColor(selectedEvent.state),
letterSpacing: '-0.04em',
}}
>
{selectedEvent.state}
</div>

<div style={{ color: MUTED, fontSize: 14 }}>{selectedEvent.at}</div>

<div
style={{
display: 'grid',
gridTemplateColumns: '1fr 1fr',
gap: 8,
marginTop: 6,
}}
>
{[
['Body Axis', `${selectedEvent.tilt.toFixed(1)}°`],
['Stability', `${Math.round(selectedEvent.stability)}%`],
['Window', `${Math.round(selectedEvent.windowMs)} ms`],
['COM Drift', `${selectedEvent.comDriftPx.toFixed(1)} px`],
].map(([label, value]) => (
<div
key={label}
style={{
border: `1px solid ${LINE}`,
padding: 12,
}}
>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.18em',
marginBottom: 6,
}}
>
{label}
</div>
<div style={{ fontSize: 20 }}>{value}</div>
</div>
))}
</div>
</div>
) : (
<div style={{ color: MUTED }}>Capture a session to generate recap.</div>
)}
</div>

<div style={{ padding: 14, display: 'grid', gap: 10 }}>
{history.length ? (
history.map((item) => (
<button
key={item.id}
onClick={() => setSelectedEventId(item.id)}
style={{
appearance: 'none',
textAlign: 'left',
width: '100%',
border: `1px solid ${LINE}`,
background: 'transparent',
color: TEXT,
padding: 14,
}}
>
<div
style={{
display: 'flex',
justifyContent: 'space-between',
alignItems: 'center',
marginBottom: 10,
}}
>
<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
<span
style={{
width: 10,
height: 10,
borderRadius: '50%',
display: 'inline-block',
background: stateColor(item.state),
}}
/>
<span style={{ fontSize: 18 }}>{item.state}</span>
</div>

<span
style={{
color: stateColor(item.state),
fontSize: 12,
letterSpacing: '0.16em',
}}
>
{item.state}
</span>
</div>

<div style={{ color: MUTED, fontSize: 13, marginBottom: 10 }}>{item.at}</div>
<div style={{ color: TEXT, fontSize: 15 }}>{labelForEvent(item)}</div>
</button>
))
) : (
<div style={{ color: MUTED, padding: '4px 0 10px' }}>Axis History will appear here.</div>
)}
</div>
</section>
</div>
</main>
);
}