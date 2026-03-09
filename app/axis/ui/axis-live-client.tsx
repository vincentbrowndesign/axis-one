"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
type AxisFrame,
type AxisHistoryItem,
type AxisState,
buildHistoryLabel,
classifyAxisState,
computeStability,
createHistoryItem,
detectPushDirection,
formatTime,
isAxisLock,
normalizeTilt,
smoothAxis,
} from "../../../lib/axis-core";

type SignalPoint = {
x: number;
y: number;
state: AxisState;
locked: boolean;
time: number;
};

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
softBg: "bg-emerald-400/10",
};
}
if (score >= 85) {
return {
ring: "rgba(255,255,255,0.96)",
glow: "0 0 18px rgba(255,255,255,0.18)",
text: "text-white",
border: "border-white/20",
softBg: "bg-white/10",
};
}
if (score >= 70) {
return {
ring: "rgba(255, 191, 71, 0.96)",
glow: "0 0 18px rgba(255,191,71,0.22)",
text: "text-amber-300",
border: "border-amber-400/35",
softBg: "bg-amber-400/10",
};
}
return {
ring: "rgba(255, 90, 90, 0.96)",
glow: "0 0 18px rgba(255,90,90,0.22)",
text: "text-rose-300",
border: "border-rose-400/35",
softBg: "bg-rose-400/10",
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

function buildSignalPath(points: SignalPoint[]) {
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
const [panel, setPanel] = useState<"brain" | "history">("brain");
const [history, setHistory] = useState<AxisHistoryItem[]>([]);
const [signal, setSignal] = useState<SignalPoint[]>([]);
const [sweepDeg, setSweepDeg] = useState(0);
const [, forceRender] = useState(0);

const rawRef = useRef({ x: 0, y: 0 });
const smoothRef = useRef({ x: 0, y: 0 });
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

forceRender((v) => v + 1);
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

const OrientationEventWithPermission = DeviceOrientationEvent as any;

if (
typeof DeviceOrientationEvent !== "undefined" &&
typeof OrientationEventWithPermission.requestPermission === "function"
) {
const result = await OrientationEventWithPermission.requestPermission();

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

const signalPath = buildSignalPath(signal);

return (
<div className="min-h-screen bg-[#05070a] text-white">
<div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-3 sm:px-4 md:gap-5 md:px-6 lg:px-8">
<div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:gap-5">
<div className="flex flex-col gap-4 md:gap-5">
<section
className={cn(
"relative overflow-hidden rounded-[24px] border bg-white/[0.03] p-4 backdrop-blur-xl md:rounded-[28px] md:p-6",
tone.border,
)}
>
<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_55%)]" />
<div className="relative flex items-center justify-between gap-4">
<div className="min-w-0">
<div className="mb-1 text-[10px] font-medium uppercase tracking-[0.26em] text-white/45 md:mb-2 md:text-[11px] md:tracking-[0.28em]">
Axis State
</div>
<div
className={cn(
"truncate text-3xl font-semibold tracking-tight md:text-5xl",
stateAccent(displayState),
)}
style={{ textShadow: isLocked ? tone.glow : "none" }}
>
{displayState}
</div>
<div className="mt-1 text-sm text-white/55 md:mt-2 md:text-base">
{buildHistoryLabel(displayState, displayDirection)}
</div>
</div>

<div className="shrink-0 text-right">
<div className="text-[10px] uppercase tracking-[0.24em] text-white/40 md:text-[11px] md:tracking-[0.28em]">
Axis Lock
</div>
<div
className="mt-1 text-3xl font-semibold md:mt-2 md:text-5xl"
style={{
color: tone.ring,
textShadow: isLocked ? tone.glow : "none",
}}
>
{displayScore}
</div>
<div className="mt-1 text-xs text-white/50 md:mt-2 md:text-sm">
{isLocked ? "Structure locked" : "Scanning structure"}
</div>
</div>
</div>
</section>

<section className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:rounded-[32px] md:p-6">
<div className="mb-3 flex items-center justify-between md:mb-4">
<div>
<div className="text-[10px] uppercase tracking-[0.26em] text-white/45 md:text-[11px] md:tracking-[0.28em]">
Axis Scope
</div>
<div className="mt-1 text-sm text-white/55">
AXIS STRUCTURE FIELD
</div>
</div>
<div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/60 md:text-xs md:tracking-[0.24em]">
{isLive ? "Live" : "Idle"}
</div>
</div>

<div className="relative mx-auto aspect-square w-full max-w-[300px] sm:max-w-[320px] md:max-w-[360px]">
<svg viewBox={`0 0 ${scopeSize} ${scopeSize}`} className="h-full w-full">
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

<circle cx={center} cy={center} r="4.5" fill="rgba(255,255,255,0.85)" />

{isLocked && (
<circle
cx={center}
cy={center}
r="108"
fill="none"
stroke={tone.ring}
strokeWidth="1.4"
opacity="0.7"
/>
)}

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

<div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[10px] uppercase tracking-[0.22em] text-white/36 md:text-[11px] md:tracking-[0.26em]">
Structure Field
</div>
</div>

<div className="mt-4 grid grid-cols-3 gap-2 md:gap-3">
<StatChip label="X Axis" value={displayX.toFixed(2)} />
<StatChip label="Y Axis" value={displayY.toFixed(2)} />
<StatChip label="Direction" value={displayDirection} />
</div>
</section>

<section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:rounded-[28px] md:p-5">
<div className="mb-3 flex items-center justify-between md:mb-4">
<div>
<div className="text-[10px] uppercase tracking-[0.26em] text-white/45 md:text-[11px] md:tracking-[0.28em]">
Axis Line
</div>
<div className="mt-1 text-sm text-white/55">
Structure over time
</div>
</div>

<div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/50 md:text-xs md:tracking-[0.24em]">
{signal.length} frames
</div>
</div>

<div className="overflow-hidden rounded-[18px] border border-white/8 bg-[#07090d] p-2 md:rounded-[20px] md:p-3">
<svg viewBox="0 0 720 140" className="h-[120px] w-full md:h-[160px]">
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

<div className="flex flex-col gap-4 md:gap-5">
<section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:rounded-[28px] md:p-5">
<div className="text-[10px] uppercase tracking-[0.26em] text-white/45 md:text-[11px] md:tracking-[0.28em]">
Axis Lock
</div>
<div className="mt-1 text-sm text-white/55 md:mt-2">
Stability above 90 held for 420ms
</div>

<div className="mt-4 rounded-[20px] border border-white/8 bg-[#07090d] p-4 md:mt-5 md:rounded-[24px] md:p-5">
<div className="flex items-center justify-between gap-3">
<div className="text-xs uppercase tracking-[0.22em] text-white/40 md:text-sm md:tracking-[0.24em]">
Lock State
</div>
<div
className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.22em] md:text-xs md:tracking-[0.24em]"
style={{
color: tone.ring,
border: `1px solid ${tone.ring}33`,
boxShadow: isLocked ? tone.glow : "none",
}}
>
{isLocked ? "Locked" : "Scanning"}
</div>
</div>

<div className="mt-4 grid gap-2 md:mt-5 md:gap-3">
<button
onClick={enableMotion}
className="rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-left transition hover:bg-white/12 md:py-4"
>
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45 md:text-xs md:tracking-[0.24em]">
Motion
</div>
<div className="mt-1 text-base font-medium md:text-lg">
{permissionState === "granted"
? "Permission granted"
: permissionState === "denied"
? "Permission denied"
: permissionState === "unsupported"
? "Simulation mode"
: "Enable motion"}
</div>
</button>

<div className="grid grid-cols-2 gap-2 md:gap-3">
<button
onClick={() => setIsLive(true)}
className="rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-left transition hover:bg-white/10 md:py-4"
>
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45 md:text-xs md:tracking-[0.24em]">
Live
</div>
<div className="mt-1 text-base font-medium md:text-lg">Start</div>
</button>

<button
onClick={endSession}
className="rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-left transition hover:bg-white/10 md:py-4"
>
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45 md:text-xs md:tracking-[0.24em]">
Session
</div>
<div className="mt-1 text-base font-medium md:text-lg">End</div>
</button>
</div>

<button
onClick={clearSession}
className="rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-left transition hover:bg-white/10 md:py-4"
>
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45 md:text-xs md:tracking-[0.24em]">
Axis History
</div>
<div className="mt-1 text-base font-medium md:text-lg">Clear session</div>
</button>
</div>
</div>
</section>

<section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:rounded-[28px] md:p-5">
<div className="mb-4 flex gap-2">
<button
onClick={() => setPanel("brain")}
className={cn(
"flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition",
panel === "brain"
? "border-white/16 bg-white/10 text-white"
: "border-white/8 bg-white/[0.03] text-white/55",
)}
>
Axis Brain
</button>

<button
onClick={() => setPanel("history")}
className={cn(
"flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition",
panel === "history"
? "border-white/16 bg-white/10 text-white"
: "border-white/8 bg-white/[0.03] text-white/55",
)}
>
Axis History
</button>
</div>

{panel === "brain" ? (
<div>
<div className="mb-1 text-[10px] uppercase tracking-[0.26em] text-white/45 md:text-[11px] md:tracking-[0.28em]">
Axis Brain
</div>
<div className="mb-4 text-sm text-white/55">
Live interpretation of structure during decision
</div>

<div className="grid gap-2 md:gap-3">
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
</div>
) : (
<div>
<div className="mb-1 text-[10px] uppercase tracking-[0.26em] text-white/45 md:text-[11px] md:tracking-[0.28em]">
Axis History
</div>
<div className="mb-4 text-sm text-white/55">
Auto-logged on lock
</div>

{history.length === 0 ? (
<div className="rounded-[20px] border border-dashed border-white/12 bg-[#07090d] px-4 py-8 text-center text-sm text-white/42">
No locked windows yet. Start live sensing and hold structure to create Axis History.
</div>
) : (
<div className="space-y-2 md:space-y-3">
{history.map((item) => (
<div
key={item.id}
className="rounded-[18px] border border-white/8 bg-[#07090d] px-4 py-3 md:rounded-[22px] md:py-4"
>
<div className="flex items-start justify-between gap-3">
<div className="min-w-0">
<div
className={cn(
"truncate text-base font-semibold",
stateAccent(item.state),
)}
>
{item.state}
</div>
<div className="mt-1 text-sm text-white/55">
{item.direction === "CENTER" ? "Center" : item.direction}
</div>
</div>

<div className="shrink-0 text-right">
<div
className="text-lg font-semibold md:text-xl"
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
))}
</div>
)}
</div>
)}
</section>
</div>
</div>
</div>
</div>
);
}

function StatChip({ label, value }: { label: string; value: string }) {
return (
<div className="rounded-[16px] border border-white/8 bg-[#07090d] px-3 py-3 md:rounded-[18px] md:px-4">
<div className="text-[9px] uppercase tracking-[0.22em] text-white/38 md:text-[10px] md:tracking-[0.24em]">
{label}
</div>
<div className="mt-1 truncate text-xs font-medium text-white/82 md:text-sm">
{value}
</div>
</div>
);
}

function InsightRow({ label, value }: { label: string; value: string }) {
return (
<div className="flex items-start justify-between gap-4 rounded-[16px] border border-white/8 bg-[#07090d] px-4 py-3 md:rounded-[18px]">
<div className="text-[9px] uppercase tracking-[0.22em] text-white/38 md:text-[10px] md:tracking-[0.24em]">
{label}
</div>
<div className="max-w-[68%] text-right text-sm text-white/82">{value}</div>
</div>
);
}