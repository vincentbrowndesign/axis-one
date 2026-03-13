"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";

type AxisState =
| "LOST"
| "FIND SUBJECT"
| "OFF AXIS"
| "SHIFT"
| "DROP"
| "LOCK";

type TracePhase = "LOAD" | "HOLD" | "RELEASE";

type FacingMode = "user" | "environment";
type ViewMode = "SCAN" | "READ" | "TRUE";

type Point = {
x: number;
y: number;
score: number;
};

type CaptureItem = {
id: string;
timestamp: number;
axisReady: number;
axisCore: number;
state: AxisState;
phase: TracePhase;
isTrue: boolean;
dataUrl: string;
};

type BaselineSample = {
shoulderAngle: number;
hipAngle: number;
torsoMidXNorm: number;
torsoHeightNorm: number;
shoulderWidthNorm: number;
hipWidthNorm: number;
baseRatio: number | null;
};

type Baseline = {
shoulderAngle: number;
hipAngle: number;
torsoMidXNorm: number;
torsoHeightNorm: number;
shoulderWidthNorm: number;
hipWidthNorm: number;
baseRatio: number | null;
};

type FrameMetrics = {
axisCore: number;
axisReady: number;
alignment: number;
stability: number;
motion: number;
confidence: number;
baseRatio: number;
centerOffset: number;
state: AxisState;
phase: TracePhase;
isTrue: boolean;
};

const MIN_POINT_SCORE = 0.22;
const MIN_PAIR_SCORE = 0.22;

const CALIBRATION_MS = 1600;
const AUTO_CAPTURE_COOLDOWN_MS = 1200;
const TRUE_FLASH_MS = 550;

const SHIFT_THRESHOLD = 42;
const DROP_THRESHOLD = 62;
const LOCK_THRESHOLD = 78;

const READ_CONFIDENCE_MIN = 45;

const AXIS_ANGLE_SMOOTH = 0.12;
const AXIS_CENTER_SMOOTH = 0.16;
const AXIS_LOW_CONFIDENCE_SMOOTH = 0.06;

/**
* Phase thresholds
*/
const HOLD_READY_MIN = 58;
const HOLD_QUIET_MOTION_MIN = 58;
const HOLD_STABILITY_MIN = 26;
const HOLD_ALIGNMENT_MIN = 52;
const HOLD_MIN_MS = 140;
const HOLD_DROP_GRACE_MS = 180;

const RELEASE_CENTER_VELOCITY_MIN = 0.007;
const RELEASE_TORSO_HEIGHT_DELTA_MIN = 0.014;
const RELEASE_ANGLE_DELTA_MIN = 2.6;
const RELEASE_MIN_FROM_HOLD_MS = 90;
const RELEASE_REFRACTORY_MS = 700;

const STATE_GLOW: Record<AxisState, string> = {
LOST: "rgba(140,160,180,0.08)",
"FIND SUBJECT": "rgba(110,170,255,0.12)",
"OFF AXIS": "rgba(255,120,120,0.12)",
SHIFT: "rgba(255,210,100,0.12)",
DROP: "rgba(255,165,90,0.12)",
LOCK: "rgba(100,255,170,0.16)",
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
return a + (b - a) * t;
}

function distance(a: Point, b: Point) {
return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
score: Math.min(a.score, b.score),
};
}

function angleDeg(a: Point, b: Point) {
return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function normalizeAngleAbs(deg: number) {
const normalized = ((deg % 180) + 180) % 180;
const lineAngle = normalized > 90 ? normalized - 180 : normalized;
return Math.abs(lineAngle);
}

function angleDeltaRad(a: number, b: number) {
let d = a - b;
while (d > Math.PI) d -= Math.PI * 2;
while (d < -Math.PI) d += Math.PI * 2;
return d;
}

function lerpAngle(a: number, b: number, t: number) {
return a + angleDeltaRad(b, a) * t;
}

function hasPoint(p?: Point) {
return !!p && p.score >= MIN_POINT_SCORE;
}

function hasPair(a?: Point, b?: Point) {
return !!a && !!b && a.score >= MIN_PAIR_SCORE && b.score >= MIN_PAIR_SCORE;
}

function average(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function averageNullable(values: Array<number | null>) {
const valid = values.filter((v): v is number => v !== null);
if (!valid.length) return null;
return average(valid);
}

function buildBaseline(samples: BaselineSample[]): Baseline {
return {
shoulderAngle: average(samples.map((s) => s.shoulderAngle)),
hipAngle: average(samples.map((s) => s.hipAngle)),
torsoMidXNorm: average(samples.map((s) => s.torsoMidXNorm)),
torsoHeightNorm: average(samples.map((s) => s.torsoHeightNorm)),
shoulderWidthNorm: average(samples.map((s) => s.shoulderWidthNorm)),
hipWidthNorm: average(samples.map((s) => s.hipWidthNorm)),
baseRatio: averageNullable(samples.map((s) => s.baseRatio)),
};
}

function createFileName(kind: string, score: number, timestamp: number, ext: string) {
const d = new Date(timestamp);
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
return `AXIS_CORE_V1_${kind}_${Math.round(score)}_${stamp}.${ext}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
const parts = dataUrl.split(",");
const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
const binary = atob(parts[1]);
const len = binary.length;
const bytes = new Uint8Array(len);
for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
return new Blob([bytes], { type: mime });
}

function downloadBlob(blob: Blob, filename: string) {
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
a.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareOrDownloadBlob(blob: Blob, filename: string) {
const file = new File([blob], filename, { type: blob.type });
const nav = navigator as Navigator & {
canShare?: (data?: ShareData) => boolean;
};

if (navigator.share && nav.canShare?.({ files: [file] })) {
await navigator.share({
title: filename,
files: [file],
});
return;
}

downloadBlob(blob, filename);
}

async function initTfBackend() {
await tf.ready();
if (tf.getBackend() === "webgl") return;
const ok = await tf.setBackend("webgl");
if (!ok) throw new Error("TensorFlow WebGL backend could not be initialized.");
await tf.ready();
}

function getViewMode(metrics: FrameMetrics): ViewMode {
if (metrics.isTrue) return "TRUE";
if (metrics.state === "LOST" || metrics.state === "FIND SUBJECT") return "SCAN";
return "READ";
}

export default function AxisCoreV1Page() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);

const streamRef = useRef<MediaStream | null>(null);
const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
const rafRef = useRef<number | null>(null);

const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const recordedChunksRef = useRef<Blob[]>([]);

const baselineRef = useRef<Baseline | null>(null);
const calibrationStartedAtRef = useRef<number | null>(null);
const calibrationSamplesRef = useRef<BaselineSample[]>([]);

const holdStartedAtRef = useRef<number | null>(null);
const holdLastGoodAtRef = useRef<number | null>(null);
const lastReleaseAtRef = useRef<number>(0);

const lastAutoCaptureAtRef = useRef<number>(0);
const bestReadyRef = useRef<number>(0);
const lastCenterNormRef = useRef<number | null>(null);
const smoothedReadyRef = useRef<number>(0);
const trueFlashUntilRef = useRef<number>(0);

const smoothedAxisAngleRef = useRef<number | null>(null);
const smoothedCenterRef = useRef<{ x: number; y: number } | null>(null);

const [enabled, setEnabled] = useState(false);
const [ready, setReady] = useState(false);
const [error, setError] = useState("");

const [axisReady, setAxisReady] = useState(0);
const [axisCore, setAxisCore] = useState(0);
const [axisState, setAxisState] = useState<AxisState>("LOST");
const [tracePhase, setTracePhase] = useState<TracePhase>("LOAD");
const [isTrueMoment, setIsTrueMoment] = useState(false);
const [calibrationProgress, setCalibrationProgress] = useState(0);

const [alignmentScore, setAlignmentScore] = useState(0);
const [stabilityScore, setStabilityScore] = useState(0);
const [motionScore, setMotionScore] = useState(0);
const [confidenceScore, setConfidenceScore] = useState(0);

const [guideText, setGuideText] = useState("FIND SUBJECT");
const [facingMode, setFacingMode] = useState<FacingMode>("environment");
const [isRecording, setIsRecording] = useState(false);
const [recordedVideoUrl, setRecordedVideoUrl] = useState("");
const [captures, setCaptures] = useState<CaptureItem[]>([]);
const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);

const sessionSeconds = useMemo(() => {
if (!sessionStartedAt) return 0;
return Math.floor((Date.now() - sessionStartedAt) / 1000);
}, [sessionStartedAt, axisReady]);

const resetSession = useCallback(() => {
baselineRef.current = null;
calibrationStartedAtRef.current = null;
calibrationSamplesRef.current = [];
holdStartedAtRef.current = null;
holdLastGoodAtRef.current = null;
lastReleaseAtRef.current = 0;
lastAutoCaptureAtRef.current = 0;
bestReadyRef.current = 0;
lastCenterNormRef.current = null;
smoothedReadyRef.current = 0;
trueFlashUntilRef.current = 0;
smoothedAxisAngleRef.current = null;
smoothedCenterRef.current = null;

setAxisReady(0);
setAxisCore(0);
setAxisState("LOST");
setTracePhase("LOAD");
setIsTrueMoment(false);
setCalibrationProgress(0);
setAlignmentScore(0);
setStabilityScore(0);
setMotionScore(0);
setConfidenceScore(0);
setGuideText("FIND SUBJECT");
setRecordedVideoUrl("");
setCaptures([]);
setSessionStartedAt(Date.now());
}, []);

const getCanvasSize = useCallback(() => {
const video = videoRef.current;
if (!video) return { width: 720, height: 1280 };
return {
width: video.videoWidth || 720,
height: video.videoHeight || 1280,
};
}, []);

const syncCanvasSize = useCallback(() => {
const { width, height } = getCanvasSize();
const overlay = overlayCanvasRef.current;
const exportCanvas = exportCanvasRef.current;

if (overlay) {
overlay.width = width;
overlay.height = height;
}
if (exportCanvas) {
exportCanvas.width = width;
exportCanvas.height = height;
}
}, [getCanvasSize]);

const drawVideoCover = useCallback(
(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) => {
const vw = video.videoWidth || width;
const vh = video.videoHeight || height;
const scale = Math.max(width / vw, height / vh);
const dw = vw * scale;
const dh = vh * scale;
const dx = (width - dw) / 2;
const dy = (height - dh) / 2;
ctx.drawImage(video, dx, dy, dw, dh);
},
[],
);

const drawGrid = useCallback(
(ctx: CanvasRenderingContext2D, width: number, height: number, mode: ViewMode) => {
ctx.save();
ctx.strokeStyle =
mode === "SCAN" ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.055)";
ctx.lineWidth = 1;

for (let i = 1; i < 6; i += 1) {
const x = (width / 6) * i;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}

for (let i = 1; i < 10; i += 1) {
const y = (height / 10) * i;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}

ctx.restore();
},
[],
);

const drawAmbientGlow = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
state: AxisState,
mode: ViewMode,
) => {
ctx.save();

const radial = ctx.createRadialGradient(
width / 2,
height / 2,
width * 0.12,
width / 2,
height / 2,
Math.max(width, height) * 0.78,
);

radial.addColorStop(0, "rgba(255,255,255,0)");
radial.addColorStop(0.58, "rgba(255,255,255,0)");
radial.addColorStop(1, STATE_GLOW[state]);

ctx.fillStyle = radial;
ctx.fillRect(0, 0, width, height);

if (mode === "SCAN") {
const top = ctx.createLinearGradient(0, 0, 0, height * 0.22);
top.addColorStop(0, "rgba(110,170,255,0.10)");
top.addColorStop(1, "rgba(110,170,255,0)");
ctx.fillStyle = top;
ctx.fillRect(0, 0, width, height * 0.22);
}

ctx.restore();
},
[],
);

const drawAxisBeam = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
state: AxisState,
angleRad: number | null,
center: { x: number; y: number } | null,
mode: ViewMode,
) => {
ctx.save();

let color = "rgba(255,255,255,0.34)";
let coreColor = "rgba(255,255,255,0.56)";
let glow = "rgba(255,255,255,0.08)";
let beamWidth = 6;
let lineWidth = 2.2;

if (mode === "SCAN") {
color = "rgba(175,195,220,0.28)";
coreColor = "rgba(200,215,235,0.46)";
glow = "rgba(150,180,220,0.08)";
beamWidth = 5;
lineWidth = 1.6;
} else {
if (state === "LOCK") {
color = "rgba(100,255,170,0.26)";
coreColor = "rgba(100,255,170,0.96)";
glow = "rgba(100,255,170,0.12)";
}
if (state === "SHIFT") {
color = "rgba(255,210,100,0.22)";
coreColor = "rgba(255,210,100,0.92)";
glow = "rgba(255,210,100,0.10)";
}
if (state === "DROP") {
color = "rgba(255,165,90,0.24)";
coreColor = "rgba(255,165,90,0.95)";
glow = "rgba(255,165,90,0.10)";
}
if (state === "OFF AXIS") {
color = "rgba(255,120,120,0.22)";
coreColor = "rgba(255,120,120,0.94)";
glow = "rgba(255,120,120,0.10)";
}
}

const cx = center?.x ?? width / 2;
const cy = center?.y ?? height / 2;
const theta = angleRad ?? Math.PI / 2;
const length = Math.max(width, height) * 0.52;
const dx = Math.cos(theta) * length;
const dy = Math.sin(theta) * length;

const tickNx = -Math.sin(theta);
const tickNy = Math.cos(theta);

ctx.strokeStyle = glow;
ctx.lineWidth = beamWidth;
ctx.beginPath();
ctx.moveTo(cx - dx, cy - dy);
ctx.lineTo(cx + dx, cy + dy);
ctx.stroke();

ctx.strokeStyle = color;
ctx.lineWidth = beamWidth * 0.55;
ctx.beginPath();
ctx.moveTo(cx - dx, cy - dy);
ctx.lineTo(cx + dx, cy + dy);
ctx.stroke();

ctx.strokeStyle = coreColor;
ctx.lineWidth = lineWidth;
ctx.beginPath();
ctx.moveTo(cx - dx, cy - dy);
ctx.lineTo(cx + dx, cy + dy);
ctx.stroke();

const tickCount = 10;
for (let i = -tickCount; i <= tickCount; i += 1) {
if (i === 0) continue;
const t = i / tickCount;
const px = cx + dx * t;
const py = cy + dy * t;
const tickLen = i % 2 === 0 ? 10 : 6;

ctx.strokeStyle = "rgba(255,255,255,0.20)";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(px - tickNx * tickLen, py - tickNy * tickLen);
ctx.lineTo(px + tickNx * tickLen, py + tickNy * tickLen);
ctx.stroke();
}

if (mode !== "SCAN") {
ctx.fillStyle = coreColor;
ctx.beginPath();
ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
ctx.fill();
}

ctx.restore();
},
[],
);

const drawAxisShape = useCallback(
(
ctx: CanvasRenderingContext2D,
center: { x: number; y: number } | null,
phase: TracePhase,
readyScore: number,
width: number,
height: number,
mode: ViewMode,
) => {
if (!center || mode === "SCAN") return;

const cx = center.x;
const cy = center.y;

const compactness = clamp(readyScore / 100, 0, 1);
const spreadX =
phase === "LOAD"
? lerp(width * 0.1, width * 0.18, 1 - compactness)
: phase === "HOLD"
? lerp(width * 0.065, width * 0.11, 1 - compactness)
: lerp(width * 0.03, width * 0.06, 1 - compactness);

const spreadY =
phase === "LOAD"
? lerp(height * 0.05, height * 0.1, 1 - compactness)
: phase === "HOLD"
? lerp(height * 0.04, height * 0.075, 1 - compactness)
: lerp(height * 0.08, height * 0.15, compactness);

ctx.save();
ctx.strokeStyle =
phase === "HOLD"
? "rgba(120,255,180,0.82)"
: phase === "RELEASE"
? "rgba(255,255,255,0.88)"
: "rgba(255,210,120,0.72)";
ctx.lineWidth = 1.5;

const top = { x: cx, y: cy - spreadY };
const left = { x: cx - spreadX, y: cy + spreadY * 0.55 };
const right = { x: cx + spreadX, y: cy + spreadY * 0.55 };
const bottom = { x: cx, y: cy + spreadY * 1.15 };

ctx.beginPath();
ctx.moveTo(top.x, top.y);
ctx.lineTo(left.x, left.y);
ctx.lineTo(bottom.x, bottom.y);
ctx.lineTo(right.x, right.y);
ctx.closePath();
ctx.stroke();

ctx.beginPath();
ctx.moveTo(top.x, top.y);
ctx.lineTo(bottom.x, bottom.y);
ctx.stroke();

if (phase === "HOLD") {
ctx.fillStyle = "rgba(120,255,180,0.14)";
ctx.fill();
}

ctx.restore();
},
[],
);

const drawTraceBand = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
phase: TracePhase,
isTrue: boolean,
mode: ViewMode,
) => {
const bandX = 28;
const bandW = width - 56;
const bandY = height - 118;
const bandH = 58;

const x0 = bandX + 16;
const x1 = bandX + bandW - 16;
const loadX = x0;
const holdX = lerp(x0, x1, 0.42);
const trueX = lerp(x0, x1, 0.67);
const releaseX = x1;
const lineY = bandY + 31;

ctx.save();

ctx.fillStyle =
mode === "SCAN" ? "rgba(0,0,0,0.34)" : "rgba(0,0,0,0.42)";
ctx.fillRect(bandX, bandY, bandW, bandH);

ctx.font =
'600 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
ctx.fillStyle = "rgba(255,255,255,0.48)";
ctx.fillText("PHASE TRACE", x0, bandY + 14);

ctx.strokeStyle = "rgba(255,255,255,0.18)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(x0, lineY);
ctx.lineTo(x1, lineY);
ctx.stroke();

const activeColor =
phase === "HOLD"
? "rgba(100,255,170,0.98)"
: phase === "RELEASE"
? "rgba(255,255,255,0.98)"
: "rgba(255,210,100,0.98)";

ctx.strokeStyle = activeColor;
ctx.lineWidth = 3;

if (phase === "LOAD") {
ctx.beginPath();
ctx.moveTo(loadX, lineY);
ctx.lineTo(holdX - 14, lineY);
ctx.stroke();
} else if (phase === "HOLD") {
ctx.beginPath();
ctx.moveTo(loadX, lineY);
ctx.lineTo(trueX - 16, lineY);
ctx.stroke();
} else {
ctx.beginPath();
ctx.moveTo(loadX, lineY);
ctx.lineTo(releaseX, lineY);
ctx.stroke();
}

ctx.fillStyle = "rgba(255,255,255,0.68)";
ctx.fillText("LOAD", loadX, bandY + 49);
ctx.fillText("HOLD", holdX - 14, bandY + 49);
ctx.fillText("RELEASE", releaseX - 48, bandY + 49);

if (isTrue) {
ctx.font =
'700 18px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = "rgba(100,255,170,1)";
ctx.fillText("◎", trueX - 7, lineY + 7);
} else {
ctx.font =
'700 18px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = mode === "SCAN" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.22)";
ctx.fillText("·", trueX - 2, lineY + 7);
}

ctx.restore();
},
[],
);

const drawHud = useCallback(
(
ctx: CanvasRenderingContext2D,
width: number,
height: number,
metrics: FrameMetrics,
guide: string,
progress: number,
mode: ViewMode,
) => {
ctx.save();

ctx.fillStyle = "rgba(0,0,0,0.34)";
ctx.fillRect(24, 24, width - 48, 100);

const scoreColor =
mode === "SCAN"
? "rgba(235,240,250,0.78)"
: metrics.state === "LOCK"
? "rgba(100,255,170,1)"
: metrics.state === "DROP"
? "rgba(150,255,190,1)"
: metrics.state === "SHIFT"
? "rgba(255,210,100,1)"
: "rgba(255,140,140,1)";

ctx.font =
'600 18px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = "rgba(255,255,255,0.72)";
ctx.fillText("AXIS READY", 40, 52);

ctx.font =
'700 38px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = scoreColor;
const scoreText =
mode === "SCAN" || guide === "LOCK" ? "··" : String(Math.round(metrics.axisReady)).padStart(2, "0");
ctx.fillText(scoreText, 40, 96);

ctx.font =
'600 16px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = "rgba(255,255,255,0.86)";
ctx.fillText(metrics.state === "FIND SUBJECT" ? "FIND SUBJECT" : metrics.state, 108, 94);

ctx.font =
'500 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
ctx.fillStyle = "rgba(255,255,255,0.64)";
ctx.fillText(`CORE ${guide === "LOCK" || mode === "SCAN" ? "·" : Math.round(metrics.axisCore)}`, width - 160, 54);
ctx.fillText(`CONF ${Math.round(metrics.confidence)}`, width - 160, 76);

if (progress > 0 && progress < 100) {
ctx.fillStyle = "rgba(255,255,255,0.08)";
ctx.fillRect(24, 132, width - 48, 9);
ctx.fillStyle = "rgba(130,190,255,0.96)";
ctx.fillRect(24, 132, (width - 48) * (progress / 100), 9);
}

ctx.fillStyle = "rgba(0,0,0,0.28)";
ctx.fillRect(24, height - 50, width - 48, 28);
ctx.font =
'500 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
ctx.fillStyle = mode === "SCAN" ? "rgba(205,220,235,0.62)" : "rgba(255,255,255,0.64)";
ctx.fillText(guide, 40, height - 31);

if (metrics.isTrue) {
ctx.font =
'700 34px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
ctx.fillStyle = "rgba(100,255,170,0.98)";
ctx.fillText("TRUE ◎", width / 2 - 64, height / 2 - 8);
}

ctx.restore();
},
[],
);

const renderInstrument = useCallback(
(
keypoints: Record<string, Point> | null,
center: { x: number; y: number } | null,
axisAngleRad: number | null,
metrics: FrameMetrics,
guide: string,
calibration: number,
) => {
const video = videoRef.current;
const overlay = overlayCanvasRef.current;
const exportCanvas = exportCanvasRef.current;
if (!video || !overlay || !exportCanvas) return;

const overlayCtx = overlay.getContext("2d");
const exportCtx = exportCanvas.getContext("2d");
if (!overlayCtx || !exportCtx) return;

const { width, height } = overlay;
const mode = getViewMode(metrics);

[overlayCtx, exportCtx].forEach((ctx) => {
ctx.clearRect(0, 0, width, height);
drawVideoCover(ctx, video, width, height);
drawAmbientGlow(ctx, width, height, metrics.state, mode);
drawGrid(ctx, width, height, mode);
drawAxisBeam(ctx, width, height, metrics.state, axisAngleRad, center, mode);
drawAxisShape(ctx, center, metrics.phase, metrics.axisReady, width, height, mode);

if (keypoints && mode !== "SCAN") {
const ls = keypoints.left_shoulder;
const rs = keypoints.right_shoulder;
const lh = keypoints.left_hip;
const rh = keypoints.right_hip;
const la = keypoints.left_ankle;
const ra = keypoints.right_ankle;

ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.72)";
ctx.lineWidth = 2.5;

if (hasPair(ls, rs)) {
ctx.beginPath();
ctx.moveTo(ls!.x, ls!.y);
ctx.lineTo(rs!.x, rs!.y);
ctx.stroke();
}

if (hasPair(lh, rh)) {
ctx.beginPath();
ctx.moveTo(lh!.x, lh!.y);
ctx.lineTo(rh!.x, rh!.y);
ctx.stroke();
}

if (hasPair(la, ra)) {
ctx.strokeStyle = "rgba(255,255,255,0.34)";
ctx.beginPath();
ctx.moveTo(la!.x, la!.y);
ctx.lineTo(ra!.x, ra!.y);
ctx.stroke();
}

ctx.restore();
}

drawTraceBand(ctx, width, height, metrics.phase, metrics.isTrue, mode);
drawHud(ctx, width, height, metrics, guide, calibration, mode);
});
},
[
drawAmbientGlow,
drawAxisBeam,
drawAxisShape,
drawGrid,
drawHud,
drawTraceBand,
drawVideoCover,
],
);

const addCaptureFromExportCanvas = useCallback(async (metrics: FrameMetrics) => {
const canvas = exportCanvasRef.current;
if (!canvas) return;
const timestamp = Date.now();
const dataUrl = canvas.toDataURL("image/jpeg", 0.94);

setCaptures((prev) => [
{
id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
timestamp,
axisReady: metrics.axisReady,
axisCore: metrics.axisCore,
state: metrics.state,
phase: metrics.phase,
isTrue: metrics.isTrue,
dataUrl,
},
...prev,
]);
}, []);

const analyzePose = useCallback(
async (now: number) => {
const video = videoRef.current;
const detector = detectorRef.current;

if (!video || !detector || video.readyState < 2) return;

const poses = await detector.estimatePoses(video, {
maxPoses: 1,
flipHorizontal: facingMode === "user",
});

const pose = poses[0];
const kpMap: Record<string, Point> = {};

if (pose?.keypoints?.length) {
for (const kp of pose.keypoints) {
const name = (kp.name ?? (kp as { part?: string }).part ?? "") as string;
if (!name) continue;
kpMap[name] = {
x: kp.x,
y: kp.y,
score: kp.score ?? 0,
};
}
}

const ls = kpMap.left_shoulder;
const rs = kpMap.right_shoulder;
const lh = kpMap.left_hip;
const rh = kpMap.right_hip;
const la = kpMap.left_ankle;
const ra = kpMap.right_ankle;

const shoulderPairOk = hasPair(ls, rs);
const hipPairOk = hasPair(lh, rh);
const anklePairOk = hasPair(la, ra);

const visibleCount = [
hasPoint(ls),
hasPoint(rs),
hasPoint(lh),
hasPoint(rh),
hasPoint(la),
hasPoint(ra),
].filter(Boolean).length;

const confidence =
(visibleCount / 6) * 70 +
(shoulderPairOk ? 10 : 0) +
(hipPairOk ? 10 : 0) +
(anklePairOk ? 10 : 0);

const presenceDetected =
visibleCount >= 3 || shoulderPairOk || hipPairOk;

const readDetected =
shoulderPairOk && hipPairOk && confidence >= READ_CONFIDENCE_MIN;

let metrics: FrameMetrics = {
axisCore: 0,
axisReady: 0,
alignment: 0,
stability: 0,
motion: 0,
confidence,
baseRatio: 0,
centerOffset: 0,
state: "LOST",
phase: "LOAD",
isTrue: false,
};

let guide = "FIND SUBJECT";
let center: { x: number; y: number } | null = null;
let axisAngleRad: number | null = null;

if (!presenceDetected) {
metrics.state = "LOST";
metrics.phase = "LOAD";
guide = "FIND SUBJECT";

smoothedAxisAngleRef.current = null;
smoothedCenterRef.current = null;
holdStartedAtRef.current = null;
holdLastGoodAtRef.current = null;
calibrationStartedAtRef.current = null;
calibrationSamplesRef.current = [];

setGuideText(guide);
setAxisState(metrics.state);
setTracePhase(metrics.phase);
setIsTrueMoment(false);
setAxisCore(0);
setAxisReady(0);
setAlignmentScore(0);
setStabilityScore(0);
setMotionScore(0);
setConfidenceScore(Math.round(confidence));

renderInstrument(null, null, null, metrics, guide, 0);
return;
}

if (!readDetected) {
metrics.state = "FIND SUBJECT";
metrics.phase = "LOAD";
guide = "FIND SUBJECT";

smoothedAxisAngleRef.current = null;
smoothedCenterRef.current = null;
holdStartedAtRef.current = null;
holdLastGoodAtRef.current = null;
calibrationStartedAtRef.current = null;
calibrationSamplesRef.current = [];

setGuideText(guide);
setAxisState(metrics.state);
setTracePhase(metrics.phase);
setIsTrueMoment(false);
setAxisCore(0);
setAxisReady(0);
setAlignmentScore(0);
setStabilityScore(0);
setMotionScore(0);
setConfidenceScore(Math.round(confidence));

renderInstrument(kpMap, null, null, metrics, guide, 0);
return;
}

const shoulderMid = midpoint(ls!, rs!);
const hipMid = midpoint(lh!, rh!);
const rawCenter = {
x: (shoulderMid.x + hipMid.x) / 2,
y: (shoulderMid.y + hipMid.y) / 2,
};

const dx = hipMid.x - shoulderMid.x;
const dy = hipMid.y - shoulderMid.y;
const rawAxisAngle = Math.atan2(dy, dx);

const smoothT =
confidence < 60 ? AXIS_LOW_CONFIDENCE_SMOOTH : AXIS_ANGLE_SMOOTH;

smoothedAxisAngleRef.current =
smoothedAxisAngleRef.current === null
? rawAxisAngle
: lerpAngle(smoothedAxisAngleRef.current, rawAxisAngle, smoothT);

const centerT =
confidence < 60 ? AXIS_LOW_CONFIDENCE_SMOOTH : AXIS_CENTER_SMOOTH;

smoothedCenterRef.current =
smoothedCenterRef.current === null
? rawCenter
: {
x: lerp(smoothedCenterRef.current.x, rawCenter.x, centerT),
y: lerp(smoothedCenterRef.current.y, rawCenter.y, centerT),
};

center = smoothedCenterRef.current;
axisAngleRad = smoothedAxisAngleRef.current;

const shoulderAngle = normalizeAngleAbs(angleDeg(ls!, rs!));
const hipAngle = normalizeAngleAbs(angleDeg(lh!, rh!));
const shoulderWidth = Math.max(distance(ls!, rs!), 1);
const hipWidth = Math.max(distance(lh!, rh!), 1);
const torsoHeight = Math.max(Math.abs(hipMid.y - shoulderMid.y), 1);
const torsoMidXNorm = rawCenter.x / Math.max(video.videoWidth, 1);
const torsoHeightNorm = torsoHeight / Math.max(video.videoHeight, 1);
const shoulderWidthNorm = shoulderWidth / Math.max(video.videoWidth, 1);
const hipWidthNorm = hipWidth / Math.max(video.videoWidth, 1);

let baseRatio: number | null = null;
let centerOffset = Math.abs(torsoMidXNorm - 0.5) / 0.24;

if (anklePairOk) {
const stanceWidth = Math.max(distance(la!, ra!), 1);
const footMid = midpoint(la!, ra!);
baseRatio = stanceWidth / hipWidth;
centerOffset = Math.abs(hipMid.x - footMid.x) / stanceWidth;
}

if (!baselineRef.current) {
if (calibrationStartedAtRef.current === null) {
calibrationStartedAtRef.current = now;
calibrationSamplesRef.current = [];
}

calibrationSamplesRef.current.push({
shoulderAngle,
hipAngle,
torsoMidXNorm,
torsoHeightNorm,
shoulderWidthNorm,
hipWidthNorm,
baseRatio,
});

const progress = clamp(
((now - calibrationStartedAtRef.current) / CALIBRATION_MS) * 100,
0,
100,
);

setCalibrationProgress(progress);

metrics.state = "FIND SUBJECT";
metrics.phase = "LOAD";
guide = "LOCK";

if (progress >= 100 && calibrationSamplesRef.current.length >= 12) {
baselineRef.current = buildBaseline(calibrationSamplesRef.current);
calibrationStartedAtRef.current = null;
calibrationSamplesRef.current = [];
}

setGuideText(guide);
setAxisState(metrics.state);
setTracePhase(metrics.phase);
setIsTrueMoment(false);
setAxisCore(0);
setAxisReady(0);
setAlignmentScore(0);
setStabilityScore(0);
setMotionScore(0);
setConfidenceScore(Math.round(confidence));

renderInstrument(kpMap, center, axisAngleRad, metrics, guide, progress);
return;
}

setCalibrationProgress(100);

const baseline = baselineRef.current;

const shoulderAngleDelta = Math.abs(shoulderAngle - baseline.shoulderAngle);
const hipAngleDelta = Math.abs(hipAngle - baseline.hipAngle);
const torsoXDelta = Math.abs(torsoMidXNorm - baseline.torsoMidXNorm);
const torsoHeightDelta = Math.abs(torsoHeightNorm - baseline.torsoHeightNorm);
const shoulderWidthDelta = Math.abs(shoulderWidthNorm - baseline.shoulderWidthNorm);
const hipWidthDelta = Math.abs(hipWidthNorm - baseline.hipWidthNorm);
const baseRatioDelta =
baseRatio !== null && baseline.baseRatio !== null
? Math.abs(baseRatio - baseline.baseRatio)
: null;

const alignment =
100 -
clamp(shoulderAngleDelta / 14, 0, 1) * 34 -
clamp(hipAngleDelta / 14, 0, 1) * 26 -
clamp(torsoXDelta / 0.12, 0, 1) * 18;

const stability =
100 -
clamp(centerOffset / 0.48, 0, 1) * 52 -
(baseRatio !== null && baseRatioDelta !== null
? clamp(baseRatioDelta / 0.45, 0, 1) * 18
: 8);

const centerVelocity =
lastCenterNormRef.current === null
? 0
: Math.abs(torsoMidXNorm - lastCenterNormRef.current);

lastCenterNormRef.current = torsoMidXNorm;

const motion =
100 -
clamp(torsoHeightDelta / 0.11, 0, 1) * 18 -
clamp(shoulderWidthDelta / 0.1, 0, 1) * 10 -
clamp(hipWidthDelta / 0.1, 0, 1) * 10 -
clamp(centerVelocity / 0.03, 0, 1) * 28;

const axisCore =
0.38 * clamp(alignment, 0, 100) +
0.34 * clamp(stability, 0, 100) +
0.28 * clamp(motion, 0, 100);

smoothedReadyRef.current =
smoothedReadyRef.current === 0
? axisCore
: smoothedReadyRef.current * 0.78 + axisCore * 0.22;

const axisReady = clamp(smoothedReadyRef.current, 0, 100);

/**
* Structural state
*/
let state: AxisState = "OFF AXIS";
if (axisReady >= LOCK_THRESHOLD) state = "LOCK";
else if (axisReady >= DROP_THRESHOLD) state = "DROP";
else if (axisReady >= SHIFT_THRESHOLD) state = "SHIFT";
else state = "OFF AXIS";

/**
* Event phase
*/
const holdCandidate =
axisReady >= HOLD_READY_MIN &&
motion >= HOLD_QUIET_MOTION_MIN &&
stability >= HOLD_STABILITY_MIN &&
alignment >= HOLD_ALIGNMENT_MIN;

if (holdCandidate) {
if (holdStartedAtRef.current === null) {
holdStartedAtRef.current = now;
}
holdLastGoodAtRef.current = now;
} else {
const graceExpired =
holdLastGoodAtRef.current === null ||
now - holdLastGoodAtRef.current > HOLD_DROP_GRACE_MS;

if (graceExpired) {
holdStartedAtRef.current = null;
holdLastGoodAtRef.current = null;
}
}

const holdDuration =
holdStartedAtRef.current === null ? 0 : now - holdStartedAtRef.current;

const holdConfirmed = holdDuration >= HOLD_MIN_MS;

let phase: TracePhase = "LOAD";
if (holdConfirmed) phase = "HOLD";

const releaseSignalCount =
(centerVelocity > RELEASE_CENTER_VELOCITY_MIN ? 1 : 0) +
(torsoHeightDelta > RELEASE_TORSO_HEIGHT_DELTA_MIN ? 1 : 0) +
(Math.max(shoulderAngleDelta, hipAngleDelta) > RELEASE_ANGLE_DELTA_MIN ? 1 : 0);

const releaseSignal = releaseSignalCount >= 2;
const releaseWindowOpen =
holdConfirmed && holdDuration >= RELEASE_MIN_FROM_HOLD_MS;
const releaseRefractoryClear =
now - lastReleaseAtRef.current > RELEASE_REFRACTORY_MS;

let isTrue = false;
const trueFlashActive = now < trueFlashUntilRef.current;

if (
releaseWindowOpen &&
releaseSignal &&
axisReady >= DROP_THRESHOLD &&
releaseRefractoryClear
) {
isTrue = true;
phase = "RELEASE";
trueFlashUntilRef.current = now + TRUE_FLASH_MS;
lastReleaseAtRef.current = now;
holdStartedAtRef.current = null;
holdLastGoodAtRef.current = null;
} else if (trueFlashActive) {
isTrue = true;
phase = "RELEASE";
}

metrics = {
axisCore,
axisReady,
alignment,
stability,
motion,
confidence,
baseRatio: baseRatio ?? 0,
centerOffset,
state,
phase,
isTrue,
};

guide =
state === "FIND SUBJECT"
? "FIND SUBJECT"
: phase === "RELEASE"
? "RELEASE"
: phase === "HOLD"
? "HOLD"
: "LOAD";

setGuideText(guide);
setAxisState(state);
setTracePhase(phase);
setIsTrueMoment(isTrue);
setAxisCore(Math.round(axisCore));
setAxisReady(Math.round(axisReady));
setAlignmentScore(Math.round(clamp(alignment, 0, 100)));
setStabilityScore(Math.round(clamp(stability, 0, 100)));
setMotionScore(Math.round(clamp(motion, 0, 100)));
setConfidenceScore(Math.round(confidence));

if (axisReady > bestReadyRef.current) {
bestReadyRef.current = axisReady;
}

if (
(isTrue || axisReady >= bestReadyRef.current - 0.5) &&
now - lastAutoCaptureAtRef.current > AUTO_CAPTURE_COOLDOWN_MS
) {
lastAutoCaptureAtRef.current = now;
void addCaptureFromExportCanvas(metrics);
}

renderInstrument(kpMap, center, axisAngleRad, metrics, guide, 100);
},
[addCaptureFromExportCanvas, facingMode, renderInstrument],
);

const loop = useCallback(async () => {
const now = performance.now();
try {
await analyzePose(now);
} catch (err) {
console.error("analyzePose error:", err);
setError(`Pose analysis failed: ${String(err)}`);
}
rafRef.current = requestAnimationFrame(loop);
}, [analyzePose]);

const stopLoop = useCallback(() => {
if (rafRef.current !== null) {
cancelAnimationFrame(rafRef.current);
rafRef.current = null;
}
}, []);

const stopCamera = useCallback(() => {
stopLoop();

if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
mediaRecorderRef.current.stop();
}

if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}

detectorRef.current?.dispose?.();
detectorRef.current = null;

setEnabled(false);
setReady(false);
}, [stopLoop]);

const startCamera = useCallback(async () => {
try {
setError("");
stopCamera();
resetSession();

if (!navigator.mediaDevices?.getUserMedia) {
throw new Error("This browser does not support camera access.");
}

await initTfBackend();

const stream = await navigator.mediaDevices.getUserMedia({
audio: false,
video: {
facingMode,
width: { ideal: 1080 },
height: { ideal: 1920 },
frameRate: { ideal: 30, max: 30 },
},
});

streamRef.current = stream;

const video = videoRef.current;
if (!video) throw new Error("Video element was not found.");

video.srcObject = stream;

await new Promise<void>((resolve, reject) => {
const onLoaded = () => {
video.onloadedmetadata = null;
video.onerror = null;
resolve();
};
const onError = () => {
video.onloadedmetadata = null;
video.onerror = null;
reject(new Error("Video metadata failed to load."));
};
video.onloadedmetadata = onLoaded;
video.onerror = onError;
});

await video.play();
syncCanvasSize();

const detector = await poseDetection.createDetector(
poseDetection.SupportedModels.MoveNet,
{
modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
enableSmoothing: true,
},
);

detectorRef.current = detector;
setEnabled(true);
setReady(true);

stopLoop();
rafRef.current = requestAnimationFrame(loop);
} catch (err) {
console.error("startCamera error:", err);
setError(`Camera or pose model failed to start: ${String(err)}`);
setEnabled(false);
setReady(false);

if (streamRef.current) {
streamRef.current.getTracks().forEach((track) => track.stop());
streamRef.current = null;
}
}
}, [facingMode, loop, resetSession, stopCamera, stopLoop, syncCanvasSize]);

useEffect(() => {
return () => {
stopCamera();
};
}, [stopCamera]);

useEffect(() => {
if (!enabled) return;
const handleResize = () => syncCanvasSize();
window.addEventListener("resize", handleResize);
return () => window.removeEventListener("resize", handleResize);
}, [enabled, syncCanvasSize]);

useEffect(() => {
if (!enabled) return;
void startCamera();
}, [facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

const flipCamera = useCallback(() => {
setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
}, []);

const manualMark = useCallback(async () => {
const canvas = exportCanvasRef.current;
if (!canvas) return;
const timestamp = Date.now();
const dataUrl = canvas.toDataURL("image/jpeg", 0.94);

setCaptures((prev) => [
{
id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
timestamp,
axisReady,
axisCore,
state: axisState,
phase: tracePhase,
isTrue: isTrueMoment,
dataUrl,
},
...prev,
]);
}, [axisCore, axisReady, axisState, isTrueMoment, tracePhase]);

const startRecording = useCallback(() => {
const exportCanvas = exportCanvasRef.current;
if (!exportCanvas || isRecording) return;

recordedChunksRef.current = [];
const stream = exportCanvas.captureStream(30);

let recorder: MediaRecorder;
try {
recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
} catch {
try {
recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
} catch {
setError("Recording is not supported on this device/browser.");
return;
}
}

recorder.ondataavailable = (event) => {
if (event.data.size > 0) recordedChunksRef.current.push(event.data);
};

recorder.onstop = () => {
const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
const url = URL.createObjectURL(blob);
setRecordedVideoUrl((prev) => {
if (prev) URL.revokeObjectURL(prev);
return url;
});
setIsRecording(false);
};

mediaRecorderRef.current = recorder;
recorder.start(250);
setIsRecording(true);
}, [isRecording]);

const stopRecording = useCallback(() => {
if (!mediaRecorderRef.current) return;
if (mediaRecorderRef.current.state !== "inactive") {
mediaRecorderRef.current.stop();
}
}, []);

const saveVideo = useCallback(async () => {
if (!recordedVideoUrl) return;
const res = await fetch(recordedVideoUrl);
const blob = await res.blob();
const filename = createFileName("VIDEO", axisReady, Date.now(), "webm");
await shareOrDownloadBlob(blob, filename);
}, [axisReady, recordedVideoUrl]);

const saveCapture = useCallback(async (capture: CaptureItem) => {
const blob = dataUrlToBlob(capture.dataUrl);
const filename = createFileName("FRAME", capture.axisReady, capture.timestamp, "jpg");
await shareOrDownloadBlob(blob, filename);
}, []);

const topCapture = captures[0];
const viewMode: ViewMode = isTrueMoment
? "TRUE"
: axisState === "LOST" || axisState === "FIND SUBJECT"
? "SCAN"
: "READ";

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
<div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur md:flex-row md:items-center">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Axis Core v1
</div>
<div className="mt-1 text-2xl font-semibold tracking-tight">
State decoupled from phase
</div>
<div className="mt-1 text-sm text-white/55">
Structural state on top. Event phase below.
</div>
</div>

<div className="flex flex-wrap gap-2">
{!enabled ? (
<button
onClick={() => void startCamera()}
className="rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90"
>
LOCK
</button>
) : (
<button
onClick={stopCamera}
className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
>
END
</button>
)}

<button
onClick={flipCamera}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
>
FLIP
</button>

{!isRecording ? (
<button
onClick={startRecording}
disabled={!enabled || !ready}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
>
RECORD
</button>
) : (
<button
onClick={stopRecording}
className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
>
STOP
</button>
)}

<button
onClick={() => void manualMark()}
disabled={!enabled}
className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
>
MARK
</button>
</div>
</div>

{error ? (
<div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
{error}
</div>
) : null}

<div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
<section className="overflow-hidden rounded-[28px] border border-white/10 bg-black">
<div className="relative aspect-[9/16] w-full bg-black">
<video
ref={videoRef}
playsInline
muted
autoPlay
className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
/>
<canvas ref={overlayCanvasRef} className="absolute inset-0 h-full w-full" />
<canvas ref={exportCanvasRef} className="hidden" />

<div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.25em] text-white/45">
State
</div>
<div className="mt-1 text-lg font-semibold">{axisState}</div>
</div>

<div className="pointer-events-none absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-right backdrop-blur">
<div className="text-[10px] uppercase tracking-[0.25em] text-white/45">
Phase
</div>
<div className="mt-1 text-lg font-semibold">{tracePhase}</div>
</div>
</div>
</section>

<aside className="flex flex-col gap-4">
<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Axis Read
</div>

<div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Axis Ready
</div>
<div className="mt-2 text-5xl font-semibold">
{viewMode === "SCAN" || guideText === "LOCK" ? "··" : axisReady}
</div>
<div className="mt-2 text-sm text-white/55">
{axisState} · {tracePhase}
</div>
</div>

<div className="mt-4 grid grid-cols-2 gap-3">
<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Axis Core
</div>
<div className="mt-2 text-2xl font-semibold">
{viewMode === "SCAN" || guideText === "LOCK" ? "·" : axisCore}
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Confidence
</div>
<div className="mt-2 text-2xl font-semibold">{confidenceScore}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Alignment
</div>
<div className="mt-2 text-2xl font-semibold">
{viewMode === "SCAN" || guideText === "LOCK" ? "·" : alignmentScore}
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Stability
</div>
<div className="mt-2 text-2xl font-semibold">
{viewMode === "SCAN" || guideText === "LOCK" ? "·" : stabilityScore}
</div>
</div>
</div>

<div className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
Motion
</div>
<div className="mt-2 text-2xl font-semibold">
{viewMode === "SCAN" || guideText === "LOCK" ? "·" : motionScore}
</div>
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="flex items-center justify-between">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Review
</div>
<div className="mt-1 text-sm text-white/55">
TRUE ◎ moments and marked frames.
</div>
</div>
</div>

{topCapture ? (
<div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
<img
src={topCapture.dataUrl}
alt="Axis capture"
className="aspect-[9/16] w-full object-cover"
/>
<div className="flex items-center justify-between gap-3 p-3">
<div>
<div className="text-sm font-semibold">
{topCapture.isTrue ? "TRUE ◎" : "MARK"}
</div>
<div className="text-xs text-white/50">
{topCapture.state} · {topCapture.phase} · READY {Math.round(topCapture.axisReady)}
</div>
</div>
<button
onClick={() => void saveCapture(topCapture)}
className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
>
SAVE
</button>
</div>
</div>
) : (
<div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-black/30 p-6 text-sm text-white/45">
Watch how structural state and phase separate now.
</div>
)}
</div>

<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
Recorded Feed
</div>

{recordedVideoUrl ? (
<div className="mt-4">
<video
src={recordedVideoUrl}
controls
className="w-full rounded-2xl border border-white/10"
/>
<button
onClick={() => void saveVideo()}
className="mt-3 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
>
SAVE VIDEO
</button>
</div>
) : (
<div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-black/30 p-6 text-sm text-white/45">
Record the instrument feed and review state/phase combinations.
</div>
)}
</div>
</aside>
</div>
</div>
</main>
);
}