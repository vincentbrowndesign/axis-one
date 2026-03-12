'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

type Landmark = {
x: number;
y: number;
z?: number;
visibility?: number;
};

type PoseLandmarkerResult = {
landmarks?: Landmark[][];
};

type AxisState = 'ALIGNED' | 'SHIFT' | 'DROP' | 'LOST' | 'ENTER FRAME';
type EventTone = 'green' | 'blue' | 'yellow' | 'gray';
type SessionPhase = 'idle' | 'starting' | 'live';

type EventItem = {
id: string;
title: string;
value: string;
tone: EventTone;
ts: string;
};

type DriftPoint = {
x: number;
y: number;
};

type BodyMetrics = {
ls: Landmark;
rs: Landmark;
lh: Landmark;
rh: Landmark;
shoulderMid: { x: number; y: number };
hipMid: { x: number; y: number };
center: { x: number; y: number };
lean: number;
stability: number;
centerScore: number;
tiltDegrees: number;
velocity: number;
state: Exclude<AxisState, 'LOST' | 'ENTER FRAME'>;
};

const BG = '#0B0B0B';
const SURFACE = '#101010';
const TEXT = '#F5F5F5';
const MUTED = '#8D8D8D';
const LINE = '#2A2A2A';
const GREEN = '#39FF14';
const ALIGNED = '#00FF9C';
const SHIFT = '#FFD400';
const DROP = '#3FA7FF';
const LOST = '#7A7A7A';

const UI_REFRESH_MS = 180;
const MAX_TRAIL_POINTS = 18;
const MAX_EVENTS = 6;

const SMOOTH_STABILITY = 0.18;
const SMOOTH_TILT = 0.12;
const SMOOTH_WINDOW = 0.12;
const SMOOTH_VELOCITY = 0.16;
const SMOOTH_QUALITY = 0.14;

const ALIGNED_THRESHOLD = 0.83;
const SHIFT_THRESHOLD = 0.6;
const STATE_HOLD_MS = 220;
const LOST_GRACE_MS = 1200;
const LOST_EVENT_MS = 2200;
const EVENT_COOLDOWN_MS = 1800;

function clamp(value: number, min = 0, max = 1) {
return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
return a + (b - a) * t;
}

function shouldUpdateNumber(next: number, prev: number, epsilon: number) {
return Math.abs(next - prev) >= epsilon;
}

function pointVisible(p?: Landmark) {
return Boolean(p && (p.visibility ?? 1) > 0.2);
}

function midpoint(a: Landmark, b: Landmark) {
return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance2D(a: { x: number; y: number }, b: { x: number; y: number }) {
const dx = a.x - b.x;
const dy = a.y - b.y;
return Math.sqrt(dx * dx + dy * dy);
}

function nowTime() {
return new Date().toLocaleTimeString([], {
hour: 'numeric',
minute: '2-digit',
second: '2-digit',
});
}

function qualityLabel(score: number) {
if (score >= 85) return 'GOOD';
if (score >= 70) return 'OK';
return 'LOW';
}

function stateColor(state: AxisState) {
if (state === 'ALIGNED') return ALIGNED;
if (state === 'SHIFT') return SHIFT;
if (state === 'DROP') return DROP;
return LOST;
}

function stateTone(state: AxisState): EventTone {
if (state === 'ALIGNED') return 'green';
if (state === 'SHIFT') return 'yellow';
if (state === 'DROP') return 'blue';
return 'gray';
}

function toneBadge(tone: EventTone) {
if (tone === 'green') return { text: 'GOOD', color: ALIGNED };
if (tone === 'blue') return { text: 'WARN', color: DROP };
if (tone === 'yellow') return { text: 'SHIFT', color: SHIFT };
return { text: 'LOST', color: LOST };
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

if (![ls, rs, lh, rh].every(pointVisible)) return null;

const shoulderMid = midpoint(ls, rs);
const hipMid = midpoint(lh, rh);

const dx = shoulderMid.x - hipMid.x;
const dy = shoulderMid.y - hipMid.y;
const torsoLength = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);

const lean = Math.abs(dx) / torsoLength;
const shoulderSlope = Math.abs(ls.y - rs.y) / Math.max(Math.abs(ls.x - rs.x), 0.001);

let tiltDegrees = Math.abs(Math.atan2(ls.y - rs.y, rs.x - ls.x)) * (180 / Math.PI);
tiltDegrees = Math.min(tiltDegrees, 45);

const center = {
x: hipMid.x,
y: (shoulderMid.y + hipMid.y) / 2,
};

let velocity = 0;
if (previousCenter && dtMs > 0) {
velocity = distance2D(center, previousCenter) / dtMs;
}

const alignment = clamp(1 - lean * 1.45 - shoulderSlope * 0.62);
const velocityPenalty = clamp(velocity * 22, 0, 1);
const leanPenalty = clamp(lean * 0.95, 0, 1);
const tiltPenalty = clamp((tiltDegrees / 30) * 0.45, 0, 1);

const stability = clamp(
1 - (velocityPenalty * 0.6 + leanPenalty * 0.22 + tiltPenalty * 0.18),
0,
1
);

const centerScore = clamp(alignment * 0.48 + stability * 0.52);

const state: BodyMetrics['state'] =
centerScore >= ALIGNED_THRESHOLD ? 'ALIGNED' : centerScore >= SHIFT_THRESHOLD ? 'SHIFT' : 'DROP';

return {
ls,
rs,
lh,
rh,
shoulderMid,
hipMid,
center,
lean,
stability,
centerScore,
tiltDegrees,
velocity,
state,
};
}

export default function AxisInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);

const poseRef = useRef<PoseLandmarker | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const rafRef = useRef<number | null>(null);

const mountedRef = useRef(false);
const runningRef = useRef(false);
const modelReadyRef = useRef(false);
const facingModeRef = useRef<'user' | 'environment'>('user');

const lastUiUpdateRef = useRef(0);
const lastDetectionRef = useRef(0);
const lastFrameTsRef = useRef<number | null>(null);
const previousCenterRef = useRef<{ x: number; y: number } | null>(null);
const lastEventAtRef = useRef<Record<string, number>>({});

const smoothedRef = useRef({
stability: 76,
tilt: 8,
windowMs: 640,
quality: 82,
velocity: 0,
});

const publishedRef = useRef({
stability: 76,
tilt: 8,
windowMs: 640,
quality: 82,
velocity: 0,
});

const stateStableRef = useRef<{
current: AxisState;
pending: AxisState | null;
since: number | null;
}>({
current: 'ENTER FRAME',
pending: null,
since: null,
});

const trailRef = useRef<DriftPoint[]>([]);
const latestBodyRef = useRef<BodyMetrics | null>(null);
const previousStateRef = useRef<AxisState>('ENTER FRAME');

const [phase, setPhase] = useState<SessionPhase>('idle');
const [status, setStatus] = useState('Motion Ready');
const [stateLabel, setStateLabel] = useState<AxisState>('ENTER FRAME');
const [stability, setStability] = useState(76);
const [windowMs, setWindowMs] = useState(640);
const [quality, setQuality] = useState('GOOD');
const [tilt, setTilt] = useState(8);
const [velocityRead, setVelocityRead] = useState(0);
const [events, setEvents] = useState<EventItem[]>([]);
const [isPaused, setIsPaused] = useState(false);
const [cameraLabel, setCameraLabel] = useState('Front');
const [isFlipping, setIsFlipping] = useState(false);
const [isHolding, setIsHolding] = useState(false);
const [isCapturing, setIsCapturing] = useState(false);

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

const vision = await FilesetResolver.forVisionTasks('/wasm');

poseRef.current = await PoseLandmarker.createFromOptions(vision, {
baseOptions: {
modelAssetPath: '/models/pose_landmarker_full.task',
delegate: 'CPU',
},
runningMode: 'VIDEO',
numPoses: 1,
minPoseDetectionConfidence: 0.2,
minPosePresenceConfidence: 0.2,
minTrackingConfidence: 0.2,
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
if (!video) throw new Error('Video missing');

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

setCameraLabel(facingModeRef.current === 'user' ? 'Front' : 'Back');
}, []);

const pushEvent = useCallback((title: string, value: string, tone: EventTone) => {
const now = performance.now();
const key = `${title}:${value}`;
const lastAt = lastEventAtRef.current[key] ?? 0;
if (now - lastAt < EVENT_COOLDOWN_MS) return;
lastEventAtRef.current[key] = now;

setEvents((prev) =>
[
{
id: `${Date.now()}-${Math.random()}`,
title,
value,
tone,
ts: nowTime(),
},
...prev,
].slice(0, MAX_EVENTS)
);
}, []);

const drawInstrument = useCallback(() => {
const canvas = canvasRef.current;
const video = videoRef.current;
if (!canvas) return;

const width = canvas.clientWidth || 1200;
const height = canvas.clientHeight || 1200;

if (canvas.width !== width || canvas.height !== height) {
canvas.width = width;
canvas.height = height;
}

const ctx = canvas.getContext('2d');
if (!ctx) return;

ctx.clearRect(0, 0, width, height);
ctx.fillStyle = '#050505';
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
ctx.globalAlpha = 0.16;
ctx.filter = 'grayscale(1) blur(0.7px) contrast(1.05) brightness(0.72)';
if (facingModeRef.current === 'user') {
ctx.translate(width, 0);
ctx.scale(-1, 1);
}
ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
ctx.restore();
}

const cx = width / 2;
const cy = height / 2;

ctx.save();

ctx.strokeStyle = 'rgba(255,255,255,0.04)';
ctx.lineWidth = 1;

for (let i = 1; i <= 7; i += 1) {
const y = (height / 8) * i;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}

for (let i = 1; i <= 7; i += 1) {
const x = (width / 8) * i;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}

ctx.strokeStyle = 'rgba(255,255,255,0.12)';
ctx.lineWidth = 1.8;

ctx.beginPath();
ctx.moveTo(cx, 0);
ctx.lineTo(cx, height);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(0, cy);
ctx.lineTo(width, cy);
ctx.stroke();

const mark = 18;
ctx.strokeStyle = 'rgba(255,255,255,0.08)';
ctx.lineWidth = 1.2;

ctx.beginPath();
ctx.moveTo(cx - mark, cy);
ctx.lineTo(cx + mark, cy);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(cx, cy - mark);
ctx.lineTo(cx, cy + mark);
ctx.stroke();

const body = latestBodyRef.current;
if (body) {
const toCanvas = (p: { x: number; y: number }) => {
const xBase = facingModeRef.current === 'user' ? 1 - p.x : p.x;
return { x: xBase * width, y: p.y * height };
};

const ls = toCanvas(body.ls);
const rs = toCanvas(body.rs);
const shoulderMid = toCanvas(body.shoulderMid);
const hipMid = toCanvas(body.hipMid);
const center = toCanvas(body.center);

ctx.save();

const currentState = stateStableRef.current.current;
const stroke =
currentState === 'ALIGNED'
? 'rgba(124,255,158,0.88)'
: currentState === 'SHIFT'
? 'rgba(232,199,92,0.86)'
: currentState === 'DROP'
? 'rgba(89,168,255,0.86)'
: 'rgba(255,255,255,0.5)';

ctx.strokeStyle = stroke;
ctx.lineWidth = 2.2;
ctx.beginPath();
ctx.moveTo(shoulderMid.x, shoulderMid.y);
ctx.lineTo(hipMid.x, hipMid.y);
ctx.stroke();

ctx.lineWidth = 4;
ctx.beginPath();
ctx.moveTo(ls.x, ls.y);
ctx.lineTo(rs.x, rs.y);
ctx.stroke();

if (trailRef.current.length > 1) {
ctx.beginPath();
trailRef.current.forEach((p, i) => {
const c = toCanvas(p);
if (i === 0) ctx.moveTo(c.x, c.y);
else ctx.lineTo(c.x, c.y);
});
ctx.strokeStyle = stroke
.replace('0.88', '0.2')
.replace('0.86', '0.2')
.replace('0.5', '0.18');
ctx.lineWidth = 2;
ctx.stroke();
}

ctx.fillStyle = stroke.replace('0.88', '1').replace('0.86', '1').replace('0.5', '0.85');
ctx.beginPath();
ctx.arc(center.x, center.y, 7, 0, Math.PI * 2);
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

smoothedRef.current.velocity = lerp(smoothedRef.current.velocity, body.velocity, SMOOTH_VELOCITY);
smoothedRef.current.stability = lerp(
smoothedRef.current.stability,
body.stability * 100,
SMOOTH_STABILITY
);
smoothedRef.current.tilt = lerp(smoothedRef.current.tilt, body.tiltDegrees, SMOOTH_TILT);
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

if (stable.current === 'ENTER FRAME' || stable.current === 'LOST') {
stable.current = nextState;
stable.pending = null;
stable.since = null;
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

const pStability = Math.round(smoothedRef.current.stability);
const pTilt = Number(smoothedRef.current.tilt.toFixed(1));
const pWindow = Math.round(smoothedRef.current.windowMs);
const pQuality = Math.round(smoothedRef.current.quality);
const pVelocity = Number(smoothedRef.current.velocity.toFixed(4));

if (shouldUpdateNumber(pStability, publishedRef.current.stability, 1)) {
publishedRef.current.stability = pStability;
}
if (shouldUpdateNumber(pTilt, publishedRef.current.tilt, 0.2)) {
publishedRef.current.tilt = pTilt;
}
if (shouldUpdateNumber(pWindow, publishedRef.current.windowMs, 3)) {
publishedRef.current.windowMs = pWindow;
}
if (shouldUpdateNumber(pQuality, publishedRef.current.quality, 1)) {
publishedRef.current.quality = pQuality;
}
if (shouldUpdateNumber(pVelocity, publishedRef.current.velocity, 0.0005)) {
publishedRef.current.velocity = pVelocity;
}

trailRef.current.push({ x: body.center.x, y: body.center.y });
if (trailRef.current.length > MAX_TRAIL_POINTS) trailRef.current.shift();

const eventState = stateStableRef.current.current as AxisState;

if (eventState !== previousStateRef.current) {
switch (eventState) {
case 'ALIGNED':
pushEvent('ALIGNED', `Window ${pWindow} ms`, stateTone('ALIGNED'));
break;
case 'SHIFT':
pushEvent('SHIFT', `Tilt ${pTilt.toFixed(1)}°`, stateTone('SHIFT'));
break;
case 'DROP':
pushEvent('DROP', `Velocity ${pVelocity.toFixed(4)}`, stateTone('DROP'));
break;
default:
break;
}

previousStateRef.current = eventState;
}

if (now - lastUiUpdateRef.current >= UI_REFRESH_MS) {
lastUiUpdateRef.current = now;
setStateLabel(stable.current);
setStability(publishedRef.current.stability);
setTilt(publishedRef.current.tilt);
setWindowMs(publishedRef.current.windowMs);
setQuality(qualityLabel(publishedRef.current.quality));
setVelocityRead(publishedRef.current.velocity);
setStatus('Motion Ready');
}
}
}

const lostFor = now - lastDetectionRef.current;
if (!foundPose && latestBodyRef.current) {
if (lostFor > LOST_GRACE_MS) {
stateStableRef.current.current = 'LOST';
if (now - lastUiUpdateRef.current >= UI_REFRESH_MS) {
lastUiUpdateRef.current = now;
setStateLabel('LOST');
setStatus('Signal lost');
}
}

if (lostFor > LOST_EVENT_MS) {
pushEvent('SIGNAL LOST', 'Tracking lost', 'gray');
}
}

drawInstrument();

if (runningRef.current) {
rafRef.current = requestAnimationFrame(processFrame);
}
}, [drawInstrument, isPaused, pushEvent]);

const startSystem = useCallback(async () => {
if (phase === 'starting' || phase === 'live') return;

setPhase('starting');
setStatus('Starting');

try {
await loadPoseModel();
await ensureCamera();

runningRef.current = true;
setPhase('live');
setStatus('Motion Ready');

if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = requestAnimationFrame(processFrame);
} catch (error) {
console.error(error);
setPhase('idle');
setStatus('Camera failed');
}
}, [ensureCamera, loadPoseModel, phase, processFrame]);

const restartCamera = useCallback(async () => {
runningRef.current = false;

if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}

stopStream();

try {
await ensureCamera();
if (phase === 'live') {
runningRef.current = true;
rafRef.current = requestAnimationFrame(processFrame);
}
setStatus('Motion Ready');
} catch (error) {
console.error(error);
setPhase('idle');
setStatus('Camera failed');
}
}, [ensureCamera, phase, processFrame, stopStream]);

const flipCamera = useCallback(async () => {
if (isFlipping) return;

setIsFlipping(true);
setStatus('Flipping camera');

const wasLive = phase === 'live';
runningRef.current = false;

if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}

stopStream();
facingModeRef.current = facingModeRef.current === 'user' ? 'environment' : 'user';

try {
await ensureCamera();

if (wasLive) {
runningRef.current = true;
setPhase('live');
setStatus('Motion Ready');
rafRef.current = requestAnimationFrame(processFrame);
} else {
setStatus('Motion Ready');
}
} catch (error) {
console.error(error);
setPhase('idle');
setStatus('Camera failed');
} finally {
setIsFlipping(false);
}
}, [ensureCamera, isFlipping, phase, processFrame, stopStream]);

const resetSystem = useCallback(() => {
trailRef.current = [];
latestBodyRef.current = null;
previousStateRef.current = 'ENTER FRAME';
previousCenterRef.current = null;
lastFrameTsRef.current = null;
stateStableRef.current = {
current: 'ENTER FRAME',
pending: null,
since: null,
};
publishedRef.current = {
stability: 76,
tilt: 8,
windowMs: 640,
quality: 82,
velocity: 0,
};
smoothedRef.current = {
stability: 76,
tilt: 8,
windowMs: 640,
quality: 82,
velocity: 0,
};
lastEventAtRef.current = {};
setEvents([]);
setStateLabel('ENTER FRAME');
setStability(76);
setWindowMs(640);
setTilt(8);
setVelocityRead(0);
setQuality('GOOD');
setStatus('Motion Ready');
drawInstrument();
}, [drawInstrument]);

useEffect(() => {
mountedRef.current = true;
drawInstrument();

return () => {
mountedRef.current = false;
runningRef.current = false;
if (rafRef.current) cancelAnimationFrame(rafRef.current);
stopStream();
if (poseRef.current?.close) poseRef.current.close();
poseRef.current = null;
modelReadyRef.current = false;
};
}, [drawInstrument, stopStream]);

const onHoldStart = useCallback(() => {
setIsHolding(true);
setIsCapturing(true);
pushEvent('CAPTURE', 'Session capture started', 'gray');
}, [pushEvent]);

const onHoldEnd = useCallback(() => {
setIsHolding(false);
if (isCapturing) {
pushEvent('CAPTURE END', `${stateLabel} • ${windowMs} ms`, stateTone(stateLabel));
}
setIsCapturing(false);
}, [isCapturing, pushEvent, stateLabel, windowMs]);

const recap = useMemo(() => events[0] ?? null, [events]);
const axisShape = useMemo(() => events.slice(0, 4).reverse(), [events]);
const stateCol = useMemo(() => stateColor(stateLabel), [stateLabel]);

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
style={{
position: 'relative',
aspectRatio: '9 / 16',
background: '#050505',
overflow: 'hidden',
}}
>
<canvas
ref={canvasRef}
style={{
display: 'block',
width: '100%',
height: '100%',
}}
/>
<video ref={videoRef} playsInline muted autoPlay style={{ display: 'none' }} />

<div
style={{
position: 'absolute',
top: 12,
left: 12,
right: 12,
display: 'flex',
justifyContent: 'space-between',
pointerEvents: 'none',
}}
>
<div
style={{
color: MUTED,
fontSize: 13,
letterSpacing: '0.24em',
}}
>
STATE
</div>

<div
style={{
color: MUTED,
fontSize: 12,
letterSpacing: '0.18em',
}}
>
QUALITY {phase === 'live' ? quality : 'NO SIGNAL'}
</div>
</div>

<div
style={{
position: 'absolute',
left: 16,
bottom: 16,
display: 'grid',
gap: 4,
pointerEvents: 'none',
}}
>
<div
style={{
color: stateCol,
fontSize: 42,
lineHeight: 1,
fontWeight: 700,
letterSpacing: '-0.04em',
}}
>
{stateLabel === 'ENTER FRAME' ? 'ENTER FRAME' : stateLabel}
</div>

<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
}}
>
{status.toUpperCase()}
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
['STABILITY', `${stability}%`],
['WINDOW', `${windowMs} ms`],
['BODY AXIS', `${tilt.toFixed(1)}°`],
['DRIFT', velocityRead.toFixed(4)],
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
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
<button
onClick={restartCamera}
style={buttonStyle(true)}
>
{phase === 'live' ? 'RESTART CAMERA' : 'START CAMERA'}
</button>

<button
onClick={flipCamera}
style={buttonStyle(false)}
>
{isFlipping ? 'FLIPPING...' : 'FLIP CAMERA'}
</button>
</div>

<button
onMouseDown={onHoldStart}
onMouseUp={onHoldEnd}
onMouseLeave={onHoldEnd}
onTouchStart={onHoldStart}
onTouchEnd={onHoldEnd}
style={{
...buttonStyle(false),
border: `1px solid ${isHolding || isCapturing ? GREEN : LINE}`,
background: isHolding || isCapturing ? 'rgba(57,255,20,0.08)' : 'transparent',
fontSize: 18,
letterSpacing: '0.18em',
padding: '18px 16px',
}}
>
{isCapturing ? 'CAPTURING' : 'HOLD TO CAPTURE'}
</button>

<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
<button onClick={resetSystem} style={buttonStyle(false)}>
RESET SESSION
</button>

<button onClick={startSystem} style={buttonStyle(false)}>
{phase === 'starting' ? 'STARTING' : phase === 'live' ? 'LIVE' : 'MOTION READY'}
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
color: stateCol,
fontSize: 13,
letterSpacing: '0.22em',
}}
>
{stateLabel}
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

<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
{axisShape.length ? (
axisShape.map((item) => (
<div
key={item.id}
style={{
border: `1px solid ${toneBadge(item.tone).color}`,
color: toneBadge(item.tone).color,
padding: '10px 12px',
fontSize: 12,
letterSpacing: '0.16em',
}}
>
{item.title}
</div>
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

{recap ? (
<div style={{ display: 'grid', gap: 8 }}>
<div
style={{
fontSize: 26,
color: toneBadge(recap.tone).color,
letterSpacing: '-0.04em',
}}
>
{recap.title}
</div>

<div style={{ color: MUTED, fontSize: 14 }}>{recap.ts}</div>
<div style={{ color: MUTED, fontSize: 15 }}>{recap.value}</div>

<div
style={{
display: 'grid',
gridTemplateColumns: '1fr 1fr',
gap: 8,
marginTop: 6,
}}
>
{[
['Body Axis', `${tilt.toFixed(1)}°`],
['Stability', `${stability}%`],
['Window', `${windowMs} ms`],
['Velocity', velocityRead.toFixed(4)],
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
{events.length ? (
events.map((event) => {
const badge = toneBadge(event.tone);
return (
<div
key={event.id}
style={{
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
background: badge.color,
}}
/>
<span style={{ fontSize: 18 }}>{event.title}</span>
</div>

<span
style={{
color: badge.color,
fontSize: 12,
letterSpacing: '0.16em',
}}
>
{badge.text}
</span>
</div>

<div style={{ color: MUTED, fontSize: 13, marginBottom: 10 }}>{event.ts}</div>
<div style={{ color: TEXT, fontSize: 15 }}>{event.value}</div>
</div>
);
})
) : (
<div style={{ color: MUTED, padding: '4px 0 10px' }}>Axis History will appear here.</div>
)}
</div>
</section>
</div>
</main>
);
}

function buttonStyle(primary: boolean): React.CSSProperties {
return {
appearance: 'none',
border: `1px solid ${primary ? GREEN : LINE}`,
background: 'transparent',
color: primary ? GREEN : TEXT,
padding: '16px 14px',
fontSize: 14,
letterSpacing: '0.12em',
};
}