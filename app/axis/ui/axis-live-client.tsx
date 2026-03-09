"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
AxisFrame,
AxisHistoryItem,
AxisState,
buildHistoryLabel,
classifyAxisState,
computeStability,
createHistoryItem,
detectPushDirection,
formatTime,
isAxisLock,
normalizeTilt,
smoothAxis,
} from "@/lib/axis-core";

type SignalPoint = {
x: number;
y: number;
state: AxisState;
locked: boolean;
time: number;
};

declare global {
interface DeviceOrientationEvent {
requestPermission?: () => Promise<"granted" | "denied">;
}
}

const HISTORY_LIMIT = 10;
const SIGNAL_LIMIT = 64;

function cn(...parts: Array<string | false | null | undefined>) {
return parts.filter(Boolean).join(" ");
}

function scoreTone(score: number) {
if (score >= 95) {
return {
ring: "rgba(76, 255, 126, 0.95)",
glow: "0 0 22px rgba(76,255,126,0.35)",
text: "text-emerald-300",
border: "border-emerald-400/40",
};
}
if (score >= 85) {
return {
ring: "rgba(255,255,255,0.96)",
glow: "0 0 18px rgba(255,255,255,0.18)",
text: "text-white",
border: "border-white/20",
};
}
if (score >= 70) {
return {
ring: "rgba(255, 191, 71, 0.96)",
glow: "0 0 18px rgba(255,191,71,0.22)",
text: "text-amber-300",
border: "border-amber-400/35",
};
}
return {
ring: "rgba(255, 90, 90, 0.96)",
glow: "0 0 18px rgba(255,90,90,0.22)",
text: "text-rose-300",
border: "border-rose-400/35",
};
}

function stateAccent(state: AxisState) {
switch (state) {
case "CENTERED":
return "text-emerald-300";
case "FLOAT":
return "text-white";
case "DROP":
return "text-amber-300";
case "SHIFT":
return "text-sky-300";
case "OFF AXIS":
return "text-rose-300";
default:
return "text-white";
}
}

function buildSignalPath(points: SignalPoint[], width: number, height: number) {
if (!points.length) return "";
return points
.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
.join(" ");
}

export default function AxisLiveClient() {
const [permissionState, setPermissionState] = useState<
"idle" | "granted" | "denied" | "unsupported"
>("idle");
const [isLive, setIsLive] = useState(false);
const [history, setHistory] = useState<AxisHistoryItem[]>([]);
const [signal, setSignal] = useState<SignalPoint[]>([]);
const [sweepDeg, setSweepDeg] = useState(0);

const rawRef = useRef({ x: 0, y: 0 });
const smoothRef = useRef({ x: 0, y: 0 });
const previousSmoothRef = useRef({ x: 0, y: 0 });
const holdStartRef = useRef<number | null>(null);
const lockCooldownRef = useRef(0);
const frameRef = useRef<AxisFrame | null>(null);
const simulationRef = useRef(0);
const rafRef = useRef<number | null>(null);

const current = frameRef.current;

const tone = useMemo(
() => scoreTone(current?.stability ?? 0),
[current?.stability],
);

useEffect(() => {
const onOrientation = (event: DeviceOrientationEvent) => {
const beta = typeof event.beta === "number" ? event.beta : 0;
const gamma = typeof event.gamma === "number" ? event.gamma : 0;
rawRef.current = normalizeTilt(beta, gamma);
};

if (permissionState !== "granted") return;

window.addEventListener("deviceorientation", onOrientation, true);
return () => window.removeEventListener("deviceorientation", onOrientation, true);
}, [permissionState]);

useEffect(() => {
if (!isLive) {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
return;
}

const loop = (time: number) => {
setSweepDeg((prev) => (prev + 1.6) % 360);

// fallback simulation when orientation stream is missing or unsupported
if (permissionState !== "granted") {
simulationRef.current += 0.018;
rawRef.current = {
x:
Math.sin(simulationRef.current) * 0.45 +
Math.sin(simulationRef.current * 0.61) * 0.12,
y:
Math.cos(simulationRef.current * 0.83) * 0.42 +
Math.sin(simulationRef.current * 0.37) * 0.1,
};
}

const previous = smoothRef.current;
const smoothed = smoothAxis(previous, rawRef.current, 0.18);
previousSmoothRef.current = previous;
smoothRef.current = smoothed;

const velocityX = smoothed.x - previous.x;
const velocityY = smoothed.y - previous.y;
const stability = computeStability(
smoothed.x,
smoothed.y,
velocityX,
velocityY,
);
const state = classifyAxisState(smoothed.x, smoothed.y, stability);
const direction = detectPushDirection(smoothed.x, smoothed.y);

if (stability >= 90) {
if (holdStartRef.current === null) holdStartRef.current = time;
} else {
holdStartRef.current = null;
}

const holdMs = holdStartRef.current ? time - holdStartRef.current : 0;
const locked = isAxisLock(stability, holdMs);

const nextFrame: AxisFrame = {
time: Date.now(),
rawX: rawRef.current.x,
rawY: rawRef.current.y,
smoothX: smoothed.x,
smoothY: smoothed.y,
magnitude: Math.sqrt(smoothed.x * smoothed.x + smoothed.y * smoothed.y),
stability,
state,
direction,
locked,
};

frameRef.current = nextFrame;

setSignal((prev) => {
const width = 720;
const height = 140;
const shifted = prev
.map((p) => ({ ...p, x: p.x - width / SIGNAL_LIMIT }))
.filter((p) => p.x > 0);

const y = height - (stability / 100) * (height - 16) - 8;

const appended = [
...shifted,
{
x: width - 4,
y,
state,
locked,
time: nextFrame.time,
},
];

return appended.slice(-SIGNAL_LIMIT);
});

if (locked && time - lockCooldownRef.current > 950) {
lockCooldownRef.current = time;
const item = createHistoryItem(nextFrame);
setHistory((prev) => [item, ...prev].slice(0, HISTORY_LIMIT));
}

rafRef.current = requestAnimationFrame(loop);
};

rafRef.current = requestAnimationFrame(loop);
return () => {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
};
}, [isLive, permissionState]);

async function enableMotion() {
try {
if (typeof window === "undefined") return;

if (
typeof DeviceOrientationEvent !== "undefined" &&
typeof DeviceOrientationEvent.requestPermission === "function"
) {
const result = await DeviceOrientationEvent.requestPermission();
if (result === "granted") {
setPermissionState("granted");
setIsLive(true);
} else {
setPermissionState("denied");
}
return;
}

if ("DeviceOrientationEvent" in window) {
setPermissionState("granted");
setIsLive(true);
return;
}

setPermissionState("unsupported");
setIsLive(true);
} catch {
setPermissionState("denied");
}
}

function endSession() {
setIsLive(false);
}

function clearSession() {
setHistory([]);
setSignal([]);
holdStartRef.current = null;
lockCooldownRef.current = 0;
}

const displayState = current?.state ?? "CENTERED";
const displayScore = current?.stability ?? 0;
const displayDirection = current?.direction ?? "CENTER";
const displayX = current?.smoothX ?? 0;
const displayY = current?.smoothY ?? 0;
const isLocked = current?.locked ?? false;

const scopeSize = 320;
const center = scopeSize / 2;
const maxRadius = 108;
const dotX = center + displayX * maxRadius;
const dotY = center + displayY * maxRadius;
const sweepAngle = sweepDeg - 90;
const sweepRadians = (sweepAngle * Math.PI) / 180;
const sweepX = center + Math.cos(sweepRadians) * 124;
const sweepY = center + Math.sin(sweepRadians) * 124;

const circumference = 2 * Math.PI * 136;
const fill = Math.max(0, Math.min(100, displayScore));
const dashOffset = circumference * (1 - fill / 100);

const signalPath = buildSignalPath(signal, 720, 140);

return (
<div className="min-h-screen bg-[#05070a] text-white">
<div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
<div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
{/* LEFT COLUMN */}
<div className="flex flex-col gap-5">
{/* STATE */}
<section
className={cn(
"relative overflow-hidden rounded-[28px] border bg-white/[0.03] p-5 backdrop-blur-xl md:p-6",
tone.border,
)}
>
<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_55%)]" />
<div className="relative flex items-start justify-between gap-4">
<div>
<div className="mb-2 text-[11px] font-medium uppercase tracking-[0.28em] text-white/45">
Axis State
</div>
<div
className={cn(
"text-4xl font-semibold tracking-tight md:text-6xl",
stateAccent(displayState),
)}
style={{ textShadow: isLocked ? tone.glow : "none" }}
>
{displayState}
</div>
<div className="mt-2 text-sm text-white/55 md:text-base">
{buildHistoryLabel(displayState, displayDirection)}
</div>
</div>

<div className="text-right">
<div className="text-[11px] uppercase tracking-[0.28em] text-white/40">
Axis Lock
</div>
<div
className="mt-2 text-4xl font-semibold md:text-6xl"
style={{
color: tone.ring,
textShadow: isLocked ? tone.glow : "none",
}}
>
{displayScore}
</div>
<div className="mt-2 text-sm text-white/50">
{isLocked ? "Structure locked" : "Scanning structure"}
</div>
</div>
</div>
</section>

{/* SCOPE */}
<section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:p-6">
<div className="mb-4 flex items-center justify-between">
<div>
<div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
Axis Scope
</div>
<div className="mt-1 text-sm text-white/55">
AXIS STRUCTURE FIELD
</div>
</div>
<div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/60">
{isLive ? "Live" : "Idle"}
</div>
</div>

<div className="relative mx-auto aspect-square w-full max-w-[360px]">
<svg
viewBox={`0 0 ${scopeSize} ${scopeSize}`}
className="h-full w-full"
>
<defs>
<radialGradient id="scopeGlow" cx="50%" cy="50%" r="50%">
<stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
<stop offset="70%" stopColor="rgba(255,255,255,0.02)" />
<stop offset="100%" stopColor="rgba(255,255,255,0)" />
</radialGradient>

<linearGradient id="sweepGradient" x1="0%" y1="0%" x2="100%" y2="0%">
<stop offset="0%" stopColor="rgba(255,255,255,0.00)" />
<stop offset="100%" stopColor="rgba(255,255,255,0.22)" />
</linearGradient>
</defs>

<circle cx={center} cy={center} r="150" fill="url(#scopeGlow)" />

{/* Stability ring */}
<circle
cx={center}
cy={center}
r="136"
fill="none"
stroke="rgba(255,255,255,0.08)"
strokeWidth="12"
/>
<circle
cx={center}
cy={center}
r="136"
fill="none"
stroke={tone.ring}
strokeWidth="12"
strokeLinecap="round"
strokeDasharray={circumference}
strokeDashoffset={dashOffset}
transform={`rotate(-90 ${center} ${center})`}
style={{
filter: isLocked ? `drop-shadow(${tone.glow})` : "none",
transition:
"stroke-dashoffset 160ms linear, stroke 160ms linear, filter 160ms linear",
}}
/>

{/* Radar rings */}
{[108, 76, 42].map((r) => (
<circle
key={r}
cx={center}
cy={center}
r={r}
fill="none"
stroke="rgba(255,255,255,0.10)"
strokeWidth="1"
/>
))}

{/* Crosshair */}
<line
x1={center}
y1={36}
x2={center}
y2={scopeSize - 36}
stroke="rgba(255,255,255,0.12)"
strokeWidth="1"
/>
<line
x1={36}
y1={center}
x2={scopeSize - 36}
y2={center}
stroke="rgba(255,255,255,0.12)"
strokeWidth="1"
/>

{/* Sweep */}
<line
x1={center}
y1={center}
x2={sweepX}
y2={sweepY}
stroke="url(#sweepGradient)"
strokeWidth="2"
style={{
filter: "drop-shadow(0 0 14px rgba(255,255,255,0.10))",
}}
/>

{/* Center point */}
<circle
cx={center}
cy={center}
r="4.5"
fill="rgba(255,255,255,0.85)"
/>

{/* Lock pulse */}
{isLocked && (
<circle
cx={center}
cy={center}
r="108"
fill="none"
stroke={tone.ring}
strokeWidth="1.4"
opacity="0.7"
style={{
filter: `drop-shadow(${tone.glow})`,
}}
/>
)}

{/* Structure dot */}
<circle
cx={dotX}
cy={dotY}
r={isLocked ? 12 : 9}
fill={tone.ring}
style={{
filter: isLocked ? `drop-shadow(${tone.glow})` : "none",
transition:
"cx 90ms linear, cy 90ms linear, r 120ms ease, filter 120ms ease",
}}
/>
</svg>

<div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] uppercase tracking-[0.26em] text-white/36">
Structure Field
</div>
</div>

<div className="mt-4 grid grid-cols-3 gap-3">
<StatChip label="X Axis" value={displayX.toFixed(2)} />
<StatChip label="Y Axis" value={displayY.toFixed(2)} />
<StatChip label="Direction" value={displayDirection} />
</div>
</section>

{/* LINE */}
<section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:p-5">
<div className="mb-4 flex items-center justify-between">
<div>
<div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
Axis Line
</div>
<div className="mt-1 text-sm text-white/55">
Structure over time
</div>
</div>

<div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/50">
{signal.length} frames
</div>
</div>

<div className="overflow-hidden rounded-[20px] border border-white/8 bg-[#07090d] p-3">
<svg viewBox="0 0 720 140" className="h-[160px] w-full">
<defs>
<linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
<stop offset="0%" stopColor="rgba(255,255,255,0.20)" />
<stop offset="100%" stopColor={tone.ring} />
</linearGradient>
</defs>

{[20, 50, 80, 110].map((y) => (
<line
key={y}
x1="0"
y1={y}
x2="720"
y2={y}
stroke="rgba(255,255,255,0.06)"
strokeWidth="1"
/>
))}

<path
d={signalPath}
fill="none"
stroke="url(#lineGradient)"
strokeWidth="3"
strokeLinecap="round"
strokeLinejoin="round"
/>

{signal
.filter((p) => p.locked)
.map((p, i) => (
<g key={`${p.time}-${i}`}>
<line
x1={p.x}
y1={130}
x2={p.x}
y2={18}
stroke="rgba(255,255,255,0.16)"
strokeWidth="1"
strokeDasharray="4 5"
/>
<circle cx={p.x} cy={p.y} r="4" fill={tone.ring} />
</g>
))}
</svg>
</div>
</section>
</div>

{/* RIGHT COLUMN */}
<div className="flex flex-col gap-5">
{/* LOCK + CONTROLS */}
<section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
<div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
Axis Lock
</div>
<div className="mt-2 text-sm text-white/55">
Stability above 90 held for 420ms
</div>

<div className="mt-5 rounded-[24px] border border-white/8 bg-[#07090d] p-5">
<div className="flex items-center justify-between">
<div className="text-sm uppercase tracking-[0.24em] text-white/40">
Lock State
</div>
<div
className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.24em]"
style={{
color: tone.ring,
border: `1px solid ${tone.ring}33`,
boxShadow: isLocked ? tone.glow : "none",
}}
>
{isLocked ? "Locked" : "Scanning"}
</div>
</div>

<div className="mt-5 grid gap-3">
<button
onClick={enableMotion}
className="rounded-2xl border border-white/12 bg-white/8 px-4 py-4 text-left transition hover:bg-white/12"
>
<div className="text-xs uppercase tracking-[0.24em] text-white/45">
Motion
</div>
<div className="mt-1 text-lg font-medium">
{permissionState === "granted"
? "Permission granted"
: permissionState === "denied"
? "Permission denied"
: permissionState === "unsupported"
? "Simulation mode"
: "Enable motion"}
</div>
</button>

<div className="grid grid-cols-2 gap-3">
<button
onClick={() => setIsLive(true)}
className="rounded-2xl border border-white/12 bg-white/6 px-4 py-4 text-left transition hover:bg-white/10"
>
<div className="text-xs uppercase tracking-[0.24em] text-white/45">
Live
</div>
<div className="mt-1 text-lg font-medium">Start</div>
</button>

<button
onClick={endSession}
className="rounded-2xl border border-white/12 bg-white/6 px-4 py-4 text-left transition hover:bg-white/10"
>
<div className="text-xs uppercase tracking-[0.24em] text-white/45">
Session
</div>
<div className="mt-1 text-lg font-medium">End</div>
</button>
</div>

<button
onClick={clearSession}
className="rounded-2xl border border-white/12 bg-white/6 px-4 py-4 text-left transition hover:bg-white/10"
>
<div className="text-xs uppercase tracking-[0.24em] text-white/45">
Axis History
</div>
<div className="mt-1 text-lg font-medium">Clear session</div>
</button>
</div>
</div>
</section>

{/* BRAIN */}
<section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
<div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
Axis Brain
</div>
<div className="mt-2 text-sm text-white/55">
Live interpretation of structure during decision
</div>

<div className="mt-5 grid gap-3">
<InsightRow label="Primary state" value={displayState} />
<InsightRow label="Direction" value={displayDirection} />
<InsightRow
label="Read"
value={
isLocked
? "Decision window open"
: displayScore >= 80
? "Approaching lock"
: "Searching structure"
}
/>
<InsightRow
label="Signal"
value={
displayState === "CENTERED"
? "Balanced and organized"
: displayState === "FLOAT"
? "Stable with controlled drift"
: displayState === "DROP"
? "Forward load increasing"
: displayState === "SHIFT"
? "Lateral transfer active"
: "Structure breaking"
}
/>
</div>
</section>

{/* HISTORY */}
<section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
<div className="flex items-center justify-between">
<div>
<div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
Axis History
</div>
<div className="mt-1 text-sm text-white/55">
Auto-logged on lock
</div>
</div>
<div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/50">
{history.length} items
</div>
</div>

<div className="mt-4 space-y-3">
{history.length === 0 ? (
<div className="rounded-[22px] border border-dashed border-white/12 bg-[#07090d] px-4 py-8 text-center text-sm text-white/42">
No locked windows yet. Start live sensing and hold structure to create Axis History.
</div>
) : (
history.map((item) => (
<div
key={item.id}
className="rounded-[22px] border border-white/8 bg-[#07090d] px-4 py-4"
>
<div className="flex items-start justify-between gap-3">
<div>
<div
className={cn(
"text-base font-semibold",
stateAccent(item.state),
)}
>
{item.state}
</div>
<div className="mt-1 text-sm text-white/55">
{item.direction === "CENTER" ? "Center" : item.direction}
</div>
</div>

<div className="text-right">
<div
className="text-xl font-semibold"
style={{ color: scoreTone(item.stability).ring }}
>
{item.stability}
</div>
<div className="text-xs text-white/40">
{formatTime(item.time)}
</div>
</div>
</div>
</div>
))
)}
</div>
</section>
</div>
</div>
</div>
</div>
);
}

function StatChip({ label, value }: { label: string; value: string }) {
return (
<div className="rounded-[18px] border border-white/8 bg-[#07090d] px-4 py-3">
<div className="text-[10px] uppercase tracking-[0.24em] text-white/38">
{label}
</div>
<div className="mt-1 truncate text-sm font-medium text-white/82">{value}</div>
</div>
);
}

function InsightRow({ label, value }: { label: string; value: string }) {
return (
<div className="flex items-start justify-between gap-4 rounded-[18px] border border-white/8 bg-[#07090d] px-4 py-3">
<div className="text-[10px] uppercase tracking-[0.24em] text-white/38">
{label}
</div>
<div className="max-w-[65%] text-right text-sm text-white/82">{value}</div>
</div>
);
}