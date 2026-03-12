'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
AxisEvent,
AxisState,
Calibration,
DetectionMode,
Point,
clamp,
dist,
evaluateAxisFrame,
formatNow,
mean,
} from '@/lib/axis-engine';

const HOLD_MS_TO_START = 180;
const MAX_HISTORY = 24;
const CLEAN_WINDOW_MIN_MS = 350;

type CameraFacing = 'user' | 'environment';

export function useAxisEngine() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const wrapRef = useRef<HTMLDivElement | null>(null);
const poseRef = useRef<PoseLandmarker | null>(null);
const rafRef = useRef<number | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const holdTimerRef = useRef<number | null>(null);
const lastCenterRef = useRef<Point | null>(null);
const lastStateRef = useRef<AxisState>('LOST');
const alignedStartRef = useRef<number | null>(null);
const lastAlignedEventAtRef = useRef<number>(0);

const recentTiltRef = useRef<number[]>([]);
const recentDriftRef = useRef<number[]>([]);
const recentStackRef = useRef<number[]>([]);

const currentMetricsRef = useRef({
state: 'LOST' as AxisState,
mode: 'LOST' as DetectionMode,
tilt: 0,
stability: 0,
velocity: 0,
windowMs: 0,
driftPx: 0,
});

const [ready, setReady] = useState(false);
const [cameraLive, setCameraLive] = useState(false);
const [cameraFacing, setCameraFacing] = useState<CameraFacing>('environment');
const [isHolding, setIsHolding] = useState(false);
const [isCapturing, setIsCapturing] = useState(false);

const [axisState, setAxisState] = useState<AxisState>('LOST');
const [detectionMode, setDetectionMode] = useState<DetectionMode>('LOST');
const [tilt, setTilt] = useState(0);
const [stability, setStability] = useState(0);
const [velocity, setVelocity] = useState(0);
const [windowMs, setWindowMs] = useState(0);
const [driftPx, setDriftPx] = useState(0);

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
mode: DetectionMode;
tilt: number;
stability: number;
velocity: number;
windowMs: number;
driftPx: number;
}) => {
currentMetricsRef.current = next;
setAxisState(next.state);
setDetectionMode(next.mode);
setTilt(next.tilt);
setStability(next.stability);
setVelocity(next.velocity);
setWindowMs(next.windowMs);
setDriftPx(next.driftPx);
}, []);

const addStateEventIfNeeded = useCallback(
(
state: AxisState,
mode: DetectionMode,
tiltValue: number,
stabilityValue: number,
velocityValue: number,
windowValue: number,
nextDriftPx: number
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
mode,
tilt: tiltValue,
stability: stabilityValue,
velocity: velocityValue,
windowMs: windowValue,
driftPx: nextDriftPx,
});
},
[isCapturing, pushEvent]
);

const stopLoop = useCallback(() => {
if (rafRef.current) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}
}, []);

const stopCamera = useCallback(() => {
stopLoop();
streamRef.current?.getTracks().forEach((track) => track.stop());
streamRef.current = null;
if (videoRef.current) {
videoRef.current.pause();
videoRef.current.srcObject = null;
}
setCameraLive(false);
}, [stopLoop]);

const startCamera = useCallback(
async (facing: CameraFacing = cameraFacing) => {
try {
stopCamera();

const stream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: { ideal: facing },
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

setCameraFacing(facing);
setCameraLive(true);
} catch (error) {
console.error('Camera start failed', error);
setCameraLive(false);
}
},
[cameraFacing, stopCamera]
);

const flipCamera = useCallback(async () => {
const nextFacing: CameraFacing = cameraFacing === 'user' ? 'environment' : 'user';
await startCamera(nextFacing);
}, [cameraFacing, startCamera]);

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
minPoseDetectionConfidence: 0.45,
minPosePresenceConfidence: 0.45,
minTrackingConfidence: 0.45,
});

setReady(true);
}, [ready]);

const drawOverlay = useCallback(
(
poseLandmarks: Array<{ x: number; y: number; visibility?: number }> | null,
axisPoints: Point[] | null,
bodyCenter: Point | null,
state: AxisState,
mode: DetectionMode,
nextDriftPx: number
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

const axisX = calibration.playerStart?.x ?? rect.width / 2;

ctx.save();
ctx.strokeStyle =
state === 'ALIGNED' ? '#39FF14' : state === 'SHIFT' ? '#FFD400' : state === 'DROP' ? '#3FA7FF' : '#7A7A7A';
ctx.globalAlpha = mode === 'LOST' ? 0.25 : 0.9;
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
ctx.strokeStyle = 'rgba(255,255,255,0.22)';
ctx.lineWidth = 1.05;
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

if (axisPoints && axisPoints.length >= 2) {
ctx.save();
ctx.strokeStyle =
state === 'ALIGNED' ? '#00FF9C' : state === 'SHIFT' ? '#FFD400' : state === 'DROP' ? '#3FA7FF' : '#7A7A7A';
ctx.lineWidth = 3;
ctx.globalAlpha = 0.95;
ctx.beginPath();
ctx.moveTo(axisPoints[0].x, axisPoints[0].y);
for (let i = 1; i < axisPoints.length; i += 1) {
ctx.lineTo(axisPoints[i].x, axisPoints[i].y);
}
ctx.stroke();
ctx.restore();

ctx.save();
ctx.fillStyle =
state === 'ALIGNED' ? '#00FF9C' : state === 'SHIFT' ? '#FFD400' : state === 'DROP' ? '#3FA7FF' : '#7A7A7A';
axisPoints.forEach((p) => {
ctx.beginPath();
ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
ctx.fill();
});
ctx.restore();
}

if (bodyCenter) {
const pulse = 6 + Math.min(12, nextDriftPx * 0.12);
ctx.save();
ctx.fillStyle =
state === 'ALIGNED' ? '#00FF9C' : state === 'SHIFT' ? '#FFD400' : state === 'DROP' ? '#3FA7FF' : '#7A7A7A';
ctx.shadowBlur = 14;
ctx.shadowColor = ctx.fillStyle as string;
ctx.beginPath();
ctx.arc(bodyCenter.x, bodyCenter.y, pulse, 0, Math.PI * 2);
ctx.fill();
ctx.restore();
}

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

let result: any;
try {
result = pose.detectForVideo(video, nowMs);
} catch (error) {
console.error('detectForVideo failed', error);
rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
return;
}

const landmarks = result?.landmarks?.[0] ?? null;
const width = wrap.clientWidth;
const height = wrap.clientHeight;

if (!landmarks) {
syncMetricsToState({
state: 'LOST',
mode: 'LOST',
tilt: 0,
stability: 0,
velocity: 0,
windowMs: 0,
driftPx: 0,
});

drawOverlay(null, null, null, 'LOST', 'LOST', 0);
addStateEventIfNeeded('LOST', 'LOST', 0, 0, 0, 0, 0);

rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
return;
}

let nextVelocity = 0;
const axisX = calibration.playerStart?.x ?? width / 2;

const preview = evaluateAxisFrame(landmarks, width, height, axisX, 0);

if (preview.bodyCenter && lastCenterRef.current) {
nextVelocity = dist(preview.bodyCenter, lastCenterRef.current);
}

const evaluated = evaluateAxisFrame(landmarks, width, height, axisX, nextVelocity);
lastCenterRef.current = evaluated.bodyCenter;

recentTiltRef.current = [...recentTiltRef.current.slice(-24), evaluated.tiltDeg];
recentDriftRef.current = [...recentDriftRef.current.slice(-24), evaluated.driftPx];
recentStackRef.current = [...recentStackRef.current.slice(-24), evaluated.stackSpread];

const avgTilt = mean(recentTiltRef.current);
const avgDrift = mean(recentDriftRef.current);
const avgStack = mean(recentStackRef.current);
const driftVariance = mean(recentDriftRef.current.map((v) => Math.abs(v - avgDrift)));
const stackVariance = mean(recentStackRef.current.map((v) => Math.abs(v - avgStack)));

const nextStability =
evaluated.mode === 'LOST'
? 0
: clamp(100 - avgTilt * 1.5 - driftVariance * 1.2 - stackVariance * 1.0, 0, 100);

let nextWindow = 0;
if (evaluated.state === 'ALIGNED') {
if (alignedStartRef.current === null) alignedStartRef.current = nowMs;
nextWindow = nowMs - alignedStartRef.current;
} else {
alignedStartRef.current = null;
}

syncMetricsToState({
state: evaluated.state,
mode: evaluated.mode,
tilt: evaluated.tiltDeg,
stability: nextStability,
velocity: nextVelocity,
windowMs: nextWindow,
driftPx: evaluated.driftPx,
});

drawOverlay(
landmarks,
evaluated.axisPoints,
evaluated.bodyCenter,
evaluated.state,
evaluated.mode,
evaluated.driftPx
);

addStateEventIfNeeded(
evaluated.state,
evaluated.mode,
evaluated.tiltDeg,
nextStability,
nextVelocity,
nextWindow,
evaluated.driftPx
);

if (isCapturing && evaluated.state === 'ALIGNED' && nextWindow >= CLEAN_WINDOW_MIN_MS) {
const now = Date.now();
if (now - lastAlignedEventAtRef.current > 900) {
lastAlignedEventAtRef.current = now;
pushEvent({
id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
at: formatNow(),
state: 'ALIGNED',
mode: evaluated.mode,
tilt: evaluated.tiltDeg,
stability: nextStability,
velocity: nextVelocity,
windowMs: nextWindow,
driftPx: evaluated.driftPx,
});
}
}

rafRef.current = requestAnimationFrame(() => {
void processFrame();
});
}, [addStateEventIfNeeded, calibration.playerStart, drawOverlay, isCapturing, pushEvent, syncMetricsToState]);

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
mode: snapshot.mode,
tilt: snapshot.tilt,
stability: snapshot.stability,
velocity: snapshot.velocity,
windowMs: snapshot.windowMs,
driftPx: snapshot.driftPx,
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
lastCenterRef.current = null;
lastStateRef.current = 'LOST';
lastAlignedEventAtRef.current = 0;

syncMetricsToState({
state: 'LOST',
mode: 'LOST',
tilt: 0,
stability: 0,
velocity: 0,
windowMs: 0,
driftPx: 0,
});
}, [syncMetricsToState]);

const nextCalibrationKey = useMemo(() => {
if (!calibration.leftBoundary) return 'leftBoundary' as const;
if (!calibration.rightBoundary) return 'rightBoundary' as const;
if (!calibration.target) return 'target' as const;
if (!calibration.playerStart) return 'playerStart' as const;
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

return {
videoRef,
canvasRef,
wrapRef,
axisState,
detectionMode,
tilt,
stability,
velocity,
windowMs,
driftPx,
history,
selectedEvent,
axisShape,
isHolding,
isCapturing,
cameraLive,
cameraFacing,
selectedPoint,
nextCalibrationKey,
startCamera,
stopCamera,
flipCamera,
onHoldStart,
endCapture,
resetSession,
setSelectedPoint,
setSelectedEventId,
handleCanvasTap,
};
}