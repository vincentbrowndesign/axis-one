"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AxisState = "NO_SIGNAL" | "READING" | "AXIS" | "LOST";

type PoseLike = {
cx: number;
cy: number;
shoulderWidth: number;
hipWidth: number;
torsoHeight: number;
shoulderTilt: number;
hipTilt: number;
stackOffset: number;
baseWidth: number;
};

type RepClip = {
id: string;
createdAt: number;
state: AxisState;
note: string;
url?: string;
};

const STATE_LABEL: Record<AxisState, string> = {
NO_SIGNAL: "NO SIGNAL",
READING: "READING",
AXIS: "AXIS",
LOST: "LOST",
};

const STATE_COLOR: Record<AxisState, string> = {
NO_SIGNAL: "#6B7280",
READING: "#F59E0B",
AXIS: "#22C55E",
LOST: "#EF4444",
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function mean(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function nowId() {
return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AxisLabPage() {
const videoRef = useRef<HTMLVideoElement | null>(null);
const overlayRef = useRef<HTMLCanvasElement | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const animationRef = useRef<number | null>(null);
const recorderRef = useRef<MediaRecorder | null>(null);
const recordedChunksRef = useRef<Blob[]>([]);
const manualStopTimeoutRef = useRef<number | null>(null);

const [enabled, setEnabled] = useState(false);
const [error, setError] = useState("");
const [state, setState] = useState<AxisState>("NO_SIGNAL");
const [signal, setSignal] = useState(0);
const [axisHold, setAxisHold] = useState(0);
const [reps, setReps] = useState<RepClip[]>([]);
const [lastClipUrl, setLastClipUrl] = useState("");
const [isRecording, setIsRecording] = useState(false);
const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

const signalHistoryRef = useRef<number[]>([]);

const meterBars = useMemo(() => {
const values = signalHistoryRef.current.slice(-36);
return values.map((value, index) => ({
id: `${index}-${value}`,
value,
color:
value < 15
? STATE_COLOR.NO_SIGNAL
: value < 60
? STATE_COLOR.READING
: value < 85
? "#84CC16"
: STATE_COLOR.AXIS,
}));
}, [signal, state]);

const stopLoop = () => {
if (animationRef.current) {
cancelAnimationFrame(animationRef.current);
animationRef.current = null;
}
};

const stopTracks = () => {
streamRef.current?.getTracks().forEach((track) => track.stop());
streamRef.current = null;
};

const stopCamera = () => {
stopLoop();
stopTracks();
const video = videoRef.current;
if (video) {
video.pause();
video.srcObject = null;
}
setEnabled(false);
};

const getMimeType = () => {
const candidates = [
"video/webm;codecs=vp9,opus",
"video/webm;codecs=vp8,opus",
"video/webm",
"video/mp4",
];
for (const type of candidates) {
if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
return type;
}
}
return "";
};

const saveManualClip = (note: string, clipState: AxisState) => {
const stream = streamRef.current;
if (!stream || typeof MediaRecorder === "undefined") {
setError("Recording unavailable on this device.");
return;
}

if (isRecording) return;

const mimeType = getMimeType();

try {
const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
recorderRef.current = recorder;
recordedChunksRef.current = [];

recorder.ondataavailable = (event) => {
if (event.data.size > 0) recordedChunksRef.current.push(event.data);
};

recorder.onstop = () => {
setIsRecording(false);

const blob = new Blob(recordedChunksRef.current, {
type: recorder.mimeType || mimeType || "video/webm",
});

if (!blob.size) return;

if (lastClipUrl) URL.revokeObjectURL(lastClipUrl);
const url = URL.createObjectURL(blob);
setLastClipUrl(url);

setReps((prev) => [
{
id: nowId(),
createdAt: Date.now(),
state: clipState,
note,
url,
},
...prev,
]);
};

recorder.onerror = () => {
setIsRecording(false);
setError("Clip recording failed.");
};

recorder.start(200);
setIsRecording(true);

if (manualStopTimeoutRef.current) {
window.clearTimeout(manualStopTimeoutRef.current);
}

manualStopTimeoutRef.current = window.setTimeout(() => {
if (recorder.state !== "inactive") recorder.stop();
}, 3000);
} catch {
setError("Clip recording could not start.");
}
};

const startCamera = async () => {
setError("");

try {
stopCamera();

const stream = await navigator.mediaDevices.getUserMedia({
audio: false,
video: {
facingMode,
width: { ideal: 1280 },
height: { ideal: 720 },
frameRate: { ideal: 30, max: 30 },
},
});

streamRef.current = stream;

const video = videoRef.current;
if (!video) throw new Error("Missing video");

video.srcObject = stream;
video.muted = true;
video.playsInline = true;
await video.play();

setEnabled(true);
} catch {
setError("Camera did not start. Check permissions and try again.");
}
};

const switchCamera = async () => {
setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
};

useEffect(() => {
if (!enabled) return;
void startCamera();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [facingMode]);

useEffect(() => {
return () => {
stopCamera();
if (lastClipUrl) URL.revokeObjectURL(lastClipUrl);
if (manualStopTimeoutRef.current) window.clearTimeout(manualStopTimeoutRef.current);
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

useEffect(() => {
if (!enabled) return;

const render = () => {
animationRef.current = requestAnimationFrame(render);

const video = videoRef.current;
const canvas = overlayRef.current;
if (!video || !canvas) return;
if (video.readyState < 2) return;

const width = video.videoWidth || 1280;
const height = video.videoHeight || 720;

canvas.width = width;
canvas.height = height;

const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.clearRect(0, 0, width, height);

/**
* This is a visual prototype page.
* No pose model here.
* We create a "pose like" instrument read from frame geometry and motion feel.
* It is intentionally simple so you can test the UI direction safely.
*/

const t = performance.now() / 1000;
const cx = width / 2 + Math.sin(t * 1.2) * 40;
const cy = height / 2 + Math.cos(t * 0.8) * 16;
const shoulderWidth = 150 + Math.sin(t * 1.1) * 10;
const hipWidth = 110 + Math.cos(t * 0.9) * 8;
const torsoHeight = 160 + Math.sin(t * 0.7) * 6;
const shoulderTilt = Math.sin(t * 1.7) * 5;
const hipTilt = Math.cos(t * 1.4) * 4;
const stackOffset = Math.abs(Math.sin(t * 1.5)) * 18;
const baseWidth = 120 + Math.cos(t * 1.3) * 10;

const poseLike: PoseLike = {
cx,
cy,
shoulderWidth,
hipWidth,
torsoHeight,
shoulderTilt,
hipTilt,
stackOffset,
baseWidth,
};

const shoulderLevel = clamp(100 - Math.abs(poseLike.shoulderTilt) * 8, 0, 100);
const hipLevel = clamp(100 - Math.abs(poseLike.hipTilt) * 8, 0, 100);
const stackCentered = clamp(100 - poseLike.stackOffset * 4, 0, 100);
const torsoStable = clamp(75 + Math.sin(t * 0.6) * 18, 0, 100);

const nextSignal = Math.round(
shoulderLevel * 0.22 +
hipLevel * 0.18 +
stackCentered * 0.42 +
torsoStable * 0.18,
);

let nextState: AxisState = "NO_SIGNAL";
if (nextSignal < 18) nextState = "NO_SIGNAL";
else if (nextSignal < 72) nextState = "READING";
else if (nextSignal < 92) nextState = "AXIS";
else nextState = "LOST";

const nextAxisHold = nextState === "AXIS" ? clamp(axisHold + 4, 0, 100) : clamp(axisHold - 6, 0, 100);

setSignal(nextSignal);
setState(nextState);
setAxisHold(nextAxisHold);

signalHistoryRef.current = [...signalHistoryRef.current, nextSignal].slice(-48);

// Camera field grid
ctx.save();
ctx.strokeStyle = "rgba(255,255,255,0.06)";
ctx.lineWidth = 1;
for (let x = 0; x <= width; x += Math.round(width / 8)) {
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, height);
ctx.stroke();
}
for (let y = 0; y <= height; y += Math.round(height / 6)) {
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(width, y);
ctx.stroke();
}
ctx.restore();

// Center stoplight meter track
const trackY = height * 0.83;
const left = width * 0.12;
const right = width * 0.88;
const center = width * 0.5;

ctx.save();
ctx.lineWidth = 10;
ctx.lineCap = "round";

ctx.strokeStyle = "rgba(239,68,68,0.35)";
ctx.beginPath();
ctx.moveTo(left, trackY);
ctx.lineTo(left + (center - left) * 0.55, trackY);
ctx.stroke();

ctx.strokeStyle = "rgba(245,158,11,0.4)";
ctx.beginPath();
ctx.moveTo(left + (center - left) * 0.55, trackY);
ctx.lineTo(center, trackY);
ctx.stroke();

ctx.strokeStyle = "rgba(34,197,94,0.85)";
ctx.beginPath();
ctx.moveTo(center - 24, trackY);
ctx.lineTo(center + 24, trackY);
ctx.stroke();

ctx.strokeStyle = "rgba(245,158,11,0.4)";
ctx.beginPath();
ctx.moveTo(center, trackY);
ctx.lineTo(right - (right - center) * 0.55, trackY);
ctx.stroke();

ctx.strokeStyle = "rgba(239,68,68,0.35)";
ctx.beginPath();
ctx.moveTo(right - (right - center) * 0.55, trackY);
ctx.lineTo(right, trackY);
ctx.stroke();
ctx.restore();

// Pulse position
const normalized = clamp((nextSignal - 15) / 70, 0, 1);
const pulseX = left + (right - left) * normalized;

ctx.save();
ctx.fillStyle = STATE_COLOR[nextState];
ctx.shadowBlur = nextState === "AXIS" ? 28 : 16;
ctx.shadowColor = STATE_COLOR[nextState];
ctx.beginPath();
ctx.arc(pulseX, trackY, nextState === "AXIS" ? 11 : 8, 0, Math.PI * 2);
ctx.fill();
ctx.restore();

// AXIS center flare
if (nextState === "AXIS") {
ctx.save();
ctx.strokeStyle = "rgba(34,197,94,0.75)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.arc(center, trackY, 26 + (nextAxisHold / 100) * 18, 0, Math.PI * 2);
ctx.stroke();
ctx.restore();
}

// Primary glass panel
ctx.save();
ctx.fillStyle = "rgba(0,0,0,0.48)";
ctx.fillRect(24, 24, 250, 84);
ctx.fillStyle = "rgba(255,255,255,0.55)";
ctx.font = "600 14px Inter, system-ui, sans-serif";
ctx.fillText("AXIS INSTRUMENT", 40, 52);
ctx.fillStyle = STATE_COLOR[nextState];
ctx.font = "700 30px Inter, system-ui, sans-serif";
ctx.fillText(STATE_LABEL[nextState], 40, 86);
ctx.restore();

// Body stack prototype
const shoulderY = cy - torsoHeight / 2;
const hipY = cy + torsoHeight / 6;
const baseY = cy + torsoHeight / 1.45;

ctx.save();
ctx.strokeStyle = STATE_COLOR[nextState];
ctx.lineWidth = 4;
ctx.lineCap = "round";

// head stack
ctx.beginPath();
ctx.arc(cx, shoulderY - 54, 18, 0, Math.PI * 2);
ctx.stroke();

// torso stack
ctx.beginPath();
ctx.moveTo(cx - shoulderWidth / 2, shoulderY - shoulderTilt);
ctx.lineTo(cx + shoulderWidth / 2, shoulderY + shoulderTilt);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(cx, shoulderY);
ctx.lineTo(cx + poseLike.stackOffset * 0.15, hipY);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(cx - hipWidth / 2, hipY - hipTilt);
ctx.lineTo(cx + hipWidth / 2, hipY + hipTilt);
ctx.stroke();

// base stack
ctx.beginPath();
ctx.moveTo(cx - baseWidth / 2, baseY);
ctx.lineTo(cx + baseWidth / 2, baseY);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(cx - 18, hipY);
ctx.lineTo(cx - 36, baseY);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(cx + 18, hipY);
ctx.lineTo(cx + 36, baseY);
ctx.stroke();

ctx.restore();
};

animationRef.current = requestAnimationFrame(render);

return () => stopLoop();
}, [axisHold, enabled]);

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
<div>
<div className="text-xs uppercase tracking-[0.28em] text-white/40">Axis Lab</div>
<h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">
Experimental Instrument Page
</h1>
<p className="mt-2 max-w-3xl text-sm text-white/60 md:text-base">
Safe sandbox page. This does not replace your frozen instrument component.
</p>
</div>

<div className="flex flex-wrap gap-3">
<button
onClick={() => (enabled ? stopCamera() : void startCamera())}
className="rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-black"
>
{enabled ? "Stop Camera" : "Start Camera"}
</button>

<button
onClick={() => void switchCamera()}
disabled={!enabled}
className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
>
Switch Camera
</button>

<button
onClick={() => saveManualClip("Manual lab clip saved.", state)}
disabled={!enabled || isRecording}
className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
>
{isRecording ? "Recording Clip" : "Clip Rep"}
</button>
</div>
</div>

{error ? (
<div className="rounded-[24px] border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100">
{error}
</div>
) : null}

<div className="grid gap-6 lg:grid-cols-[1.45fr_0.55fr]">
<div className="overflow-hidden rounded-[32px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
<div className="relative aspect-video bg-black">
<video
ref={videoRef}
className={`absolute inset-0 h-full w-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
autoPlay
muted
playsInline
/>
<canvas
ref={overlayRef}
className={`absolute inset-0 h-full w-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
/>

<div className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 backdrop-blur-md">
<div className="text-[10px] uppercase tracking-[0.24em] text-white/45">State</div>
<div className="mt-1 text-2xl font-semibold" style={{ color: STATE_COLOR[state] }}>
{STATE_LABEL[state]}
</div>
</div>

<div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-center">
<div
className="text-5xl font-semibold tracking-tight"
style={{ color: STATE_COLOR[state], textShadow: `0 0 24px ${STATE_COLOR[state]}` }}
>
{state === "AXIS" ? "AXIS" : ""}
</div>
</div>

<div className="absolute inset-x-4 bottom-4 rounded-[26px] border border-white/10 bg-black/60 p-4 backdrop-blur-md">
<div className="mb-3 flex items-center justify-between">
<div>
<div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Signal Field</div>
<div className="mt-1 text-sm text-white/75">
Stoplight instrument experiment
</div>
</div>
<div
className={`rounded-full px-3 py-1 text-xs font-semibold ${
isRecording ? "bg-red-500/12 text-red-200" : "bg-white/6 text-white/55"
}`}
>
{isRecording ? "Recording" : "Idle"}
</div>
</div>

<div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-3">
<div className="flex h-20 items-end gap-[4px] overflow-hidden rounded-[18px] bg-gradient-to-b from-white/[0.03] to-white/[0.01] px-2 py-2">
{meterBars.length ? (
meterBars.map((bar) => (
<div
key={bar.id}
className="min-w-[8px] flex-1 rounded-full transition-all duration-150"
style={{
height: `${clamp(bar.value, 8, 100)}%`,
backgroundColor: bar.color,
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
Instrument Vocabulary
</div>
<div className="mt-4 grid grid-cols-2 gap-3">
{(["NO_SIGNAL", "READING", "AXIS", "LOST"] as AxisState[]).map((s) => (
<div
key={s}
className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3"
>
<div
className="text-lg font-semibold"
style={{ color: STATE_COLOR[s] }}
>
{STATE_LABEL[s]}
</div>
</div>
))}
</div>
</div>

<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Replay</div>
{lastClipUrl ? (
<div className="mt-4 overflow-hidden rounded-[22px] border border-white/10 bg-black">
<video src={lastClipUrl} controls className="aspect-video w-full" />
</div>
) : (
<div className="mt-4 rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
Use Clip Rep to save a raw camera test clip from this lab page.
</div>
)}
</div>

<div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">Recent Clips</div>
<div className="mt-4 space-y-3">
{reps.length ? (
reps.map((rep) => (
<div
key={rep.id}
className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4"
>
<div className="flex items-center justify-between gap-3">
<div
className="text-sm font-semibold"
style={{ color: STATE_COLOR[rep.state] }}
>
{STATE_LABEL[rep.state]}
</div>
<div className="text-xs text-white/45">
{new Date(rep.createdAt).toLocaleTimeString()}
</div>
</div>
<div className="mt-2 text-sm text-white/70">{rep.note}</div>
</div>
))
) : (
<div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
No clips captured yet.
</div>
)}
</div>
</div>
</div>
</div>
</div>
</main>
);
}