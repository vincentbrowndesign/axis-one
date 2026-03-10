"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AxisState = "ALIGNED" | "SHIFT" | "DROP" | "OFF_AXIS" | "RECOVER";
type DecisionAction = "SHOOT" | "DRIVE" | "PASS" | "HOLD";
type DecisionQuality = "GOOD" | "NEUTRAL" | "BAD";

type SamplePoint = {
t: number;
x: number;
y: number;
};

type HistoryItem = {
id: string;
time: string;
state: AxisState;
prevState: AxisState;
stability: number;
windowMs: number;
action: DecisionAction;
quality: DecisionQuality;
event: string;
};

const STATE_COLORS: Record<AxisState, string> = {
ALIGNED: "#8CFFB5",
SHIFT: "#FFE27A",
DROP: "#FFB26B",
OFF_AXIS: "#FF7A7A",
RECOVER: "#7AB8FF",
};

const QUALITY_COLORS: Record<DecisionQuality, string> = {
GOOD: "#8CFFB5",
NEUTRAL: "#FFE27A",
BAD: "#FF7A7A",
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function formatMs(ms: number) {
return `${Math.round(ms)} ms`;
}

function formatPct(value: number) {
return `${Math.round(value)}%`;
}

function seededNoise(seed: number) {
const x = Math.sin(seed * 12.9898) * 43758.5453;
return x - Math.floor(x);
}

function buildMockSeries(length = 90): SamplePoint[] {
const now = Date.now();
const out: SamplePoint[] = [];

for (let i = 0; i < length; i += 1) {
const t = now - (length - i) * 120;
const baseX = Math.sin(i / 8) * 0.34;
const baseY = Math.cos(i / 10) * 0.28;
const noiseX = (seededNoise(i + 1) - 0.5) * 0.14;
const noiseY = (seededNoise(i + 101) - 0.5) * 0.14;

out.push({
t,
x: baseX + noiseX,
y: baseY + noiseY,
});
}

return out;
}

function getAxisState(stability: number, tilt: number, prev: AxisState): AxisState {
if (stability >= 86 && tilt <= 10) return "ALIGNED";
if (stability >= 72 && tilt <= 18) {
if (prev === "DROP" || prev === "OFF_AXIS") return "RECOVER";
return "SHIFT";
}
if (stability >= 50 && tilt <= 28) return "DROP";
return "OFF_AXIS";
}

function getDecisionQuality(
state: AxisState,
stability: number,
windowMs: number,
action: DecisionAction,
): DecisionQuality {
if (state === "ALIGNED") {
if (action === "SHOOT" || action === "DRIVE" || action === "PASS") return "GOOD";
return "NEUTRAL";
}

if (state === "RECOVER") {
if (action === "PASS" || action === "HOLD") return "GOOD";
if (action === "DRIVE") return "NEUTRAL";
return "BAD";
}

if (state === "SHIFT") {
if (windowMs > 420 && (action === "PASS" || action === "DRIVE")) return "GOOD";
if (action === "HOLD") return "NEUTRAL";
return "NEUTRAL";
}

if (state === "DROP") {
if (action === "HOLD" || action === "PASS") return "GOOD";
return "BAD";
}

if (action === "HOLD") return "NEUTRAL";
return "BAD";
}

function getEventLabel(prev: AxisState, next: AxisState) {
if (prev === next) return "STATE HOLD";
if (prev === "ALIGNED" && next === "SHIFT") return "ALIGNMENT BREAK";
if (prev === "SHIFT" && next === "DROP") return "PRESSURE DROP";
if (prev === "DROP" && next === "RECOVER") return "RECOVERY FOUND";
if (prev === "OFF_AXIS" && next === "RECOVER") return "OFF-AXIS RECOVERY";
if (next === "OFF_AXIS") return "INSTABILITY SPIKE";
if (next === "ALIGNED") return "CLEAN WINDOW";
return `${prev.replace("_", " ")} → ${next.replace("_", " ")}`;
}

function Sparkline({
values,
stroke,
height = 42,
}: {
values: number[];
stroke: string;
height?: number;
}) {
const width = 220;
const max = Math.max(...values, 1);
const min = Math.min(...values, 0);
const range = Math.max(max - min, 1);

const d = values
.map((v, i) => {
const x = (i / Math.max(values.length - 1, 1)) * width;
const y = height - ((v - min) / range) * height;
return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
})
.join(" ");

return (
<svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block">
<path d={d} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
</svg>
);
}

function MetricCard({
label,
value,
sub,
color,
values,
}: {
label: string;
value: string;
sub: string;
color: string;
values: number[];
}) {
return (
<div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_20px_40px_rgba(0,0,0,0.28)]">
<div className="mb-3 flex items-start justify-between gap-3">
<div>
<div className="text-[11px] tracking-[0.22em] text-white/45">{label}</div>
<div className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</div>
</div>
<div
className="mt-1 h-2.5 w-2.5 rounded-full"
style={{ backgroundColor: color, boxShadow: `0 0 18px ${color}` }}
/>
</div>

<div className="mb-2">
<Sparkline values={values} stroke={color} />
</div>

<div className="text-sm text-white/55">{sub}</div>
</div>
);
}

function InstrumentScope({
samples,
state,
}: {
samples: SamplePoint[];
state: AxisState;
}) {
const width = 420;
const height = 420;
const cx = width / 2;
const cy = height / 2;
const color = STATE_COLORS[state];

const points = samples.map((p) => {
const x = cx + p.x * 130;
const y = cy + p.y * 130;
return `${x.toFixed(1)},${y.toFixed(1)}`;
});

const latest = samples[samples.length - 1] ?? { x: 0, y: 0 };
const latestX = cx + latest.x * 130;
const latestY = cy + latest.y * 130;

return (
<div className="relative mx-auto aspect-square w-full max-w-[420px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#05070a] shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_30px_80px_rgba(0,0,0,0.55)]">
<svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
<defs>
<radialGradient id="scopeGlow2" cx="50%" cy="50%" r="50%">
<stop offset="0%" stopColor={color} stopOpacity="0.18" />
<stop offset="55%" stopColor={color} stopOpacity="0.06" />
<stop offset="100%" stopColor="#000000" stopOpacity="0" />
</radialGradient>
</defs>

<rect x="0" y="0" width={width} height={height} fill="url(#scopeGlow2)" />

{[0.18, 0.34, 0.5, 0.66, 0.82].map((p) => (
<line
key={`v-${p}`}
x1={width * p}
y1="0"
x2={width * p}
y2={height}
stroke="rgba(255,255,255,0.07)"
strokeDasharray="3 8"
/>
))}
{[0.18, 0.34, 0.5, 0.66, 0.82].map((p) => (
<line
key={`h-${p}`}
x1="0"
y1={height * p}
x2={width}
y2={height * p}
stroke="rgba(255,255,255,0.07)"
strokeDasharray="3 8"
/>
))}

{[42, 92, 142].map((r) => (
<circle
key={r}
cx={cx}
cy={cy}
r={r}
fill="none"
stroke="rgba(255,255,255,0.11)"
strokeWidth="1"
/>
))}

<line x1={cx} y1="0" x2={cx} y2={height} stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
<line x1="0" y1={cy} x2={width} y2={cy} stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />

<polyline
points={points.join(" ")}
fill="none"
stroke={color}
strokeWidth="3.1"
strokeLinecap="round"
strokeLinejoin="round"
/>

<circle cx={latestX} cy={latestY} r="8" fill={color} />
<circle cx={latestX} cy={latestY} r="18" fill={color} opacity="0.18" />

<text x="18" y="28" fill="rgba(255,255,255,0.86)" fontSize="14" fontWeight="700">
AXIS SCOPE
</text>
<text x="18" y="46" fill="rgba(255,255,255,0.45)" fontSize="11" letterSpacing="1.5">
LIVE STATE FIELD
</text>

<text x={width - 120} y="28" fill={color} fontSize="12" fontWeight="700">
{state.replace("_", " ")}
</text>
</svg>
</div>
);
}

function ActionPad({
action,
setAction,
}: {
action: DecisionAction;
setAction: (action: DecisionAction) => void;
}) {
const actions: DecisionAction[] = ["SHOOT", "DRIVE", "PASS", "HOLD"];

return (
<div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
<div className="mb-3 text-[11px] tracking-[0.22em] text-white/45">DECISION INPUT</div>
<div className="grid grid-cols-2 gap-3">
{actions.map((item) => {
const active = action === item;
return (
<button
key={item}
type="button"
onClick={() => setAction(item)}
className={`rounded-2xl border px-4 py-4 text-left text-sm font-medium transition ${
active
? "border-white/30 bg-white/12 text-white shadow-[0_10px_30px_rgba(255,255,255,0.06)]"
: "border-white/10 bg-white/[0.02] text-white/65 hover:border-white/20 hover:bg-white/[0.05]"
}`}
>
{item}
</button>
);
})}
</div>
</div>
);
}

function HistoryPanel({ items }: { items: HistoryItem[] }) {
return (
<div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
<div className="mb-3 flex items-center justify-between">
<div className="text-[11px] tracking-[0.22em] text-white/45">EVENT HISTORY</div>
<div className="text-xs text-white/35">{items.length} events</div>
</div>

<div className="space-y-2">
{items.length === 0 ? (
<div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-5 text-sm text-white/45">
No events yet.
</div>
) : (
items.map((item) => (
<div
key={item.id}
className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3"
>
<div className="flex items-start justify-between gap-3">
<div className="min-w-0">
<div className="flex items-center gap-2">
<span
className="h-2.5 w-2.5 rounded-full"
style={{
backgroundColor: STATE_COLORS[item.state],
boxShadow: `0 0 18px ${STATE_COLORS[item.state]}`,
}}
/>
<span className="text-sm font-semibold text-white">{item.event}</span>
<span className="text-xs text-white/35">{item.time}</span>
</div>

<div className="mt-2 text-xs text-white/45">
{item.prevState.replace("_", " ")} → {item.state.replace("_", " ")}
</div>

<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
<span>Stability {Math.round(item.stability)}</span>
<span>Window {formatMs(item.windowMs)}</span>
<span>Action {item.action}</span>
</div>
</div>

<div
className="self-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
style={{
color: QUALITY_COLORS[item.quality],
backgroundColor: `${QUALITY_COLORS[item.quality]}18`,
border: `1px solid ${QUALITY_COLORS[item.quality]}33`,
}}
>
{item.quality}
</div>
</div>
</div>
))
)}
</div>
</div>
);
}

export default function AxisRunPage() {
const [running, setRunning] = useState(false);
const [granted, setGranted] = useState(false);

const [samples, setSamples] = useState<SamplePoint[]>(() => buildMockSeries());
const [stability, setStability] = useState(88);
const [decisionWindow, setDecisionWindow] = useState(640);
const [action, setAction] = useState<DecisionAction>("PASS");
const [tilt, setTilt] = useState(7);
const [axisState, setAxisState] = useState<AxisState>("ALIGNED");
const [history, setHistory] = useState<HistoryItem[]>([]);

const motionIntervalRef = useRef<number | null>(null);
const lastCapturedRef = useRef<number>(0);
const prevStateRef = useRef<AxisState>("ALIGNED");
const startedAtRef = useRef<number>(Date.now());

const decisionQuality = useMemo(
() => getDecisionQuality(axisState, stability, decisionWindow, action),
[axisState, stability, decisionWindow, action],
);

const stabilitySeries = useMemo(
() =>
samples.map((p) => {
const magnitude = Math.sqrt(p.x * p.x + p.y * p.y);
return clamp(100 - magnitude * 110, 18, 100);
}),
[samples],
);

const windowSeries = useMemo(
() =>
samples.map((p, idx) => {
const v = 640 + Math.sin(idx / 6) * 170 + p.x * 70 - p.y * 85;
return clamp(v, 180, 1200);
}),
[samples],
);

const qualitySeries = useMemo(
() =>
samples.map((p, idx) => {
const raw = 70 + Math.sin(idx / 7) * 14 - Math.abs(p.x) * 22 - Math.abs(p.y) * 14;
return clamp(raw, 15, 100);
}),
[samples],
);

async function requestMotionAccess() {
try {
const w = window as typeof window & {
DeviceMotionEvent?: {
requestPermission?: () => Promise<"granted" | "denied">;
};
};

if (typeof w.DeviceMotionEvent?.requestPermission === "function") {
const result = await w.DeviceMotionEvent.requestPermission();
if (result === "granted") setGranted(true);
return;
}

setGranted(true);
} catch {
setGranted(false);
}
}

function pushEvent(prevState: AxisState, nextState: AxisState, nextStability: number, nextWindow: number) {
const now = Date.now();
if (now - lastCapturedRef.current < 900) return;

const item: HistoryItem = {
id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
time: new Date(now).toLocaleTimeString([], {
hour: "2-digit",
minute: "2-digit",
second: "2-digit",
}),
state: nextState,
prevState,
stability: nextStability,
windowMs: nextWindow,
action,
quality: getDecisionQuality(nextState, nextStability, nextWindow, action),
event: getEventLabel(prevState, nextState),
};

lastCapturedRef.current = now;
setHistory((prev) => [item, ...prev].slice(0, 10));
}

function processReading(nx: number, ny: number) {
const magnitude = Math.sqrt(nx * nx + ny * ny);
const nextStability = clamp(100 - magnitude * 72, 15, 100);
const nextTilt = clamp(magnitude * 28, 0, 40);
const nextWindow = clamp(860 - nextTilt * 22, 160, 1200);

const prevState = prevStateRef.current;
const nextState = getAxisState(nextStability, nextTilt, prevState);

setSamples((prev) => {
const next = [...prev, { t: Date.now(), x: nx, y: ny }];
return next.slice(-90);
});
setStability(nextStability);
setTilt(nextTilt);
setDecisionWindow(nextWindow);
setAxisState(nextState);

if (nextState !== prevState) {
pushEvent(prevState, nextState, nextStability, nextWindow);
prevStateRef.current = nextState;
}
}

function tickSimulation() {
const time = (Date.now() - startedAtRef.current) / 1000;
const nx =
Math.sin(time * 1.65) * 0.34 +
Math.sin(time * 3.4) * 0.12 +
Math.sin(time * 5.8) * 0.04;
const ny =
Math.cos(time * 1.28) * 0.28 +
Math.sin(time * 2.4) * 0.12 +
Math.cos(time * 4.6) * 0.05;

processReading(nx, ny);
}

useEffect(() => {
if (!granted || !running) return;

const handleMotion = (event: DeviceMotionEvent) => {
const ax = event.accelerationIncludingGravity?.x ?? 0;
const ay = event.accelerationIncludingGravity?.y ?? 0;

const nx = clamp(ax / 12, -1.2, 1.2);
const ny = clamp(ay / 12, -1.2, 1.2);

processReading(nx, ny);
};

window.addEventListener("devicemotion", handleMotion);

return () => {
window.removeEventListener("devicemotion", handleMotion);
};
}, [granted, running, action]);

useEffect(() => {
if (!running) return;

const hasDeviceMotion = typeof window !== "undefined" && "DeviceMotionEvent" in window;

const fallback = window.setInterval(() => {
if (!hasDeviceMotion || !granted) tickSimulation();
}, 120);

motionIntervalRef.current = fallback;

return () => {
if (motionIntervalRef.current) window.clearInterval(motionIntervalRef.current);
};
}, [running, granted, action]);

useEffect(() => {
if (!running) return;

const holdCapture = window.setInterval(() => {
const now = Date.now();
if (now - lastCapturedRef.current < 2200) return;

const currentState = prevStateRef.current;
pushEvent(currentState, currentState, stability, decisionWindow);
}, 2600);

return () => window.clearInterval(holdCapture);
}, [running, stability, decisionWindow, action]);

function startSession() {
startedAtRef.current = Date.now();
setRunning(true);
}

function stopSession() {
setRunning(false);
if (motionIntervalRef.current) window.clearInterval(motionIntervalRef.current);
}

function resetSession() {
stopSession();
setGranted(false);
setSamples(buildMockSeries());
setStability(88);
setTilt(7);
setDecisionWindow(640);
setAction("PASS");
setAxisState("ALIGNED");
setHistory([]);
prevStateRef.current = "ALIGNED";
lastCapturedRef.current = 0;
}

const headerGlow = STATE_COLORS[axisState];

return (
<main className="min-h-screen bg-[#030405] text-white">
<div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-6">
<div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:p-6">
<div className="mb-6 flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-center lg:justify-between">
<div>
<div className="mb-2 flex items-center gap-3">
<span
className="inline-block h-2.5 w-2.5 rounded-full"
style={{
backgroundColor: headerGlow,
boxShadow: `0 0 20px ${headerGlow}`,
}}
/>
<span className="text-[11px] tracking-[0.28em] text-white/45">AXIS RUN INSTRUMENT</span>
</div>

<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
State. Window. Decision.
</h1>
<p className="mt-2 max-w-2xl text-sm text-white/55 sm:text-base">
Axis now captures movement transitions automatically and logs live state events.
</p>
</div>

<div className="flex flex-wrap gap-3">
<button
type="button"
onClick={requestMotionAccess}
className="rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
>
{granted ? "Motion Ready" : "Allow Motion"}
</button>

{!running ? (
<button
type="button"
onClick={startSession}
className="rounded-2xl border border-white/15 bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90"
>
Start
</button>
) : (
<button
type="button"
onClick={stopSession}
className="rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
>
Pause
</button>
)}

<button
type="button"
onClick={resetSession}
className="rounded-2xl border border-white/12 bg-transparent px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/[0.04] hover:text-white"
>
Reset
</button>
</div>
</div>

<div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
<div className="grid gap-5">
<div className="rounded-[2rem] border border-white/10 bg-black/25 p-4 sm:p-5">
<InstrumentScope samples={samples} state={axisState} />
</div>

<div className="grid gap-4 md:grid-cols-3">
<MetricCard
label="STABILITY"
value={formatPct(stability)}
sub={
axisState === "ALIGNED"
? "body ready"
: axisState === "SHIFT"
? "body moving"
: axisState === "DROP"
? "body dropping"
: axisState === "RECOVER"
? "body recovering"
: "body unstable"
}
color={STATE_COLORS[axisState]}
values={stabilitySeries.slice(-24)}
/>
<MetricCard
label="DECISION WINDOW"
value={formatMs(decisionWindow)}
sub={
decisionWindow > 700
? "wide window"
: decisionWindow > 400
? "live window"
: "compressed window"
}
color="#7AB8FF"
values={windowSeries.slice(-24)}
/>
<MetricCard
label="DECISION QUALITY"
value={decisionQuality}
sub={
decisionQuality === "GOOD"
? "state and action fit"
: decisionQuality === "NEUTRAL"
? "usable but not clean"
: "forced under pressure"
}
color={QUALITY_COLORS[decisionQuality]}
values={qualitySeries.slice(-24)}
/>
</div>
</div>

<div className="grid gap-5">
<div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
<div className="mb-3 text-[11px] tracking-[0.22em] text-white/45">LIVE STATE</div>

<div className="grid gap-3 sm:grid-cols-2">
<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">Axis State</div>
<div className="mt-2 text-2xl font-semibold" style={{ color: STATE_COLORS[axisState] }}>
{axisState.replace("_", " ")}
</div>
</div>

<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">Tilt Load</div>
<div className="mt-2 text-2xl font-semibold text-white">{tilt.toFixed(1)}°</div>
</div>

<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">Decision Action</div>
<div className="mt-2 text-2xl font-semibold text-white">{action}</div>
</div>

<div className="rounded-2xl border border-white/8 bg-black/20 p-4">
<div className="text-xs text-white/40">Read</div>
<div
className="mt-2 text-2xl font-semibold"
style={{ color: QUALITY_COLORS[decisionQuality] }}
>
{decisionQuality}
</div>
</div>
</div>
</div>

<ActionPad action={action} setAction={setAction} />
<HistoryPanel items={history} />
</div>
</div>
</div>
</div>
</main>
);
}