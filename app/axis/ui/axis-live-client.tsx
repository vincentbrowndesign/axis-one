"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
type AxisFrame,
type AxisHistoryItem,
type AxisState,
classifyAxisState,
computeStability,
createHistoryItem,
detectPushDirection,
formatTime,
isAxisLock,
normalizeTilt,
} from "../../../lib/axis-core";

type SignalPoint = {
x: number;
y: number;
state: AxisState;
locked: boolean;
time: number;
};

type PeakHold = {
score: number;
state: AxisState;
direction: string;
visible: boolean;
};

const HISTORY_LIMIT = 12;
const SIGNAL_LIMIT = 64;
const PEAK_HOLD_MS = 1100;

function cn(...parts: Array<string | false | null | undefined>) {
return parts.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function scoreTone(score: number) {
if (score >= 95) {
return {
ring: "rgba(76,255,126,0.95)",
glow: "0 0 28px rgba(76,255,126,0.32)",
text: "text-emerald-300",
faint: "text-emerald-300/70",
};
}
if (score >= 85) {
return {
ring: "rgba(255,255,255,0.95)",
glow: "0 0 22px rgba(255,255,255,0.14)",
text: "text-white",
faint: "text-white/70",
};
}
if (score >= 70) {
return {
ring: "rgba(255,191,71,0.96)",
glow: "0 0 22px rgba(255,191,71,0.20)",
text: "text-amber-300",
faint: "text-amber-300/70",
};
}
return {
ring: "rgba(255,90,90,0.96)",
glow: "0 0 22px rgba(255,90,90,0.22)",
text: "text-rose-300",
faint: "text-rose-300/70",
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

function buildReading(score: number, state: AxisState, locked: boolean) {
if (locked) return "CLEAR";
if (state === "SHIFT") return "SHIFT";
if (state === "OFF AXIS") return "Breaking";
if (score >= 80) return "CLEAR";
return "SEARCHING";
}

function buildSignalText(state: AxisState, locked: boolean) {
if (locked || state === "CENTERED") return "Balanced and organized";
if (state === "FLOAT") return "Stable with controlled drift";
if (state === "SHIFT") return "Lateral transfer active";
if (state === "DROP") return "Forward load increasing";
return "Structure breaking";
}

function smoothVisual(
current: { x: number; y: number },
target: { x: number; y: number },
factor: number,
) {
return {
x: current.x + (target.x - current.x) * factor,
y: current.y + (target.y - current.y) * factor,
};
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
const [lockPulse, setLockPulse] = useState(false);
const [peakHold, setPeakHold] = useState<PeakHold>({
score: 0,
state: "CENTERED",
direction: "CENTER",
visible: false,
});
const [, forceRender] = useState(0);

const rawRef = useRef({ x: 0, y: 0 });
const sensorSmoothRef = useRef({ x: 0, y: 0 });
const visualRef = useRef({ x: 0, y: 0 });
const holdStartRef = useRef<number | null>(null);
const lockCooldownRef = useRef(0);
const frameRef = useRef<AxisFrame | null>(null);
const simulationRef = useRef(0);
const rafRef = useRef<number | null>(null);
const pulseTimeoutRef = useRef<number | null>(null);
const peakTimeoutRef = useRef<number | null>(null);

const current = frameRef.current;

const displayState = current?.state ?? "CENTERED";
const displayScore = current?.stability ?? 0;
const displayDirection = current?.direction ?? "CENTER";
const displayX = current?.smoothX ?? 0;
const displayY = current?.smoothY ?? 0;
const isLocked = current?.locked ?? false;

const reading = buildReading(displayScore, displayState, isLocked);
const signalText = buildSignalText(displayState, isLocked);

const tone = useMemo(() => scoreTone(displayScore), [displayScore]);
const peakTone = useMemo(() => scoreTone(peakHold.score), [peakHold.score]);

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
return () => {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current);
if (peakTimeoutRef.current) window.clearTimeout(peakTimeoutRef.current);
};
}, []);

useEffect(() => {
if (!isLive) {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
return;
}

const loop = (time: number) => {
setSweepDeg((prev) => (prev + 1.25) % 360);

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

const prevSensor = sensorSmoothRef.current;
const nextSensor = smoothVisual(prevSensor, rawRef.current, 0.18);
sensorSmoothRef.current = nextSensor;

const velocityX = nextSensor.x - prevSensor.x;
const velocityY = nextSensor.y - prevSensor.y;
const stability = computeStability(
nextSensor.x,
nextSensor.y,
velocityX,
velocityY,
);
const state = classifyAxisState(nextSensor.x, nextSensor.y, stability);
const direction = detectPushDirection(nextSensor.x, nextSensor.y);

if (stability >= 90) {
if (holdStartRef.current === null) holdStartRef.current = time;
} else {
holdStartRef.current = null;
}

const holdMs = holdStartRef.current ? time - holdStartRef.current : 0;
const locked = isAxisLock(stability, holdMs);

let visualTarget = nextSensor;
if (locked) {
visualTarget = {
x: nextSensor.x * 0.2,
y: nextSensor.y * 0.2,
};
}

const visualFactor = locked ? 0.34 : 0.12;
let nextVisual = smoothVisual(visualRef.current, visualTarget, visualFactor);

if (locked) {
nextVisual = {
x: Math.abs(nextVisual.x) < 0.015 ? 0 : nextVisual.x,
y: Math.abs(nextVisual.y) < 0.015 ? 0 : nextVisual.y,
};
}

visualRef.current = nextVisual;

const nextFrame: AxisFrame = {
time: Date.now(),
rawX: rawRef.current.x,
rawY: rawRef.current.y,
smoothX: nextVisual.x,
smoothY: nextVisual.y,
magnitude: Math.sqrt(nextSensor.x * nextSensor.x + nextSensor.y * nextSensor.y),
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

const y = height - (stability / 100) * (height - 18) - 9;

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
setLockPulse(true);

setPeakHold({
score: nextFrame.stability,
state: nextFrame.state,
direction: nextFrame.direction,
visible: true,
});

if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current);
pulseTimeoutRef.current = window.setTimeout(() => {
setLockPulse(false);
}, 420);

if (peakTimeoutRef.current) window.clearTimeout(peakTimeoutRef.current);
peakTimeoutRef.current = window.setTimeout(() => {
setPeakHold((prev) => ({ ...prev, visible: false }));
}, PEAK_HOLD_MS);
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

function startLive() {
setIsLive(true);
}

function endSession() {
setIsLive(false);
}

function clearSession() {
setHistory([]);
setSignal([]);
holdStartRef.current = null;
lockCooldownRef.current = 0;
setLockPulse(false);
sensorSmoothRef.current = { x: 0, y: 0 };
visualRef.current = { x: 0, y: 0 };
setPeakHold({
score: 0,
state: "CENTERED",
direction: "CENTER",
visible: false,
});
}

const scopeSize = 420;
const center = scopeSize / 2;
const maxRadius = 136;
const dotX = center + clamp(displayX, -1, 1) * maxRadius;
const dotY = center + clamp(displayY, -1, 1) * maxRadius;
const sweepAngle = sweepDeg - 90;
const sweepRadians = (sweepAngle * Math.PI) / 180;
const sweepX = center + Math.cos(sweepRadians) * 162;
const sweepY = center + Math.sin(sweepRadians) * 162;

const circumference = 2 * Math.PI * 170;
const fill = Math.max(0, Math.min(100, displayScore));
const dashOffset = circumference * (1 - fill / 100);
const signalPath = buildSignalPath(signal);

return (
<div className="min-h-screen bg-[#03060b] text-white">
<div className="mx-auto max-w-6xl px-3 py-3 sm:px-4 md:px-5">
<div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#05080e] shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
<section className="border-b border-white/8 px-4 py-3 md:px-6">
<div className="grid grid-cols-2 gap-x-5 gap-y-2 md:grid-cols-4">
<DisplayItem label="State" value={displayState} accent={stateAccent(displayState)} />
<DisplayItem label="Direction" value={displayDirection} />
<DisplayItem
label="Axis Lock"
value={peakHold.visible ? String(peakHold.score) : String(displayScore)}
accent={peakHold.visible ? peakTone.text : tone.text}
mono
/>
<DisplayItem label="Reading" value={peakHold.visible ? "PEAK" : reading} />
</div>
</section>

<section className="border-b border-white/8 px-3 py-4 md:px-6 md:py-6">
<div className="mx-auto aspect-square w-full max-w-[520px]">
<svg viewBox={`0 0 ${scopeSize} ${scopeSize}`} className="h-full w-full">
<defs>
<radialGradient id="scopeGlow" cx="50%" cy="50%" r="50%">
<stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
<stop offset="74%" stopColor="rgba(255,255,255,0.02)" />
<stop offset="100%" stopColor="rgba(255,255,255,0)" />
</radialGradient>
<linearGradient id="sweepGradient" x1="0%" y1="0%" x2="100%" y2="0%">
<stop offset="0%" stopColor="rgba(255,255,255,0)" />
<stop offset="100%" stopColor="rgba(255,255,255,0.22)" />
</linearGradient>
<clipPath id="scopeClip">
<circle cx={center} cy={center} r="152" />
</clipPath>
</defs>

<circle cx={center} cy={center} r="188" fill="url(#scopeGlow)" />

<circle
cx={center}
cy={center}
r="170"
fill="none"
stroke="rgba(255,255,255,0.08)"
strokeWidth="16"
/>
<circle
cx={center}
cy={center}
r="170"
fill="none"
stroke={tone.ring}
strokeWidth="16"
strokeLinecap="round"
strokeDasharray={circumference}
strokeDashoffset={dashOffset}
transform={`rotate(-90 ${center} ${center})`}
style={{
filter:
isLocked || lockPulse ? `drop-shadow(${tone.glow})` : "none",
transition:
"stroke-dashoffset 160ms linear, stroke 160ms linear, filter 160ms linear",
}}
/>

<g clipPath="url(#scopeClip)">
{Array.from({ length: 8 }).map((_, i) => {
const x = 78 + i * 38;
return (
<line
key={`v-${i}`}
x1={x}
y1={64}
x2={x}
y2={356}
stroke="rgba(255,255,255,0.04)"
strokeWidth="1"
/>
);
})}
{Array.from({ length: 8 }).map((_, i) => {
const y = 78 + i * 38;
return (
<line
key={`h-${i}`}
x1={64}
y1={y}
x2={356}
y2={y}
stroke="rgba(255,255,255,0.04)"
strokeWidth="1"
/>
);
})}
</g>

{[132, 92, 52].map((r) => (
<circle
key={r}
cx={center}
cy={center}
r={r}
fill="none"
stroke="rgba(255,255,255,0.09)"
strokeWidth="1.2"
/>
))}

<line
x1={center}
y1={52}
x2={center}
y2={scopeSize - 52}
stroke="rgba(255,255,255,0.12)"
strokeWidth="1"
/>
<line
x1={52}
y1={center}
x2={scopeSize - 52}
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
strokeWidth="2.8"
style={{ filter: "drop-shadow(0 0 12px rgba(255,255,255,0.08))" }}
/>

<circle cx={center} cy={center} r="5.5" fill="rgba(255,255,255,0.88)" />

{(isLocked || lockPulse) && (
<circle
cx={center}
cy={center}
r="132"
fill="none"
stroke={tone.ring}
strokeWidth="1.6"
opacity={lockPulse ? 0.95 : 0.72}
style={{
filter: lockPulse ? `drop-shadow(${tone.glow})` : "none",
}}
/>
)}

{lockPulse && (
<circle
cx={center}
cy={center}
r="150"
fill="none"
stroke={tone.ring}
strokeWidth="1.2"
opacity="0.28"
style={{ filter: `drop-shadow(${tone.glow})` }}
/>
)}

<circle
cx={dotX}
cy={dotY}
r={isLocked || lockPulse ? 13 : 10}
fill={tone.ring}
style={{
filter:
isLocked || lockPulse ? `drop-shadow(${tone.glow})` : "none",
transition:
"cx 75ms linear, cy 75ms linear, r 120ms ease, filter 120ms ease",
}}
/>
</svg>
</div>
</section>

<section className="border-b border-white/8 px-4 py-4 md:px-6">
<div className="mb-2 flex items-center justify-between">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/42">
Axis Line
</div>
<div className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/55">
{signal.length} Frames
</div>
</div>

<div className="overflow-hidden rounded-[18px] border border-white/8 bg-[#04070d] p-2 md:p-3">
<svg viewBox="0 0 720 140" className="h-[110px] w-full md:h-[150px]">
<defs>
<linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
<stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
<stop offset="100%" stopColor={tone.ring} />
</linearGradient>
</defs>

{[22, 50, 78, 106].map((y) => (
<line
key={y}
x1="0"
y1={y}
x2="720"
y2={y}
stroke="rgba(255,255,255,0.05)"
strokeWidth="1"
/>
))}

{Array.from({ length: 32 }).map((_, i) => (
<line
key={`grid-v-${i}`}
x1={i * 22.5}
y1="10"
x2={i * 22.5}
y2="132"
stroke="rgba(255,255,255,0.028)"
strokeWidth="1"
strokeDasharray="4 6"
/>
))}

<path
d={signalPath}
fill="none"
stroke="url(#lineGradient)"
strokeWidth="3.4"
strokeLinecap="round"
strokeLinejoin="round"
/>

{signal
.filter((p) => p.locked)
.map((p, i) => (
<circle key={`${p.time}-${i}`} cx={p.x} cy={p.y} r="4.1" fill={tone.ring} />
))}
</svg>
</div>
</section>

<section className="border-b border-white/8 px-4 py-4 md:px-6">
<div className="mb-2 flex items-center justify-between">
<div className="text-[10px] uppercase tracking-[0.28em] text-white/42">
Axis Lock
</div>
<div
className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.24em]"
style={{
color: tone.ring,
borderColor: `${tone.ring}33`,
boxShadow: isLocked ? tone.glow : "none",
}}
>
{isLocked ? "LOCKED" : "SCANNING"}
</div>
</div>

<div className="rounded-[20px] border border-white/10 bg-[#0a0d14] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_16px_40px_rgba(0,0,0,0.35)]">
<div className="grid grid-cols-3 gap-2">
<InstrumentKey
label="Session"
value="START"
onClick={enableMotion}
active={permissionState === "granted"}
/>
<InstrumentKey
label="Live"
value="LIVE"
onClick={startLive}
accent="cyan"
/>
<InstrumentKey
label="Session"
value="END"
onClick={endSession}
accent="neutral"
/>
</div>

<button
onClick={clearSession}
className="mt-2 flex h-[50px] w-full items-center justify-center rounded-[14px] border border-white/10 bg-[#111520] px-4 text-[13px] font-medium uppercase tracking-[0.26em] text-sky-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition active:translate-y-[1px]"
>
Clear Axis History
</button>
</div>
</section>

<section className="px-4 py-4 md:px-6">
<div className="mb-3 flex gap-2">
<button
onClick={() => setPanel("brain")}
className={cn(
"flex-1 border-b px-3 py-2 text-sm transition",
panel === "brain"
? "border-white/30 text-white"
: "border-white/10 text-sky-400",
)}
>
Brain
</button>

<button
onClick={() => setPanel("history")}
className={cn(
"flex-1 border-b px-3 py-2 text-sm transition",
panel === "history"
? "border-white/30 text-white"
: "border-white/10 text-sky-400",
)}
>
Axis History
</button>
</div>

{panel === "brain" ? (
<div className="space-y-2">
<MiniRow label="Reading" value={reading} />
<MiniRow label="State" value={displayState} />
<MiniRow label="Direction" value={displayDirection} />
<MiniRow label="Signal" value={signalText} />
</div>
) : (
<div>
<div className="mb-3 text-sm text-white/55">Captured</div>
{history.length === 0 ? (
<div className="rounded-[16px] border border-dashed border-white/12 px-4 py-8 text-center text-sm text-white/42">
No captured reads yet.
</div>
) : (
<div className="space-y-2">
{history.map((item) => (
<div
key={item.id}
className="flex items-start justify-between gap-3 border-b border-white/8 pb-2"
>
<div className="min-w-0">
<div className={cn("truncate text-base font-semibold", stateAccent(item.state))}>
{item.state}
</div>
<div className="mt-1 text-sm text-white/55">
{item.direction === "CENTER" ? "Center" : item.direction}
</div>
</div>

<div className="shrink-0 text-right">
<div
className="font-mono text-lg font-semibold"
style={{ color: scoreTone(item.stability).ring }}
>
{item.stability}
</div>
<div className="text-xs text-white/40">{formatTime(item.time)}</div>
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
);
}

function DisplayItem({
label,
value,
accent,
mono = false,
}: {
label: string;
value: string;
accent?: string;
mono?: boolean;
}) {
return (
<div className="min-w-0">
<div className="text-[9px] uppercase tracking-[0.24em] text-white/38">
{label}
</div>
<div
className={cn(
"mt-1 truncate text-xl font-medium text-white/92 md:text-2xl",
accent,
mono && "font-mono",
)}
>
{value}
</div>
</div>
);
}

function MiniRow({ label, value }: { label: string; value: string }) {
return (
<div className="flex items-start justify-between gap-4 border-b border-white/8 pb-2">
<div className="text-[9px] uppercase tracking-[0.22em] text-white/38">
{label}
</div>
<div className="max-w-[68%] text-right text-sm text-white/88 md:text-base">
{value}
</div>
</div>
);
}

function InstrumentKey({
label,
value,
onClick,
active = false,
accent = "cyan",
}: {
label: string;
value: string;
onClick: () => void;
active?: boolean;
accent?: "cyan" | "neutral" | "amber" | "red";
}) {
const accentClass =
accent === "amber"
? "text-amber-300"
: accent === "red"
? "text-rose-300"
: accent === "neutral"
? "text-white"
: "text-sky-400";

return (
<button
onClick={onClick}
className={cn(
"group relative flex h-[82px] flex-col items-center justify-center overflow-hidden rounded-[16px] border bg-[#111520] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-10px_18px_rgba(0,0,0,0.22)] transition active:translate-y-[1px]",
active ? "border-emerald-400/30" : "border-white/10",
)}
>
<div className="absolute inset-x-0 top-0 h-[1px] bg-white/10" />
<div className={cn("text-[10px] uppercase tracking-[0.28em]", active ? "text-emerald-300/80" : "text-white/38")}>
{label}
</div>
<div className={cn("mt-2 text-[14px] font-semibold uppercase tracking-[0.12em] md:text-[16px]", active ? "text-emerald-300" : accentClass)}>
{value}
</div>
<div
className={cn(
"absolute bottom-0 left-0 right-0 h-[3px]",
active
? "bg-emerald-400/70"
: accent === "amber"
? "bg-amber-400/60"
: accent === "red"
? "bg-rose-400/60"
: accent === "neutral"
? "bg-white/18"
: "bg-sky-400/60",
)}
/>
</button>
);
}