"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Landmark = {
x: number;
y: number;
z?: number;
visibility?: number;
};

type PoseStateLabel = "LOCK" | "SHIFT" | "DROP" | "OFF AXIS" | "READING" | "IDLE";
type MotionPhaseLabel = "SET" | "LOAD" | "RISE" | "RELEASE" | "FINISH" | "IDLE";
type LockState = "SEARCHING" | "ALIGNING" | "AXIS LOCK";

type Metrics = {
state: PoseStateLabel;
phase: MotionPhaseLabel;
shoulderTilt: number;
hipTilt: number;
elbowAngle: number;
kneeFlex: number;
centerOffset: number;
weightBias: number;
forceAngle: number;
confidence: number;
};

type PoseLandmarkerLike = {
setOptions: (options: Record<string, unknown>) => Promise<void>;
detectForVideo: (
video: HTMLVideoElement,
timestamp: number
) => {
landmarks?: Landmark[][];
};
close?: () => void;
};

const MODEL_PATH = "/models/pose_landmarker_full.task";
const WASM_PATH =
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

const POSE_CONNECTIONS: Array<[number, number]> = [
[0, 1],
[1, 2],
[2, 3],
[3, 7],
[0, 4],
[4, 5],
[5, 6],
[6, 8],
[9, 10],
[11, 12],
[11, 13],
[13, 15],
[15, 17],
[15, 19],
[15, 21],
[17, 19],
[12, 14],
[14, 16],
[16, 18],
[16, 20],
[16, 22],
[18, 20],
[11, 23],
[12, 24],
[23, 24],
[23, 25],
[24, 26],
[25, 27],
[26, 28],
[27, 29],
[28, 30],
[29, 31],
[30, 32],
[27, 31],
[28, 32],
];

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1) {
const factor = 10 ** decimals;
return Math.round(value * factor) / factor;
}

function angleBetween(a: Landmark, b: Landmark, c: Landmark) {
const abx = a.x - b.x;
const aby = a.y - b.y;
const cbx = c.x - b.x;
const cby = c.y - b.y;

const dot = abx * cbx + aby * cby;
const magAB = Math.hypot(abx, aby);
const magCB = Math.hypot(cbx, cby);

if (!magAB || !magCB) return 0;

const cosTheta = clamp(dot / (magAB * magCB), -1, 1);
return (Math.acos(cosTheta) * 180) / Math.PI;
}

function lineAngleDegrees(a: Landmark, b: Landmark) {
return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function midpoint(a: Landmark, b: Landmark): Landmark {
return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
visibility: ((a.visibility ?? 1) + (b.visibility ?? 1)) / 2,
};
}

function toCanvasPoint(
landmark: Landmark,
width: number,
height: number
): { x: number; y: number } {
return { x: landmark.x * width, y: landmark.y * height };
}

function averageVisibility(landmarks: Landmark[]) {
if (!landmarks.length) return 0;
return (
landmarks.reduce((sum, lm) => sum + (lm.visibility ?? 1), 0) / landmarks.length
);
}

function detectMetrics(
landmarks: Landmark[] | null,
previousWristY: number | null
): Metrics {
const fallback: Metrics = {
state: "IDLE",
phase: "IDLE",
shoulderTilt: 0,
hipTilt: 0,
elbowAngle: 0,
kneeFlex: 0,
centerOffset: 0,
weightBias: 0,
forceAngle: 0,
confidence: 0,
};

if (!landmarks || landmarks.length < 33) return fallback;

const leftShoulder = landmarks[11];
const rightShoulder = landmarks[12];
const rightElbow = landmarks[14];
const rightWrist = landmarks[16];
const leftHip = landmarks[23];
const rightHip = landmarks[24];
const leftKnee = landmarks[25];
const rightKnee = landmarks[26];
const leftAnkle = landmarks[27];
const rightAnkle = landmarks[28];
const nose = landmarks[0];

const hipMid = midpoint(leftHip, rightHip);
const ankleMid = midpoint(leftAnkle, rightAnkle);

const shoulderTilt = lineAngleDegrees(leftShoulder, rightShoulder);
const hipTilt = lineAngleDegrees(leftHip, rightHip);

const elbowAngle = angleBetween(rightShoulder, rightElbow, rightWrist);
const rightKneeAngle = angleBetween(rightHip, rightKnee, rightAnkle);
const leftKneeAngle = angleBetween(leftHip, leftKnee, leftAnkle);
const kneeFlex = 180 - (leftKneeAngle + rightKneeAngle) / 2;

const footWidth = Math.max(0.0001, Math.abs(rightAnkle.x - leftAnkle.x));
const centerOffset = ((hipMid.x - ankleMid.x) / footWidth) * 100;
const weightBias = ((rightHip.x - leftHip.x) / footWidth) * 50;
const forceAngle = lineAngleDegrees(hipMid, rightWrist);

const confidence = averageVisibility([
leftShoulder,
rightShoulder,
rightElbow,
rightWrist,
leftHip,
rightHip,
leftKnee,
rightKnee,
leftAnkle,
rightAnkle,
]);

const wristAboveShoulder = rightWrist.y < rightShoulder.y;
const wristAboveHead = rightWrist.y < nose.y;
const wristRising =
previousWristY !== null ? rightWrist.y < previousWristY - 0.004 : false;
const wristFalling =
previousWristY !== null ? rightWrist.y > previousWristY + 0.004 : false;

let phase: MotionPhaseLabel = "SET";
if (wristAboveHead && elbowAngle > 140) {
phase = "FINISH";
} else if (wristAboveShoulder && elbowAngle > 120 && wristRising) {
phase = "RELEASE";
} else if (wristAboveShoulder && elbowAngle <= 120) {
phase = "RISE";
} else if (kneeFlex > 18 || wristFalling) {
phase = "LOAD";
}

let state: PoseStateLabel = "LOCK";
const tiltMagnitude = Math.abs(shoulderTilt) + Math.abs(hipTilt);
const absCenter = Math.abs(centerOffset);

if (confidence < 0.45) {
state = "READING";
phase = "IDLE";
} else if (absCenter > 28 || tiltMagnitude > 36) {
state = "OFF AXIS";
} else if (kneeFlex > 22 && wristFalling) {
state = "DROP";
} else if (absCenter > 14 || tiltMagnitude > 18 || wristRising || wristFalling) {
state = "SHIFT";
} else {
state = "LOCK";
}

return {
state,
phase,
shoulderTilt: round(shoulderTilt),
hipTilt: round(hipTilt),
elbowAngle: round(elbowAngle),
kneeFlex: round(kneeFlex),
centerOffset: round(centerOffset),
weightBias: round(weightBias),
forceAngle: round(forceAngle),
confidence: round(confidence * 100),
};
}

function getLockState(metrics: Metrics): LockState {
if (metrics.confidence < 40 || metrics.state === "READING") return "SEARCHING";
if (metrics.confidence < 70 || metrics.state === "SHIFT") return "ALIGNING";
return "AXIS LOCK";
}

function getLockColor(lockState: LockState) {
if (lockState === "SEARCHING") return "#ff666e";
if (lockState === "ALIGNING") return "#ffd15e";
return "#7ef2a0";
}

function drawGrid(
ctx: CanvasRenderingContext2D,
width: number,
height: number
) {
ctx.save();
ctx.strokeStyle = "rgba(110, 148, 255, 0.08)";
ctx.lineWidth = 1;

const gridSize = Math.max(34, Math.floor(width / 18));
for (let x = 0; x <= width; x += gridSize) {
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}

for (let y = 0; y <= height; y += gridSize) {
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}
ctx.restore();
}

function drawAxisField(
ctx: CanvasRenderingContext2D,
width: number,
height: number
) {
const cx = width / 2;
const cy = height / 2;

ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1.2;

ctx.beginPath();
ctx.moveTo(cx, 0);
ctx.lineTo(cx, height);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(0, cy);
ctx.lineTo(width, cy);
ctx.stroke();

ctx.restore();
}

function drawArrow(
ctx: CanvasRenderingContext2D,
fromX: number,
fromY: number,
toX: number,
toY: number,
color: string,
width = 4
) {
const headLength = 12;
const angle = Math.atan2(toY - fromY, toX - fromX);

ctx.save();
ctx.strokeStyle = color;
ctx.fillStyle = color;
ctx.lineWidth = width;
ctx.lineCap = "round";

ctx.beginPath();
ctx.moveTo(fromX, fromY);
ctx.lineTo(toX, toY);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(toX, toY);
ctx.lineTo(
toX - headLength * Math.cos(angle - Math.PI / 6),
toY - headLength * Math.sin(angle - Math.PI / 6)
);
ctx.lineTo(
toX - headLength * Math.cos(angle + Math.PI / 6),
toY - headLength * Math.sin(angle + Math.PI / 6)
);
ctx.closePath();
ctx.fill();
ctx.restore();
}

function drawLockHalo(
ctx: CanvasRenderingContext2D,
centerX: number,
centerY: number,
radius: number,
lockState: LockState
) {
const color = getLockColor(lockState);

ctx.save();
ctx.strokeStyle = color;
ctx.lineWidth = lockState === "AXIS LOCK" ? 4 : 3;
ctx.globalAlpha = lockState === "AXIS LOCK" ? 0.9 : 0.65;

ctx.beginPath();
ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
ctx.stroke();

ctx.strokeStyle = color;
ctx.globalAlpha = 0.2;
ctx.beginPath();
ctx.arc(centerX, centerY, radius + 18, 0, Math.PI * 2);
ctx.stroke();

ctx.restore();
}

function drawPose(
ctx: CanvasRenderingContext2D,
landmarks: Landmark[],
width: number,
height: number,
lockState: LockState
) {
ctx.save();

for (const [aIndex, bIndex] of POSE_CONNECTIONS) {
const a = landmarks[aIndex];
const b = landmarks[bIndex];
if (!a || !b) continue;
if ((a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3) continue;

const pa = toCanvasPoint(a, width, height);
const pb = toCanvasPoint(b, width, height);

ctx.beginPath();
ctx.strokeStyle = "rgba(214, 223, 255, 0.62)";
ctx.lineWidth = 3;
ctx.moveTo(pa.x, pa.y);
ctx.lineTo(pb.x, pb.y);
ctx.stroke();
}

landmarks.forEach((lm, index) => {
if ((lm.visibility ?? 1) < 0.3) return;
const p = toCanvasPoint(lm, width, height);

let fill = "rgba(255,255,255,0.88)";
if ([15, 16].includes(index)) fill = "#ff6a75";
if ([27, 28].includes(index)) fill = "#6ab0ff";
if ([23, 24].includes(index)) fill = "#ffd15e";

ctx.beginPath();
ctx.fillStyle = fill;
ctx.arc(p.x, p.y, 4.4, 0, Math.PI * 2);
ctx.fill();
});

const leftShoulder = landmarks[11];
const rightShoulder = landmarks[12];
const leftHip = landmarks[23];
const rightHip = landmarks[24];
const rightWrist = landmarks[16];
const leftAnkle = landmarks[27];
const rightAnkle = landmarks[28];

const shoulderMid = midpoint(leftShoulder, rightShoulder);
const hipMid = midpoint(leftHip, rightHip);
const ankleMid = midpoint(leftAnkle, rightAnkle);

const leftShoulderPoint = toCanvasPoint(leftShoulder, width, height);
const rightShoulderPoint = toCanvasPoint(rightShoulder, width, height);
const leftHipPoint = toCanvasPoint(leftHip, width, height);
const rightHipPoint = toCanvasPoint(rightHip, width, height);
const shoulderPoint = toCanvasPoint(shoulderMid, width, height);
const hipPoint = toCanvasPoint(hipMid, width, height);
const anklePoint = toCanvasPoint(ankleMid, width, height);
const wristPoint = toCanvasPoint(rightWrist, width, height);

const torsoLeft = Math.min(leftShoulderPoint.x, leftHipPoint.x) - 20;
const torsoRight = Math.max(rightShoulderPoint.x, rightHipPoint.x) + 20;
const torsoTop = Math.min(leftShoulderPoint.y, rightShoulderPoint.y) - 24;
const torsoBottom = Math.max(leftHipPoint.y, rightHipPoint.y) + 24;
const torsoWidth = torsoRight - torsoLeft;
const torsoHeight = torsoBottom - torsoTop;

ctx.beginPath();
ctx.strokeStyle = "rgba(255,255,255,0.18)";
ctx.lineWidth = 2;
ctx.roundRect(torsoLeft, torsoTop, torsoWidth, torsoHeight, 18);
ctx.stroke();

ctx.beginPath();
ctx.strokeStyle = "rgba(255,255,255,0.28)";
ctx.lineWidth = 2;
ctx.setLineDash([10, 8]);
ctx.moveTo(shoulderPoint.x, shoulderPoint.y - 24);
ctx.lineTo(anklePoint.x, anklePoint.y + 10);
ctx.stroke();
ctx.setLineDash([]);

drawArrow(
ctx,
anklePoint.x,
anklePoint.y,
hipPoint.x,
hipPoint.y - 42,
"rgba(255, 208, 84, 0.95)",
4
);

drawArrow(
ctx,
hipPoint.x,
hipPoint.y,
wristPoint.x,
wristPoint.y,
"rgba(84, 157, 255, 0.95)",
4
);

drawLockHalo(
ctx,
hipPoint.x,
(shoulderPoint.y + hipPoint.y) / 2,
Math.max(34, torsoWidth * 0.22),
lockState
);

ctx.beginPath();
ctx.fillStyle = "white";
ctx.arc(anklePoint.x, anklePoint.y, 6.5, 0, Math.PI * 2);
ctx.fill();

ctx.beginPath();
ctx.fillStyle = "#ff5e68";
ctx.arc(wristPoint.x, wristPoint.y, 6.5, 0, Math.PI * 2);
ctx.fill();

ctx.restore();
}

export default function AxisCameraInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const animationRef = useRef<number | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const poseRef = useRef<PoseLandmarkerLike | null>(null);
const lastVideoTimeRef = useRef<number>(-1);
const lastWristYRef = useRef<number | null>(null);

const [cameraOn, setCameraOn] = useState(false);
const [loading, setLoading] = useState(false);
const [status, setStatus] = useState("Camera idle");
const [error, setError] = useState<string | null>(null);
const [metrics, setMetrics] = useState<Metrics>({
state: "IDLE",
phase: "IDLE",
shoulderTilt: 0,
hipTilt: 0,
elbowAngle: 0,
kneeFlex: 0,
centerOffset: 0,
weightBias: 0,
forceAngle: 0,
confidence: 0,
});

const lockState = useMemo(() => getLockState(metrics), [metrics]);

const statusColor = useMemo(() => {
switch (metrics.state) {
case "LOCK":
return "#7ef2a0";
case "SHIFT":
return "#ffd15e";
case "DROP":
return "#ff9f59";
case "OFF AXIS":
return "#ff5e68";
case "READING":
return "#78b7ff";
default:
return "rgba(255,255,255,0.74)";
}
}, [metrics.state]);

const lockColor = useMemo(() => getLockColor(lockState), [lockState]);

const stopCamera = useCallback(() => {
if (animationRef.current) {
cancelAnimationFrame(animationRef.current);
animationRef.current = null;
}

if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}

if (videoRef.current) {
videoRef.current.pause();
videoRef.current.srcObject = null;
}

setCameraOn(false);
setStatus("Camera idle");
}, []);

useEffect(() => {
return () => {
stopCamera();
if (poseRef.current?.close) poseRef.current.close();
};
}, [stopCamera]);

const runFrame = useCallback(() => {
const video = videoRef.current;
const canvas = canvasRef.current;
const poseLandmarker = poseRef.current;

if (!video || !canvas || !poseLandmarker) {
animationRef.current = requestAnimationFrame(runFrame);
return;
}

const width = video.videoWidth || 1280;
const height = video.videoHeight || 720;

if (!width || !height) {
animationRef.current = requestAnimationFrame(runFrame);
return;
}

if (canvas.width !== width) canvas.width = width;
if (canvas.height !== height) canvas.height = height;

const ctx = canvas.getContext("2d");
if (!ctx) {
animationRef.current = requestAnimationFrame(runFrame);
return;
}

ctx.clearRect(0, 0, width, height);

drawGrid(ctx, width, height);
drawAxisField(ctx, width, height);

if (video.readyState >= 2) {
const now = performance.now();

if (lastVideoTimeRef.current !== video.currentTime) {
lastVideoTimeRef.current = video.currentTime;

try {
const result = poseLandmarker.detectForVideo(video, now);
const landmarks = result.landmarks?.[0] ?? null;

if (landmarks) {
const nextMetrics = detectMetrics(landmarks, lastWristYRef.current);
lastWristYRef.current = landmarks[16]?.y ?? null;
setMetrics(nextMetrics);
drawPose(ctx, landmarks, width, height, getLockState(nextMetrics));
setStatus("Live pose tracking");
} else {
setMetrics((current) => ({
...current,
state: "READING",
phase: "IDLE",
confidence: 0,
}));
setStatus("Reading subject");
}
} catch (err) {
console.error(err);
setError("Pose detection failed.");
setStatus("Detection error");
}
}
}

animationRef.current = requestAnimationFrame(runFrame);
}, []);

const startCamera = useCallback(async () => {
try {
setLoading(true);
setError(null);
setStatus("Loading camera");

const mediaStream = await navigator.mediaDevices.getUserMedia({
video: {
facingMode: "user",
width: { ideal: 1280 },
height: { ideal: 720 },
},
audio: false,
});

streamRef.current = mediaStream;

const video = videoRef.current;
if (!video) throw new Error("Video element not ready.");

video.srcObject = mediaStream;
video.muted = true;
video.playsInline = true;

await video.play();

setStatus("Loading pose model");

const vision = await import("@mediapipe/tasks-vision");

if (!poseRef.current) {
const filesetResolver = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
poseRef.current = (await vision.PoseLandmarker.createFromOptions(
filesetResolver,
{
baseOptions: {
modelAssetPath: MODEL_PATH,
},
runningMode: "VIDEO",
numPoses: 1,
minPoseDetectionConfidence: 0.5,
minPosePresenceConfidence: 0.5,
minTrackingConfidence: 0.5,
outputSegmentationMasks: false,
}
)) as PoseLandmarkerLike;
} else {
await poseRef.current.setOptions({ runningMode: "VIDEO" });
}

setCameraOn(true);
setStatus("Live pose tracking");
animationRef.current = requestAnimationFrame(runFrame);
} catch (err) {
console.error(err);
setError(
"Unable to start camera or pose model. Confirm camera permission is allowed and the model file exists at /public/models/pose_landmarker_full.task."
);
setStatus("Start failed");
stopCamera();
} finally {
setLoading(false);
}
}, [runFrame, stopCamera]);

return (
<main className="axis-camera-shell">
<div className="axis-camera-frame">
<header className="axis-camera-topbar">
<div className="axis-pill">
<span className="axis-pill-label">State</span>
<span className="axis-pill-value" style={{ color: statusColor }}>
{metrics.state}
</span>
</div>

<div className="axis-pill">
<span className="axis-pill-label">Phase</span>
<span className="axis-pill-value">{metrics.phase}</span>
</div>

<div className="axis-pill">
<span className="axis-pill-label">Reading</span>
<span className="axis-pill-value">Camera</span>
</div>

<div className="axis-pill">
<span className="axis-pill-label">Confidence</span>
<span className="axis-pill-value">{metrics.confidence}%</span>
</div>
</header>

<section className="axis-camera-main">
<div className="axis-camera-stage">
<video ref={videoRef} className="axis-video" />
<canvas ref={canvasRef} className="axis-canvas" />

{!cameraOn && (
<div className="axis-stage-overlay">
<div className="axis-stage-card">
<div className="axis-kicker">Axis Camera</div>
<h1>Pose + phase + state</h1>
<p>
Live camera feed with skeleton overlay, centerline, torso
lock field, force vectors, phase detection, and Axis state
output.
</p>

<div className="axis-actions">
<button
type="button"
onClick={startCamera}
disabled={loading}
className="axis-primary-btn"
>
{loading ? "Starting…" : "Enable Camera"}
</button>
</div>

<div className="axis-hint">
Needs: <code>/public/models/pose_landmarker_full.task</code>
</div>
</div>
</div>
)}

<div className="axis-stage-top-left">
<div className="axis-stage-label">Axis Field</div>
</div>

<div className="axis-stage-bottom-left">
<div className="axis-live-dot" />
<span>{status}</span>
</div>

<div className="axis-lock-hud" style={{ borderColor: `${lockColor}55` }}>
<div
className="axis-lock-dot"
style={{ background: lockColor, boxShadow: `0 0 20px ${lockColor}` }}
/>
<div className="axis-lock-copy">
<div className="axis-lock-label">Lock</div>
<div className="axis-lock-value" style={{ color: lockColor }}>
{lockState}
</div>
</div>
</div>
</div>

<aside className="axis-sidepanel">
<div className="axis-panel-card">
<div className="axis-panel-label">Axis Read</div>
<div className="axis-big-state" style={{ color: statusColor }}>
{metrics.state}
</div>
<div className="axis-phase-line">{metrics.phase}</div>
</div>

<div className="axis-panel-card">
<div className="axis-panel-label">Lock State</div>
<div className="axis-lock-card-row">
<div
className="axis-lock-card-dot"
style={{
background: lockColor,
boxShadow: `0 0 20px ${lockColor}`,
}}
/>
<div>
<div className="axis-lock-card-value" style={{ color: lockColor }}>
{lockState}
</div>
<div className="axis-lock-card-sub">
{lockState === "SEARCHING"
? "subject reacquire"
: lockState === "ALIGNING"
? "body stabilizing"
: "stable center hold"}
</div>
</div>
</div>
</div>

<div className="axis-panel-card">
<div className="axis-panel-label">Biomech</div>
<div className="axis-metric-grid">
<Metric label="Shoulder Tilt" value={`${metrics.shoulderTilt}°`} />
<Metric label="Hip Tilt" value={`${metrics.hipTilt}°`} />
<Metric label="Elbow Angle" value={`${metrics.elbowAngle}°`} />
<Metric label="Knee Flex" value={`${metrics.kneeFlex}°`} />
<Metric label="Center Offset" value={`${metrics.centerOffset}%`} />
<Metric label="Weight Bias" value={`${metrics.weightBias}%`} />
<Metric label="Force Angle" value={`${metrics.forceAngle}°`} />
<Metric label="Confidence" value={`${metrics.confidence}%`} />
</div>
</div>

<div className="axis-panel-card">
<div className="axis-panel-label">Axis Logic</div>
<ul className="axis-logic-list">
<li>
<span>LOCK</span>
<strong>stable and centered</strong>
</li>
<li>
<span>SHIFT</span>
<strong>alignment moving</strong>
</li>
<li>
<span>DROP</span>
<strong>load or structure loss</strong>
</li>
<li>
<span>OFF AXIS</span>
<strong>tilt or drift too large</strong>
</li>
<li>
<span>READING</span>
<strong>subject reacquire / low confidence</strong>
</li>
</ul>
</div>

<div className="axis-panel-card">
<div className="axis-panel-label">Controls</div>
<div className="axis-actions axis-actions-column">
<button
type="button"
onClick={startCamera}
disabled={loading}
className="axis-secondary-btn"
>
{cameraOn ? "Restart Camera" : "Start Camera"}
</button>
<button
type="button"
onClick={stopCamera}
className="axis-secondary-btn"
>
Stop Camera
</button>
</div>
{error && <div className="axis-error">{error}</div>}
</div>
</aside>
</section>
</div>

<style jsx>{`
.axis-camera-shell {
min-height: 100vh;
background:
radial-gradient(circle at 50% 24%, rgba(17, 34, 62, 0.82), transparent 28%),
linear-gradient(180deg, #020407 0%, #05070c 38%, #020306 100%);
color: #f4f7ff;
padding:
max(16px, env(safe-area-inset-top))
16px
max(24px, env(safe-area-inset-bottom));
}

.axis-camera-frame {
width: min(1440px, 100%);
margin: 0 auto;
display: grid;
gap: 14px;
}

.axis-camera-topbar {
display: grid;
grid-template-columns: repeat(4, minmax(0, 1fr));
gap: 12px;
}

.axis-pill {
border: 1px solid rgba(255, 255, 255, 0.12);
border-radius: 18px;
padding: 12px 14px;
background: linear-gradient(
180deg,
rgba(255, 255, 255, 0.05),
rgba(255, 255, 255, 0.02)
);
backdrop-filter: blur(10px);
}

.axis-pill-label {
display: block;
font-size: 11px;
letter-spacing: 0.22em;
text-transform: uppercase;
opacity: 0.64;
margin-bottom: 6px;
}

.axis-pill-value {
font-size: clamp(1rem, 2vw, 1.45rem);
font-weight: 700;
letter-spacing: 0.04em;
}

.axis-camera-main {
display: grid;
grid-template-columns: minmax(0, 1.7fr) minmax(320px, 420px);
gap: 14px;
min-height: 78vh;
}

.axis-camera-stage,
.axis-sidepanel {
border: 1px solid rgba(255, 255, 255, 0.12);
border-radius: 28px;
overflow: hidden;
background: rgba(255, 255, 255, 0.03);
backdrop-filter: blur(12px);
}

.axis-camera-stage {
position: relative;
min-height: 760px;
background:
radial-gradient(circle at center, rgba(20, 30, 56, 0.28), transparent 42%),
linear-gradient(180deg, rgba(6, 10, 16, 0.98), rgba(3, 5, 8, 0.99));
}

.axis-video,
.axis-canvas {
position: absolute;
inset: 0;
width: 100%;
height: 100%;
object-fit: cover;
transform: scaleX(-1);
}

.axis-video {
opacity: 0.34;
filter: saturate(0.8) contrast(1.06) brightness(0.8);
}

.axis-canvas {
z-index: 2;
}

.axis-stage-overlay {
position: absolute;
inset: 0;
z-index: 4;
display: grid;
place-items: center;
background: linear-gradient(
180deg,
rgba(4, 8, 15, 0.44),
rgba(4, 8, 15, 0.72)
);
padding: 24px;
}

.axis-stage-card {
width: min(520px, 100%);
border: 1px solid rgba(255, 255, 255, 0.12);
border-radius: 24px;
padding: 24px;
background: rgba(7, 10, 16, 0.82);
box-shadow: 0 20px 80px rgba(0, 0, 0, 0.35);
}

.axis-kicker {
font-size: 12px;
letter-spacing: 0.28em;
text-transform: uppercase;
opacity: 0.68;
margin-bottom: 10px;
}

.axis-stage-card h1 {
margin: 0 0 10px;
font-size: clamp(1.8rem, 4vw, 3rem);
line-height: 0.95;
letter-spacing: -0.04em;
}

.axis-stage-card p {
margin: 0;
color: rgba(244, 247, 255, 0.78);
line-height: 1.6;
}

.axis-stage-top-left {
position: absolute;
top: 16px;
left: 16px;
z-index: 5;
}

.axis-stage-label {
padding: 9px 12px;
border-radius: 999px;
border: 1px solid rgba(255, 255, 255, 0.12);
background: rgba(0, 0, 0, 0.32);
font-size: 11px;
letter-spacing: 0.22em;
text-transform: uppercase;
opacity: 0.82;
}

.axis-stage-bottom-left {
position: absolute;
left: 16px;
bottom: 16px;
z-index: 5;
display: inline-flex;
align-items: center;
gap: 10px;
padding: 9px 12px;
border-radius: 999px;
border: 1px solid rgba(255, 255, 255, 0.12);
background: rgba(0, 0, 0, 0.38);
font-size: 12px;
letter-spacing: 0.14em;
text-transform: uppercase;
}

.axis-live-dot {
width: 10px;
height: 10px;
border-radius: 999px;
background: #ff5e68;
box-shadow: 0 0 18px rgba(255, 94, 104, 0.6);
}

.axis-lock-hud {
position: absolute;
right: 16px;
top: 16px;
z-index: 5;
display: flex;
align-items: center;
gap: 12px;
padding: 12px 14px;
border-radius: 18px;
border: 1px solid rgba(255, 255, 255, 0.12);
background: rgba(0, 0, 0, 0.34);
min-width: 190px;
}

.axis-lock-dot {
width: 14px;
height: 14px;
border-radius: 999px;
flex: 0 0 auto;
}

.axis-lock-copy {
display: grid;
gap: 2px;
}

.axis-lock-label {
font-size: 10px;
letter-spacing: 0.22em;
text-transform: uppercase;
opacity: 0.62;
}

.axis-lock-value {
font-size: 1rem;
font-weight: 800;
letter-spacing: 0.08em;
text-transform: uppercase;
}

.axis-sidepanel {
display: grid;
gap: 12px;
padding: 12px;
align-content: start;
}

.axis-panel-card {
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 22px;
padding: 16px;
background: linear-gradient(
180deg,
rgba(255, 255, 255, 0.04),
rgba(255, 255, 255, 0.015)
);
}

.axis-panel-label {
font-size: 11px;
letter-spacing: 0.22em;
text-transform: uppercase;
opacity: 0.64;
margin-bottom: 10px;
}

.axis-big-state {
font-size: clamp(1.6rem, 3vw, 2.4rem);
font-weight: 800;
letter-spacing: 0.06em;
}

.axis-phase-line {
margin-top: 6px;
font-size: 0.95rem;
opacity: 0.8;
letter-spacing: 0.2em;
text-transform: uppercase;
}

.axis-lock-card-row {
display: flex;
align-items: center;
gap: 12px;
}

.axis-lock-card-dot {
width: 18px;
height: 18px;
border-radius: 999px;
flex: 0 0 auto;
}

.axis-lock-card-value {
font-weight: 800;
letter-spacing: 0.08em;
text-transform: uppercase;
}

.axis-lock-card-sub {
margin-top: 4px;
font-size: 0.88rem;
color: rgba(244, 247, 255, 0.64);
}

.axis-metric-grid {
display: grid;
grid-template-columns: repeat(2, minmax(0, 1fr));
gap: 10px;
}

.axis-logic-list {
list-style: none;
margin: 0;
padding: 0;
display: grid;
gap: 10px;
}

.axis-logic-list li {
display: flex;
justify-content: space-between;
gap: 10px;
font-size: 0.92rem;
}

.axis-logic-list span {
letter-spacing: 0.14em;
text-transform: uppercase;
opacity: 0.85;
}

.axis-logic-list strong {
color: rgba(244, 247, 255, 0.72);
font-weight: 600;
text-align: right;
}

.axis-actions {
display: flex;
gap: 10px;
margin-top: 16px;
flex-wrap: wrap;
}

.axis-actions-column {
flex-direction: column;
}

.axis-primary-btn,
.axis-secondary-btn {
border: 1px solid rgba(255, 255, 255, 0.12);
border-radius: 16px;
padding: 12px 16px;
background: linear-gradient(
180deg,
rgba(24, 34, 54, 0.96),
rgba(10, 16, 26, 0.96)
);
color: #f4f7ff;
cursor: pointer;
font-size: 0.95rem;
letter-spacing: 0.08em;
text-transform: uppercase;
}

.axis-primary-btn {
background: linear-gradient(
180deg,
rgba(104, 158, 255, 0.95),
rgba(47, 95, 190, 0.95)
);
color: white;
}

.axis-primary-btn:disabled,
.axis-secondary-btn:disabled {
opacity: 0.55;
cursor: not-allowed;
}

.axis-hint {
margin-top: 14px;
font-size: 0.85rem;
color: rgba(244, 247, 255, 0.64);
}

.axis-hint code {
color: #9dc3ff;
}

.axis-error {
margin-top: 12px;
color: #ff858d;
font-size: 0.88rem;
line-height: 1.5;
}

@media (max-width: 1120px) {
.axis-camera-main {
grid-template-columns: 1fr;
}

.axis-camera-stage {
min-height: 68vh;
}
}

@media (max-width: 720px) {
.axis-camera-topbar {
grid-template-columns: repeat(2, minmax(0, 1fr));
}

.axis-camera-shell {
padding:
max(12px, env(safe-area-inset-top))
12px
max(20px, env(safe-area-inset-bottom));
}

.axis-camera-stage {
min-height: 62vh;
}

.axis-metric-grid {
grid-template-columns: 1fr 1fr;
}

.axis-lock-hud {
min-width: 0;
right: 12px;
top: 12px;
padding: 10px 12px;
}
}
`}</style>
</main>
);
}

function Metric({ label, value }: { label: string; value: string }) {
return (
<div
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 16,
padding: "10px 12px",
background: "rgba(255,255,255,0.02)",
}}
>
<div
style={{
fontSize: 10,
letterSpacing: "0.2em",
textTransform: "uppercase",
opacity: 0.58,
marginBottom: 6,
}}
>
{label}
</div>
<div
style={{
fontSize: "1.02rem",
fontWeight: 700,
letterSpacing: "0.04em",
}}
>
{value}
</div>
</div>
);
}