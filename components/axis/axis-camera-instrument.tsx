"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import * as posedetection from "@tensorflow-models/pose-detection";

type AxisState =
| "NO_SUBJECT"
| "LOCKING"
| "SET"
| "RISE"
| "RELEASE"
| "LAND"
| "ALIGNED"
| "SHIFT"
| "DROP"
| "LOST";

type ShotPhase = "IDLE" | "SET" | "RISE" | "RELEASE" | "LAND";
type CameraFacing = "user" | "environment";

type CameraOption = {
deviceId: string;
label: string;
};

type JointPoint = {
x: number;
y: number;
score: number;
};

type PoseMetrics = {
ready: boolean;
state: AxisState;
phase: ShotPhase;
confidence: number;
confidenceSignal: number;
stability: number;
lockStrength: number;
detectionStrength: number;
verticalStack: number;
torsoLean: number;
hipOverBase: number;
shoulderLevel: number;
frameCoverage: number;
subjectCentered: number;
signal: number[];
shotCandidate: number;
releaseStability: number;
};

type RepRecord = {
id: string;
startedAt: number;
endedAt: number;
peakState: AxisState;
phase: ShotPhase;
avgStability: number;
avgDetection: number;
releaseStability: number;
notes: string;
made?: boolean;
source: "auto" | "manual";
clipUrl?: string;
};

type EngineStatus = "idle" | "loading" | "ready" | "error";

type EngineError = {
title: string;
detail: string;
};

type PendingClipMeta = {
source: "auto" | "manual";
startedAt: number;
endedAt: number;
phase: ShotPhase;
peakState: AxisState;
avgStability: number;
avgDetection: number;
releaseStability: number;
notes: string;
made?: boolean;
};

const KEYPOINT_MIN_SCORE = 0.2;
const SIGNAL_BUFFER = 120;
const ANALYSIS_INTERVAL_MS = 80;
const VIDEO_W = 1280;
const VIDEO_H = 720;
const ENGINE_RETRY_LIMIT = 2;

const AUTO_PRE_ROLL_MS = 1400;
const AUTO_POST_ROLL_MS = 1400;
const DEFAULT_MANUAL_CLIP_MS = 3000;

const STATE_COLOR: Record<AxisState, string> = {
NO_SUBJECT: "#8C8C8C",
LOCKING: "#7BD7FF",
SET: "#5AC8FA",
RISE: "#9BDB4D",
RELEASE: "#46E17D",
LAND: "#FFD54A",
ALIGNED: "#46E17D",
SHIFT: "#FFD54A",
DROP: "#FF9D42",
LOST: "#FF5757",
};

const STATE_LABEL: Record<AxisState, string> = {
NO_SUBJECT: "NO SUBJECT",
LOCKING: "LOCKING",
SET: "SET",
RISE: "RISE",
RELEASE: "RELEASE",
LAND: "LAND",
ALIGNED: "ALIGNED",
SHIFT: "SHIFT",
DROP: "DROP",
LOST: "LOST",
};

const INITIAL_METRICS: PoseMetrics = {
ready: false,
state: "NO_SUBJECT",
phase: "IDLE",
confidence: 0,
confidenceSignal: 0,
stability: 10,
lockStrength: 0,
detectionStrength: 0,
verticalStack: 0,
torsoLean: 1,
hipOverBase: 1,
shoulderLevel: 1,
frameCoverage: 0,
subjectCentered: 0,
signal: [],
shotCandidate: 0,
releaseStability: 0,
};

function clamp(value: number, min: number, max: number): number {
return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
if (!values.length) return 0;
return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function smoothstep(value: number, edge0: number, edge1: number): number {
const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
return t * t * (3 - 2 * t);
}

function nowId(): string {
return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPoint(pose: posedetection.Pose, name: string): JointPoint | null {
const kp = pose.keypoints.find((point) => point.name === name);
if (!kp) return null;
const score = kp.score ?? 0;
if (score < KEYPOINT_MIN_SCORE) return null;
return { x: kp.x, y: kp.y, score };
}

function midpoint(a: JointPoint | null, b: JointPoint | null): JointPoint | null {
if (!a || !b) return null;
return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
score: Math.min(a.score, b.score),
};
}

function distance(a: JointPoint | null, b: JointPoint | null): number {
if (!a || !b) return 0;
return Math.hypot(a.x - b.x, a.y - b.y);
}

function getBaseScale(pose: posedetection.Pose): number {
const ls = getPoint(pose, "left_shoulder");
const rs = getPoint(pose, "right_shoulder");
const lh = getPoint(pose, "left_hip");
const rh = getPoint(pose, "right_hip");
const la = getPoint(pose, "left_ankle");
const ra = getPoint(pose, "right_ankle");

const shoulderWidth = distance(ls, rs);
const hipWidth = distance(lh, rh);
const ankleWidth = distance(la, ra);
const torsoHeight = distance(midpoint(ls, rs), midpoint(lh, rh));

return Math.max(shoulderWidth, hipWidth, ankleWidth * 0.8, torsoHeight * 0.7, 48);
}

function getBodyCoverage(pose: posedetection.Pose, width: number, height: number): number {
const visible = pose.keypoints.filter((kp) => (kp.score ?? 0) >= KEYPOINT_MIN_SCORE);
if (!visible.length) return 0;

const xs = visible.map((p) => p.x);
const ys = visible.map((p) => p.y);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);

const boxArea = Math.max(1, (maxX - minX) * (maxY - minY));
return clamp(boxArea / Math.max(1, width * height), 0, 1);
}

function getSubjectCentered(pose: posedetection.Pose, width: number): number {
const ls = getPoint(pose, "left_shoulder");
const rs = getPoint(pose, "right_shoulder");
const lh = getPoint(pose, "left_hip");
const rh = getPoint(pose, "right_hip");
const center = midpoint(midpoint(ls, rs), midpoint(lh, rh));
if (!center || !width) return 0;
const offset = Math.abs(center.x - width / 2) / (width / 2);
return clamp(1 - offset, 0, 1);
}

function getDetectionSignal(confidence: number, coverage: number, centered: number): number {
const raw = confidence * 0.48 + coverage * 0.34 + centered * 0.18;
return Math.round(clamp(raw * 100, 0, 100));
}

function drawLine(
ctx: CanvasRenderingContext2D,
a: JointPoint | null,
b: JointPoint | null,
color: string,
width = 4,
) {
if (!a || !b) return;
ctx.beginPath();
ctx.moveTo(a.x, a.y);
ctx.lineTo(b.x, b.y);
ctx.strokeStyle = color;
ctx.lineWidth = width;
ctx.lineCap = "round";
ctx.stroke();
}

function drawCircle(
ctx: CanvasRenderingContext2D,
p: JointPoint | null,
radius: number,
color: string,
) {
if (!p) return;
ctx.beginPath();
ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
ctx.fillStyle = color;
ctx.fill();
}

function getPreferredBackCamera(cameras: CameraOption[]): CameraOption | null {
if (!cameras.length) return null;
const back = cameras.find((camera) => /back|rear|environment/i.test(camera.label));
return back ?? cameras[cameras.length - 1] ?? null;
}

function getPreferredFrontCamera(cameras: CameraOption[]): CameraOption | null {
if (!cameras.length) return null;
const front = cameras.find((camera) =>
/front|user|facetime|webcam|integrated/i.test(camera.label),
);
return front ?? cameras[0] ?? null;
}

async function safeStopStream(stream: MediaStream | null) {
stream?.getTracks().forEach((track) => track.stop());
}

function getRepNote(rep: {
avgDetection: number;
phase: ShotPhase;
releaseStability: number;
peakState: AxisState;
source: "auto" | "manual";
}): string {
if (rep.source === "manual") return "Manual clip saved.";
if (rep.avgDetection < 36) return "Weak subject read. Improve framing.";
if (rep.phase === "RELEASE" && rep.releaseStability >= 78) return "Stable release window.";
if (rep.phase === "RISE") return "Good rise. Release not confirmed.";
if (rep.peakState === "SHIFT") return "Slight drift through the shot.";
if (rep.peakState === "DROP") return "Structure dropped during shot.";
if (rep.peakState === "LOST") return "Structure broke outside base.";
return "Signal captured.";
}

function analyzePose(
pose: posedetection.Pose,
videoWidth: number,
videoHeight: number,
priorSignal: number[],
prevPhase: ShotPhase,
prevChestY: number | null,
): PoseMetrics {
const nose = getPoint(pose, "nose");
const ls = getPoint(pose, "left_shoulder");
const rs = getPoint(pose, "right_shoulder");
const le = getPoint(pose, "left_elbow");
const re = getPoint(pose, "right_elbow");
const lw = getPoint(pose, "left_wrist");
const rw = getPoint(pose, "right_wrist");
const lh = getPoint(pose, "left_hip");
const rh = getPoint(pose, "right_hip");
const lk = getPoint(pose, "left_knee");
const rk = getPoint(pose, "right_knee");
const la = getPoint(pose, "left_ankle");
const ra = getPoint(pose, "right_ankle");

const shoulderMid = midpoint(ls, rs);
const hipMid = midpoint(lh, rh);
const ankleMid = midpoint(la, ra);
const wristMid = midpoint(lw, rw);
const elbowMid = midpoint(le, re);
const kneeMid = midpoint(lk, rk);

const frameCoverage = getBodyCoverage(pose, videoWidth, videoHeight);
const subjectCentered = getSubjectCentered(pose, videoWidth);

const pointScores = pose.keypoints
.map((kp) => kp.score ?? 0)
.filter((score) => score > 0);

const confidence = clamp(mean(pointScores), 0, 1);
const confidenceSignal = Math.round(confidence * 100);
const detectionStrength = getDetectionSignal(confidence, frameCoverage, subjectCentered);

if (!shoulderMid || !hipMid || (!la && !ra)) {
const signalValue = Math.max(8, Math.round(detectionStrength * 0.5));
const nextSignal = [...priorSignal, signalValue].slice(-SIGNAL_BUFFER);
return {
ready: false,
state: detectionStrength >= 28 ? "LOCKING" : "NO_SUBJECT",
phase: "IDLE",
confidence,
confidenceSignal,
stability: 10,
lockStrength: detectionStrength,
detectionStrength,
verticalStack: 0,
torsoLean: 1,
hipOverBase: 1,
shoulderLevel: 1,
frameCoverage,
subjectCentered,
signal: nextSignal,
shotCandidate: 0,
releaseStability: 0,
};
}

const baseScale = getBaseScale(pose);
const headX = nose?.x ?? shoulderMid.x;
const chestX = shoulderMid.x;
const hipX = hipMid.x;
const baseX = ankleMid?.x ?? hipMid.x;

const verticalStackRaw =
(Math.abs(headX - chestX) + Math.abs(chestX - hipX)) / Math.max(baseScale, 1);
const verticalStack = clamp(1 - verticalStackRaw / 0.5, 0, 1);

const torsoLeanRaw = Math.abs(chestX - hipX) / Math.max(baseScale, 1);
const torsoLean = clamp(1 - torsoLeanRaw / 0.38, 0, 1);

const ankleSpread = Math.max(distance(la, ra), baseScale * 0.75);
const hipOverBaseRaw = Math.abs(hipX - baseX) / Math.max(ankleSpread * 0.75, 1);
const hipOverBase = clamp(1 - hipOverBaseRaw / 0.92, 0, 1);

const shoulderLevelRaw = ls && rs ? Math.abs(ls.y - rs.y) / Math.max(baseScale, 1) : 0;
const shoulderLevel = clamp(1 - shoulderLevelRaw / 0.32, 0, 1);

const coverageScore = clamp(smoothstep(frameCoverage, 0.08, 0.34), 0, 1);
const centeredScore = clamp(smoothstep(subjectCentered, 0.35, 0.9), 0, 1);

const lockStrength = Math.round(
clamp(confidence * 42 + coverageScore * 32 + centeredScore * 26, 0, 100),
);

const rawStability =
verticalStack * 0.32 +
torsoLean * 0.24 +
hipOverBase * 0.24 +
shoulderLevel * 0.08 +
coverageScore * 0.08 +
centeredScore * 0.04;

const stability = Math.round(clamp(rawStability * 100, 0, 100));

const wristAboveChest = wristMid
? clamp((shoulderMid.y - wristMid.y) / Math.max(baseScale, 1), 0, 1)
: 0;
const wristNearFace =
wristMid && nose
? clamp((nose.y - wristMid.y + baseScale * 0.35) / Math.max(baseScale, 1), 0, 1)
: 0;
const elbowLift = elbowMid
? clamp((shoulderMid.y - elbowMid.y + baseScale * 0.25) / Math.max(baseScale, 1), 0, 1)
: 0;
const kneeBend = kneeMid
? clamp((kneeMid.y - hipMid.y) / Math.max(baseScale * 1.3, 1), 0, 1)
: 0.35;
const chestRise =
prevChestY !== null
? clamp((prevChestY - shoulderMid.y) / Math.max(baseScale * 0.55, 1), -1, 1)
: 0;
const riseSignal = clamp(chestRise + wristAboveChest * 0.6 + elbowLift * 0.4, 0, 1);

const shotCandidate = Math.round(
clamp(
wristAboveChest * 34 +
wristNearFace * 18 +
elbowLift * 14 +
kneeBend * 12 +
lockStrength * 0.22,
0,
100,
),
);

let phase: ShotPhase = "IDLE";
if (lockStrength < 46) {
phase = "IDLE";
} else if (shotCandidate >= 38 && wristAboveChest < 0.2 && kneeBend > 0.18) {
phase = "SET";
} else if (shotCandidate >= 48 && riseSignal > 0.2 && wristAboveChest < 0.45) {
phase = "RISE";
} else if (shotCandidate >= 56 && wristAboveChest >= 0.45 && wristNearFace >= 0.25) {
phase = "RELEASE";
} else if (prevPhase === "RELEASE" && wristAboveChest < 0.25) {
phase = "LAND";
} else if (prevPhase === "RISE" && shotCandidate >= 46) {
phase = "RISE";
} else if (prevPhase === "SET" && shotCandidate >= 34) {
phase = "SET";
}

let state: AxisState = "NO_SUBJECT";
if (lockStrength < 30) state = "NO_SUBJECT";
else if (lockStrength < 58) state = "LOCKING";
else if (phase === "SET") state = "SET";
else if (phase === "RISE") state = "RISE";
else if (phase === "RELEASE") state = "RELEASE";
else if (phase === "LAND") state = "LAND";
else if (stability >= 78) state = "ALIGNED";
else if (stability >= 58) state = "SHIFT";
else if (stability >= 38) state = "DROP";
else state = "LOST";

const releaseStability = phase === "RELEASE" ? stability : 0;
const signalValue =
phase === "RELEASE" || phase === "RISE"
? Math.max(stability, lockStrength)
: state === "NO_SUBJECT"
? lockStrength
: stability;

const nextSignal = [...priorSignal, Math.max(8, signalValue)].slice(-SIGNAL_BUFFER);

return {
ready: true,
state,
phase,
confidence,
confidenceSignal,
stability,
lockStrength,
detectionStrength,
verticalStack,
torsoLean,
hipOverBase,
shoulderLevel,
frameCoverage,
subjectCentered,
signal: nextSignal,
shotCandidate,
releaseStability,
};
}

function pickRecorderMimeType(): string {
const options = [
"video/webm;codecs=vp9,opus",
"video/webm;codecs=vp8,opus",
"video/webm;codecs=h264,opus",
"video/webm",
"video/mp4",
];

for (const type of options) {
if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
return type;
}
}

return "";
}

export default function AxisCameraInstrument() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayRef = useRef<HTMLCanvasElement | null>(null);
const detectorRef = useRef<posedetection.PoseDetector | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const loopRef = useRef<number | null>(null);
const lastAnalysisRef = useRef(0);
const signalRef = useRef<number[]>([]);
const prevPhaseRef = useRef<ShotPhase>("IDLE");
const prevChestYRef = useRef<number | null>(null);
const engineBootedRef = useRef(false);

const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const mediaChunksRef = useRef<Blob[]>([]);
const pendingClipMetaRef = useRef<PendingClipMeta | null>(null);
const manualClipStopTimeoutRef = useRef<number | null>(null);

const [engineStatus, setEngineStatus] = useState<EngineStatus>("idle");
const [engineError, setEngineError] = useState<EngineError | null>(null);
const [enabled, setEnabled] = useState(false);
const [startingCamera, setStartingCamera] = useState(false);
const [switchingCamera, setSwitchingCamera] = useState(false);
const [facingMode, setFacingMode] = useState<CameraFacing>("user");
const [cameraOptions, setCameraOptions] = useState<CameraOption[]>([]);
const [activeCameraId, setActiveCameraId] = useState<string>("");
const [metrics, setMetrics] = useState<PoseMetrics>(INITIAL_METRICS);
const [isRecording, setIsRecording] = useState(false);
const [isSavingClip, setIsSavingClip] = useState(false);
const [isManualClipActive, setIsManualClipActive] = useState(false);
const [reps, setReps] = useState<RepRecord[]>([]);
const [lastClipUrl, setLastClipUrl] = useState("");
const [lastClipMade, setLastClipMade] = useState<boolean | undefined>(undefined);
const [lockPulse, setLockPulse] = useState(0);
const [manualClipMs, setManualClipMs] = useState(DEFAULT_MANUAL_CLIP_MS);

const destroyDetector = useCallback(async () => {
if (detectorRef.current) {
await detectorRef.current.dispose();
detectorRef.current = null;
}
}, []);

const initDetector = useCallback(async () => {
setEngineStatus("loading");
setEngineError(null);

try {
await tf.ready();
const currentBackend = tf.getBackend();

if (currentBackend !== "webgl") {
await tf.setBackend("webgl");
await tf.ready();
}

await destroyDetector();

let detector: posedetection.PoseDetector | null = null;
let lastError: unknown = null;

for (let attempt = 0; attempt <= ENGINE_RETRY_LIMIT; attempt += 1) {
try {
detector = await posedetection.createDetector(
posedetection.SupportedModels.MoveNet,
{
modelType: posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
enableSmoothing: true,
},
);
break;
} catch (error) {
lastError = error;
await new Promise((resolve) => setTimeout(resolve, 250));
}
}

if (!detector) {
throw lastError ?? new Error("Detector failed to initialize");
}

detectorRef.current = detector;
setEngineStatus("ready");
engineBootedRef.current = true;
return detector;
} catch (error) {
console.error(error);
setEngineStatus("error");
setEngineError({
title: "Instrument unavailable",
detail: "Pose engine did not initialize. Retry engine or restart camera.",
});
return null;
}
}, [destroyDetector]);

const loadCameraOptions = useCallback(async () => {
try {
const devices = await navigator.mediaDevices.enumerateDevices();
const cameras = devices
.filter((device) => device.kind === "videoinput")
.map((device) => ({
deviceId: device.deviceId,
label: device.label || `Camera ${device.deviceId.slice(-4)}`,
}));
setCameraOptions(cameras);
return cameras;
} catch (error) {
console.error(error);
return [] as CameraOption[];
}
}, []);

const stopLoop = useCallback(() => {
if (loopRef.current) {
cancelAnimationFrame(loopRef.current);
loopRef.current = null;
}
}, []);

const finalizePendingClip = useCallback(
(clipUrl: string) => {
const meta = pendingClipMetaRef.current;
if (!meta) return;

const rep: RepRecord = {
id: nowId(),
startedAt: meta.startedAt,
endedAt: meta.endedAt,
peakState: meta.peakState,
phase: meta.phase,
avgStability: meta.avgStability,
avgDetection: meta.avgDetection,
releaseStability: meta.releaseStability,
notes: meta.notes,
made: meta.made,
source: meta.source,
clipUrl,
};

setReps((prev) => [rep, ...prev].slice(0, 8));
pendingClipMetaRef.current = null;
},
[],
);

const stopRecording = useCallback(async () => {
if (manualClipStopTimeoutRef.current) {
window.clearTimeout(manualClipStopTimeoutRef.current);
manualClipStopTimeoutRef.current = null;
}

if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
mediaRecorderRef.current.stop();
setIsRecording(false);
setIsManualClipActive(false);
return;
}

setIsRecording(false);
setIsManualClipActive(false);
setIsSavingClip(false);
}, []);

const stopCamera = useCallback(async () => {
stopLoop();
await stopRecording();
await safeStopStream(streamRef.current);
streamRef.current = null;

const video = videoRef.current;
if (video) {
video.pause();
video.srcObject = null;
}

setEnabled(false);
}, [stopLoop, stopRecording]);

const startCamera = useCallback(
async (options?: { preferredFacing?: CameraFacing; preferredDeviceId?: string }) => {
setStartingCamera(true);
setEngineError(null);

let detector = detectorRef.current;
if (!detector) {
detector = await initDetector();
}
if (!detector) {
setStartingCamera(false);
return;
}

await stopCamera();

try {
const preferredFacing = options?.preferredFacing ?? facingMode;
let cameras = cameraOptions;
if (!cameras.length) cameras = await loadCameraOptions();

let chosenDeviceId = options?.preferredDeviceId ?? "";
if (!chosenDeviceId) {
const preferredCamera =
preferredFacing === "environment"
? getPreferredBackCamera(cameras)
: getPreferredFrontCamera(cameras);
chosenDeviceId = preferredCamera?.deviceId ?? "";
}

let stream: MediaStream;
try {
const constraints: MediaStreamConstraints = {
audio: false,
video: chosenDeviceId
? {
deviceId: { exact: chosenDeviceId },
width: { ideal: VIDEO_W },
height: { ideal: VIDEO_H },
frameRate: { ideal: 30, max: 30 },
}
: {
facingMode: { ideal: preferredFacing },
width: { ideal: VIDEO_W },
height: { ideal: VIDEO_H },
frameRate: { ideal: 30, max: 30 },
},
};
stream = await navigator.mediaDevices.getUserMedia(constraints);
} catch {
stream = await navigator.mediaDevices.getUserMedia({
audio: false,
video: { facingMode: preferredFacing },
});
}

streamRef.current = stream;

const settings = stream.getVideoTracks()[0]?.getSettings();
const resolvedDeviceId = settings?.deviceId ?? chosenDeviceId;
const resolvedFacing =
settings?.facingMode === "environment" || preferredFacing === "environment"
? "environment"
: "user";

setActiveCameraId(resolvedDeviceId || "");
setFacingMode(resolvedFacing);

const video = videoRef.current;
if (!video) throw new Error("Missing video element");

video.srcObject = stream;
video.playsInline = true;
video.muted = true;
await video.play();

await loadCameraOptions();
setEnabled(true);
} catch (error) {
console.error(error);
setEngineError({
title: "Camera unavailable",
detail: "Camera did not start. Check permissions and try again.",
});
setEnabled(false);
} finally {
setStartingCamera(false);
}
},
[cameraOptions, facingMode, initDetector, loadCameraOptions, stopCamera],
);

const restartEngine = useCallback(async () => {
const detector = await initDetector();
if (detector && enabled) {
await startCamera({
preferredFacing: facingMode,
preferredDeviceId: activeCameraId || undefined,
});
}
}, [activeCameraId, enabled, facingMode, initDetector, startCamera]);

const switchCamera = useCallback(async () => {
if (switchingCamera || startingCamera) return;
setSwitchingCamera(true);

try {
let cameras = cameraOptions;
if (!cameras.length) cameras = await loadCameraOptions();

const currentIndex = cameras.findIndex((camera) => camera.deviceId === activeCameraId);
let nextCamera: CameraOption | null = null;

if (cameras.length > 1 && currentIndex >= 0) {
nextCamera = cameras[(currentIndex + 1) % cameras.length] ?? null;
} else {
const nextFacing: CameraFacing = facingMode === "user" ? "environment" : "user";
nextCamera =
nextFacing === "environment"
? getPreferredBackCamera(cameras)
: getPreferredFrontCamera(cameras);
}

const nextFacing: CameraFacing = facingMode === "user" ? "environment" : "user";
await startCamera({
preferredFacing: nextFacing,
preferredDeviceId: nextCamera?.deviceId,
});
} finally {
setSwitchingCamera(false);
}
}, [
activeCameraId,
cameraOptions,
facingMode,
loadCameraOptions,
startCamera,
startingCamera,
switchingCamera,
]);

const drawOverlay = useCallback(
(pose: posedetection.Pose | null, nextMetrics: PoseMetrics) => {
const canvas = overlayRef.current;
const video = videoRef.current;
if (!canvas || !video) return;

canvas.width = video.videoWidth || VIDEO_W;
canvas.height = video.videoHeight || VIDEO_H;

const ctx = canvas.getContext("2d");
if (!ctx) return;
ctx.clearRect(0, 0, canvas.width, canvas.height);

const accent = STATE_COLOR[nextMetrics.state];
const centerX = canvas.width / 2;
const centerY = canvas.height / 2;

const lockT = nextMetrics.state === "LOCKING" ? 0.18 + lockPulse * 0.18 : 0;
const targetWidth = canvas.width * (0.48 - lockT * 0.08);
const targetHeight = canvas.height * (0.7 - lockT * 0.06);
const targetX = centerX - targetWidth / 2;
const targetY = centerY - targetHeight / 2;

ctx.save();
ctx.strokeStyle =
nextMetrics.state === "LOCKING"
? `rgba(123,215,255,${0.58 + lockPulse * 0.25})`
: "rgba(255,255,255,0.14)";
ctx.lineWidth = nextMetrics.state === "LOCKING" ? 3 : 2;
ctx.setLineDash([10, 10]);
ctx.strokeRect(targetX, targetY, targetWidth, targetHeight);
ctx.restore();

ctx.fillStyle = "rgba(0,0,0,0.52)";
ctx.fillRect(24, 24, 280, 84);
ctx.fillStyle = accent;
ctx.font = "600 14px Inter, ui-sans-serif, system-ui";
ctx.fillText("SHOT PHASE", 40, 52);
ctx.font = "700 30px Inter, ui-sans-serif, system-ui";
ctx.fillText(
nextMetrics.phase === "IDLE" ? STATE_LABEL[nextMetrics.state] : nextMetrics.phase,
40,
86,
);

if (!pose) return;

const nose = getPoint(pose, "nose");
const ls = getPoint(pose, "left_shoulder");
const rs = getPoint(pose, "right_shoulder");
const lh = getPoint(pose, "left_hip");
const rh = getPoint(pose, "right_hip");
const lk = getPoint(pose, "left_knee");
const rk = getPoint(pose, "right_knee");
const la = getPoint(pose, "left_ankle");
const ra = getPoint(pose, "right_ankle");
const shoulderMid = midpoint(ls, rs);
const hipMid = midpoint(lh, rh);
const ankleMid = midpoint(la, ra);

drawLine(ctx, ls, rs, accent, 5);
drawLine(ctx, lh, rh, accent, 5);
drawLine(ctx, ls, lh, accent, 4);
drawLine(ctx, rs, rh, accent, 4);
drawLine(ctx, lh, lk, accent, 4);
drawLine(ctx, rh, rk, accent, 4);
drawLine(ctx, lk, la, accent, 4);
drawLine(ctx, rk, ra, accent, 4);
drawLine(ctx, shoulderMid, hipMid, accent, 5);
drawLine(ctx, hipMid, ankleMid, accent, 4);

drawCircle(ctx, nose, 6, accent);
drawCircle(ctx, shoulderMid, 7, accent);
drawCircle(ctx, hipMid, 7, accent);
drawCircle(ctx, la, 6, accent);
drawCircle(ctx, ra, 6, accent);
},
[lockPulse],
);

const startRawCameraRecording = useCallback(
(meta: PendingClipMeta) => {
const stream = streamRef.current;
if (!stream) return false;
if (typeof MediaRecorder === "undefined") return false;

const mimeType = pickRecorderMimeType();
let recorder: MediaRecorder;

try {
recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
} catch (error) {
console.error(error);
return false;
}

pendingClipMetaRef.current = meta;
mediaChunksRef.current = [];
mediaRecorderRef.current = recorder;

recorder.ondataavailable = (event) => {
if (event.data && event.data.size > 0) {
mediaChunksRef.current.push(event.data);
}
};

recorder.onerror = (event) => {
console.error("MediaRecorder error", event);
setIsRecording(false);
setIsManualClipActive(false);
setIsSavingClip(false);
};

recorder.onstop = () => {
try {
const finalType =
recorder.mimeType || mimeType || "video/webm";
const blob = new Blob(mediaChunksRef.current, { type: finalType });

if (blob.size > 0) {
if (lastClipUrl) URL.revokeObjectURL(lastClipUrl);
const url = URL.createObjectURL(blob);
setLastClipUrl(url);
finalizePendingClip(url);
} else {
pendingClipMetaRef.current = null;
}
} finally {
setIsRecording(false);
setIsManualClipActive(false);
setIsSavingClip(false);
mediaRecorderRef.current = null;
mediaChunksRef.current = [];
}
};

try {
recorder.start(250);
setIsRecording(true);
return true;
} catch (error) {
console.error(error);
pendingClipMetaRef.current = null;
mediaRecorderRef.current = null;
return false;
}
},
[finalizePendingClip, lastClipUrl],
);

const manualClip = useCallback(() => {
if (!enabled || startingCamera || isRecording || isSavingClip) return;

const now = Date.now();
const meta: PendingClipMeta = {
source: "manual",
startedAt: now,
endedAt: now + manualClipMs,
phase: "IDLE",
peakState: metrics.state,
avgStability: metrics.stability,
avgDetection: metrics.detectionStrength,
releaseStability: 0,
notes: getRepNote({
avgDetection: metrics.detectionStrength,
phase: "IDLE",
releaseStability: 0,
peakState: metrics.state,
source: "manual",
}),
made: lastClipMade,
};

const started = startRawCameraRecording(meta);
if (!started) {
setEngineError({
title: "Recording unavailable",
detail: "Manual clip could not start on this browser/device.",
});
return;
}

setIsManualClipActive(true);

manualClipStopTimeoutRef.current = window.setTimeout(() => {
setIsSavingClip(true);
void stopRecording();
}, manualClipMs);
}, [
enabled,
isRecording,
isSavingClip,
lastClipMade,
manualClipMs,
metrics.detectionStrength,
metrics.state,
metrics.stability,
startRawCameraRecording,
startingCamera,
stopRecording,
]);

useEffect(() => {
if (engineBootedRef.current) return;

void initDetector();

return () => {
void stopCamera();
void destroyDetector();
if (lastClipUrl) URL.revokeObjectURL(lastClipUrl);
};
}, [destroyDetector, initDetector, lastClipUrl, stopCamera]);

useEffect(() => {
let frame = 0;
const interval = window.setInterval(() => {
frame += 1;
setLockPulse((Math.sin(frame * 0.24) + 1) / 2);
}, 60);
return () => window.clearInterval(interval);
}, []);

useEffect(() => {
if (!enabled || engineStatus !== "ready") {
stopLoop();
return;
}

const analyze = async (ts: number) => {
loopRef.current = requestAnimationFrame(analyze);

const video = videoRef.current;
const detector = detectorRef.current;
if (!video || !detector) return;
if (video.readyState < 2) return;
if (ts - lastAnalysisRef.current < ANALYSIS_INTERVAL_MS) return;

lastAnalysisRef.current = ts;

try {
const poses = await detector.estimatePoses(video, {
maxPoses: 1,
flipHorizontal: facingMode === "user",
});

const pose = poses[0] ?? null;

let nextMetrics = INITIAL_METRICS;

if (pose) {
const shoulderMid = midpoint(
getPoint(pose, "left_shoulder"),
getPoint(pose, "right_shoulder"),
);

nextMetrics = analyzePose(
pose,
video.videoWidth,
video.videoHeight,
signalRef.current,
prevPhaseRef.current,
prevChestYRef.current,
);

prevChestYRef.current = shoulderMid?.y ?? prevChestYRef.current;
} else {
const fallbackSignal = Math.max(8, Math.round(metrics.detectionStrength * 0.5));
nextMetrics = {
...INITIAL_METRICS,
state: metrics.detectionStrength >= 28 ? "LOCKING" : "NO_SUBJECT",
phase: "IDLE",
detectionStrength: metrics.detectionStrength,
lockStrength: metrics.detectionStrength,
signal: [...signalRef.current, fallbackSignal].slice(-SIGNAL_BUFFER),
};
}

signalRef.current = nextMetrics.signal;
prevPhaseRef.current = nextMetrics.phase;
setMetrics(nextMetrics);
drawOverlay(pose, nextMetrics);
} catch (error) {
console.error(error);
setEngineStatus("error");
setEngineError({
title: "Instrument unavailable",
detail: "Pose engine did not initialize. Retry engine or restart camera.",
});
}
};

loopRef.current = requestAnimationFrame(analyze);
return () => stopLoop();
}, [
drawOverlay,
enabled,
engineStatus,
facingMode,
metrics.detectionStrength,
stopLoop,
]);

const signalBars = useMemo(() => {
return metrics.signal.map((value, index) => {
let color = STATE_COLOR.NO_SUBJECT;
if (value >= 78) color = STATE_COLOR.RELEASE;
else if (value >= 58) color = STATE_COLOR.RISE;
else if (value >= 38) color = STATE_COLOR.LAND;
else if (value >= 24) color = STATE_COLOR.LOCKING;

return {
id: `${index}-${value}`,
value,
color,
active: index === metrics.signal.length - 1,
};
});
}, [metrics.signal]);

const liveReadLabel = useMemo(() => {
if (engineStatus === "error") return "INSTRUMENT OFFLINE";
if (metrics.phase !== "IDLE") return `PHASE ${metrics.phase}`;
if (metrics.state === "NO_SUBJECT") return "NO LIVE READ";
if (metrics.state === "LOCKING") return "SIGNAL ACQUIRING";
if (metrics.state === "ALIGNED") return "STRUCTURE STABLE";
if (metrics.state === "SHIFT") return "STRUCTURE DRIFT";
if (metrics.state === "DROP") return "STRUCTURE DROP";
return "STRUCTURE LOST";
}, [engineStatus, metrics.phase, metrics.state]);

const subjectBarLabel = useMemo(() => {
if (metrics.phase !== "IDLE") return metrics.phase;
if (metrics.detectionStrength < 12) return "no subject";
if (metrics.detectionStrength < 30) return "weak read";
if (metrics.detectionStrength < 58) return "locking";
if (metrics.detectionStrength < 80) return "good read";
return "strong read";
}, [metrics.detectionStrength, metrics.phase]);

const markShot = useCallback((made: boolean) => {
setLastClipMade(made);
setReps((prev) => {
if (!prev.length) return prev;
const [first, ...rest] = prev;
return [{ ...first, made }, ...rest];
});
}, []);

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
<div>
<div className="text-xs uppercase tracking-[0.32em] text-white/40">
Axis Instrument
</div>
<h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">
Structure Through Space + Time
</h1>
<p className="mt-2 max-w-3xl text-sm text-white/60 md:text-base">
Raw-camera manual clip mode. Tap Clip Rep to record and save the actual
camera stream.
</p>
</div>

<div className="flex flex-wrap gap-3">
<button
onClick={() => (enabled ? stopCamera() : startCamera())}
disabled={startingCamera || engineStatus === "loading" || isSavingClip}
className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
>
{enabled
? "Stop Camera"
: startingCamera || engineStatus === "loading"
? "Starting"
: "Start Camera"}
</button>

<button
onClick={switchCamera}
disabled={!enabled || switchingCamera || startingCamera || isSavingClip}
className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
>
{switchingCamera ? "Switching" : "Switch Camera"}
</button>

<button
onClick={manualClip}
disabled={!enabled || startingCamera || isRecording || isSavingClip}
className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
>
{isManualClipActive ? "Recording Clip" : isSavingClip ? "Saving Clip" : "Clip Rep"}
</button>
</div>
</div>

{engineError ? (
<div className="rounded-[24px] border border-red-500/30 bg-red-500/8 px-5 py-4">
<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-red-200/70">
Instrument Status
</div>
<div className="mt-1 text-xl font-semibold text-red-100">
{engineError.title}
</div>
<div className="mt-1 text-sm text-red-100/80">
{engineError.detail}
</div>
</div>

<div className="flex gap-3">
<button
onClick={restartEngine}
className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-black"
>
Retry Engine
</button>
<button
onClick={() =>
startCamera({
preferredFacing: facingMode,
preferredDeviceId: activeCameraId || undefined,
})
}
className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm font-semibold text-white"
>
Restart Camera
</button>
</div>
</div>
</div>
) : null}

<div className="grid gap-6 lg:grid-cols-[1.42fr_0.58fr]">
<div className="overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
<div className="relative aspect-video bg-black">
<video
ref={videoRef}
className={`absolute inset-0 h-full w-full object-cover ${
facingMode === "user" ? "scale-x-[-1]" : ""
}`}
autoPlay
muted
playsInline
/>

<canvas
ref={overlayRef}
className={`absolute inset-0 h-full w-full object-cover ${
facingMode === "user" ? "scale-x-[-1]" : ""
}`}
/>

<div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-md">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">
Phase
</div>
<div
className="mt-1 text-2xl font-semibold"
style={{ color: STATE_COLOR[metrics.state] }}
>
{metrics.phase === "IDLE" ? STATE_LABEL[metrics.state] : metrics.phase}
</div>
</div>

<div className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-right backdrop-blur-md">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">
Release
</div>
<div className="mt-1 text-3xl font-semibold">{metrics.releaseStability}</div>
</div>

<div className="absolute inset-x-4 bottom-4 rounded-[26px] border border-white/10 bg-black/62 p-4 backdrop-blur-md">
<div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
<div>
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">
Structure Signal
</div>
<div className="mt-1 text-sm font-medium text-white/80">
{liveReadLabel}
</div>
</div>

<div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
<span
className="inline-block h-2.5 w-2.5 rounded-full"
style={{ backgroundColor: STATE_COLOR.NO_SUBJECT }}
/>{" "}
no subject
<span
className="ml-2 inline-block h-2.5 w-2.5 rounded-full"
style={{ backgroundColor: STATE_COLOR.LOCKING }}
/>{" "}
locking
<span
className="ml-2 inline-block h-2.5 w-2.5 rounded-full"
style={{ backgroundColor: STATE_COLOR.RISE }}
/>{" "}
rise
<span
className="ml-2 inline-block h-2.5 w-2.5 rounded-full"
style={{ backgroundColor: STATE_COLOR.RELEASE }}
/>{" "}
release
<span
className="ml-2 inline-block h-2.5 w-2.5 rounded-full"
style={{ backgroundColor: STATE_COLOR.LAND }}
/>{" "}
land
<span
className="ml-2 inline-block h-2.5 w-2.5 rounded-full"
style={{ backgroundColor: STATE_COLOR.LOST }}
/>{" "}
lost
</div>
</div>

<div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-3">
<div className="flex h-24 items-end gap-[4px] overflow-hidden rounded-[18px] bg-gradient-to-b from-white/[0.03] to-white/[0.01] px-2 py-2">
{signalBars.length ? (
signalBars.map((bar) => (
<div
key={bar.id}
className="min-w-[8px] flex-1 rounded-full transition-all duration-150"
style={{
height: `${clamp(bar.value, 8, 100)}%`,
backgroundColor: bar.color,
boxShadow: bar.active ? `0 0 18px ${bar.color}` : "none",
opacity: bar.active ? 1 : 0.84,
transform: bar.active ? "scaleY(1.05)" : "scaleY(1)",
}}
/>
))
) : (
<div className="flex w-full items-center justify-center text-xs uppercase tracking-[0.3em] text-white/28">
no live read
</div>
)}
</div>
</div>
</div>
</div>
</div>

<div className="flex flex-col gap-6">
<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Signal Integrity
</div>

<div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
<div className="flex items-center justify-between gap-4">
<div>
<div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
Subject Read
</div>
<div className="mt-2 text-3xl font-semibold text-white">
{metrics.detectionStrength}%
</div>
</div>
<div className="text-sm capitalize text-white/55">
{subjectBarLabel}
</div>
</div>

<div className="mt-4 h-4 overflow-hidden rounded-full bg-white/8">
<div
className="h-full rounded-full transition-all duration-200"
style={{
width: `${metrics.detectionStrength}%`,
background:
metrics.detectionStrength < 24
? "linear-gradient(90deg, #595959 0%, #8A8A8A 100%)"
: metrics.detectionStrength < 58
? "linear-gradient(90deg, #5AC8FA 0%, #8CE1FF 100%)"
: metrics.detectionStrength < 78
? "linear-gradient(90deg, #FFD54A 0%, #FFE388 100%)"
: "linear-gradient(90deg, #3DDE74 0%, #76F5A1 100%)",
}}
/>
</div>
</div>

<div className="mt-4 grid grid-cols-2 gap-3 text-sm">
<MetricCard label="Confidence" value={`${metrics.confidenceSignal}%`} />
<MetricCard label="Lock" value={`${metrics.lockStrength}%`} />
<MetricCard label="Shot Candidate" value={`${metrics.shotCandidate}%`} />
<MetricCard label="Release Stability" value={`${metrics.releaseStability}%`} />
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="flex items-center justify-between gap-3">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Replay
</div>
<div className="mt-2 text-lg font-semibold">
Raw camera manual clip.
</div>
</div>

<div
className={`rounded-full px-3 py-1 text-xs font-semibold ${
isManualClipActive
? "bg-blue-500/12 text-blue-200"
: isRecording
? "bg-red-500/12 text-red-200"
: isSavingClip
? "bg-yellow-500/12 text-yellow-200"
: "bg-white/6 text-white/55"
}`}
>
{isManualClipActive
? "Recording Clip"
: isRecording
? "Recording"
: isSavingClip
? "Saving"
: "Idle"}
</div>
</div>

<div className="mt-4 grid grid-cols-2 gap-3">
<button
onClick={() => markShot(true)}
className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-black"
>
Mark Made
</button>
<button
onClick={() => markShot(false)}
className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white"
>
Mark Missed
</button>
</div>

<div className="mt-4">
<label className="text-[10px] uppercase tracking-[0.24em] text-white/40">
Manual Clip Window
</label>
<input
type="range"
min={2000}
max={6000}
step={250}
value={manualClipMs}
onChange={(e) => setManualClipMs(Number(e.target.value))}
className="mt-2 w-full"
/>
<div className="mt-1 text-sm text-white/55">
{(manualClipMs / 1000).toFixed(1)}s
</div>
</div>

{lastClipUrl ? (
<div className="mt-4 overflow-hidden rounded-[22px] border border-white/10 bg-black">
<video src={lastClipUrl} controls className="aspect-video w-full" />
</div>
) : (
<div className="mt-4 rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
Tap Clip Rep to save a raw camera replay.
</div>
)}
</div>

<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Recent Reps
</div>

<div className="mt-4 space-y-3">
{reps.length ? (
reps.map((rep) => (
<div
key={rep.id}
className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4"
>
<div className="flex items-center justify-between gap-4">
<div
className="text-sm font-semibold"
style={{ color: STATE_COLOR[rep.peakState] }}
>
{rep.source === "manual"
? "MANUAL CLIP"
: rep.phase !== "IDLE"
? rep.phase
: STATE_LABEL[rep.peakState]}
</div>

<div className="text-xs text-white/45">
{Math.max(0.2, (rep.endedAt - rep.startedAt) / 1000).toFixed(1)}s
</div>
</div>

<div className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
<span className="rounded-full border border-white/10 px-2 py-1">
stability {rep.avgStability}
</span>
<span className="rounded-full border border-white/10 px-2 py-1">
read {rep.avgDetection}
</span>
<span className="rounded-full border border-white/10 px-2 py-1">
release {rep.releaseStability}
</span>
<span className="rounded-full border border-white/10 px-2 py-1">
{rep.source}
</span>
{typeof rep.made === "boolean" ? (
<span className="rounded-full border border-white/10 px-2 py-1">
{rep.made ? "made" : "missed"}
</span>
) : null}
</div>

<div className="mt-2 text-sm text-white/70">{rep.notes}</div>
</div>
))
) : (
<div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
No reps captured yet.
</div>
)}
</div>
</div>
</div>
</div>
</div>
</div>
);
}

function MetricCard({ label, value }: { label: string; value: string }) {
return (
<div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
<div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
{label}
</div>
<div className="mt-2 text-lg font-semibold text-white">{value}</div>
</div>
);
}