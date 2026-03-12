"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateAxis } from "@/lib/axis/axisMovementModel";

type AxisState = "aligned" | "shift" | "drop" | "recover";

const STATE_LABELS: Record<AxisState, string> = {
aligned: "ALIGNED",
shift: "SHIFT",
drop: "DROP",
recover: "RECOVER",
};

const STATE_MEANING: Record<AxisState, string> = {
aligned: "Body stacked and stable",
shift: "Weight drifting off center",
drop: "Balance lost",
recover: "Returning toward center",
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

function round(value: number) {
return Math.round(value);
}

export default function AxisLiveClient() {
const [started, setStarted] = useState(false);
const [permissionDenied, setPermissionDenied] = useState(false);
const [showDetails, setShowDetails] = useState(false);

const [rawBeta, setRawBeta] = useState(0);
const [rawGamma, setRawGamma] = useState(0);

const [baselineBeta, setBaselineBeta] = useState<number | null>(null);
const [baselineGamma, setBaselineGamma] = useState<number | null>(null);

const [smoothTilt, setSmoothTilt] = useState(0);
const [smoothRotation, setSmoothRotation] = useState(0);

const [heldState, setHeldState] = useState<AxisState>("aligned");
const [heldStability, setHeldStability] = useState(100);

const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
const [alignedMs, setAlignedMs] = useState(0);
const [bestStability, setBestStability] = useState(100);

const candidateRef = useRef<AxisState>("aligned");
const candidateCountRef = useRef(0);

async function startMeasurement() {
try {
const DeviceOrientationEventAny =
DeviceOrientationEvent as typeof DeviceOrientationEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

if (typeof DeviceOrientationEventAny?.requestPermission === "function") {
const response = await DeviceOrientationEventAny.requestPermission();

if (response !== "granted") {
setPermissionDenied(true);
return;
}
}

setPermissionDenied(false);
setStarted(true);
setSessionStartedAt(Date.now());
} catch {
setStarted(true);
setSessionStartedAt(Date.now());
}
}

function calibrateNow() {
setBaselineBeta(rawBeta);
setBaselineGamma(rawGamma);
setSmoothTilt(0);
setSmoothRotation(0);
setHeldState("aligned");
setHeldStability(100);
setBestStability(100);
setAlignedMs(0);
setSessionStartedAt(Date.now());
candidateRef.current = "aligned";
candidateCountRef.current = 0;
}

useEffect(() => {
if (!started) return;

function handleOrientation(e: DeviceOrientationEvent) {
const beta = typeof e.beta === "number" ? e.beta : 0;
const gamma = typeof e.gamma === "number" ? e.gamma : 0;

setRawBeta(beta);
setRawGamma(gamma);
}

window.addEventListener("deviceorientation", handleOrientation, true);

return () => {
window.removeEventListener("deviceorientation", handleOrientation, true);
};
}, [started]);

useEffect(() => {
if (!started) return;
if (baselineBeta !== null && baselineGamma !== null) return;

const ready = rawBeta !== 0 || rawGamma !== 0;
if (!ready) return;

setBaselineBeta(rawBeta);
setBaselineGamma(rawGamma);
setHeldState("aligned");
setHeldStability(100);
setBestStability(100);
setSessionStartedAt(Date.now());
}, [started, rawBeta, rawGamma, baselineBeta, baselineGamma]);

const liveReading = useMemo(() => {
if (baselineBeta === null || baselineGamma === null) {
return {
state: "aligned" as AxisState,
stability: 100,
tilt: 0,
rotation: 0,
};
}

const betaDelta = rawBeta - baselineBeta;
const gammaDelta = rawGamma - baselineGamma;

const tilt = clamp(Math.abs(betaDelta) / 8, 0, 12);
const rotation = clamp(Math.abs(gammaDelta) * 1.2, 0, 90);

return evaluateAxis({
tilt,
rotation,
});
}, [rawBeta, rawGamma, baselineBeta, baselineGamma]);

useEffect(() => {
const interval = window.setInterval(() => {
setSmoothTilt((prev) => prev + (liveReading.tilt - prev) * 0.18);
setSmoothRotation((prev) => prev + (liveReading.rotation - prev) * 0.18);
}, 16);

return () => window.clearInterval(interval);
}, [liveReading.tilt, liveReading.rotation]);

const smoothedReading = useMemo(() => {
return evaluateAxis({
tilt: smoothTilt,
rotation: smoothRotation,
});
}, [smoothTilt, smoothRotation]);

useEffect(() => {
const next = smoothedReading.state;

if (candidateRef.current !== next) {
candidateRef.current = next;
candidateCountRef.current = 1;
return;
}

candidateCountRef.current += 1;

const threshold = next === "aligned" ? 3 : 5;

if (candidateCountRef.current >= threshold) {
setHeldState(next);
setHeldStability(smoothedReading.stability);
}
}, [smoothedReading.state, smoothedReading.stability]);

useEffect(() => {
if (!started || sessionStartedAt === null) return;

const interval = window.setInterval(() => {
if (candidateRef.current === "aligned") {
setAlignedMs((prev) => prev + 250);
}

setBestStability((prev) => Math.max(prev, round(smoothedReading.stability)));
}, 250);

return () => window.clearInterval(interval);
}, [started, sessionStartedAt, smoothedReading.stability]);

const stateText = STATE_LABELS[heldState];
const meaningText = STATE_MEANING[heldState];
const stabilityText = round(heldStability);
const tiltText = round(smoothTilt);
const rotationText = round(smoothRotation);

const totalMs =
sessionStartedAt === null ? 0 : Math.max(Date.now() - sessionStartedAt, 1);

const alignedTimePct =
totalMs > 0 ? clamp((alignedMs / totalMs) * 100, 0, 100) : 0;

const baselineLocked = baselineBeta !== null && baselineGamma !== null;

return (
<main className="min-h-screen bg-black px-6 py-10 text-white">
<div className="mx-auto max-w-4xl">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/35">
Axis Live
</div>

<h1 className="mt-2 text-3xl font-semibold tracking-[0.18em] sm:text-5xl">
HUMAN ALIGNMENT
</h1>

{!started ? (
<button
onClick={startMeasurement}
className="mt-8 rounded-full border border-white/20 px-6 py-3 text-sm tracking-[0.18em] text-white transition hover:border-white/40 hover:bg-white/5"
>
START MEASUREMENT
</button>
) : (
<div className="mt-8 flex flex-wrap gap-3">
<button
onClick={calibrateNow}
className="rounded-full border border-white/20 px-5 py-3 text-sm tracking-[0.18em] text-white transition hover:border-white/40 hover:bg-white/5"
>
CALIBRATE ALIGN
</button>

<div className="rounded-full border border-white/10 px-5 py-3 text-sm tracking-[0.18em] text-white/45">
{baselineLocked ? "BASELINE LOCKED" : "WAITING FOR SENSOR"}
</div>

<button
onClick={() => setShowDetails((prev) => !prev)}
className="rounded-full border border-white/10 px-5 py-3 text-sm tracking-[0.18em] text-white/60 transition hover:border-white/30 hover:text-white"
>
{showDetails ? "HIDE DETAILS" : "SHOW DETAILS"}
</button>
</div>
)}

{permissionDenied ? (
<div className="mt-6 rounded-3xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
Motion permission was denied.
</div>
) : null}

<section className="mt-10 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.03]">
<div className="border-b border-white/10 px-8 py-6">
<div className="text-[11px] uppercase tracking-[0.35em] text-white/35">
State
</div>

<div className="mt-4 flex items-center gap-4">
<SignalDot state={heldState} />
<div className="text-5xl font-semibold tracking-[0.18em] sm:text-7xl">
{stateText}
</div>
</div>

<div className="mt-4 text-base tracking-[0.05em] text-white/60 sm:text-lg">
{meaningText}
</div>
</div>

<div className="grid gap-0 sm:grid-cols-2">
<StatBlock
label="Stability"
value={stabilityText}
sublabel="Closeness to aligned baseline"
/>
<StatBlock
label="Aligned Time"
value={`${round(alignedTimePct)}%`}
sublabel="Time spent organized and stable"
withBorder
/>
<StatBlock
label="Best Stability"
value={bestStability}
sublabel="Best lock reached this session"
topBorder
/>
<StatBlock
label="Baseline"
value={baselineLocked ? "LOCKED" : "WAIT"}
sublabel="Reference point for this session"
withBorder
topBorder
/>
</div>
</section>

{showDetails ? (
<section className="mt-6 grid gap-4 sm:grid-cols-2">
<DetailCard
label="Forward Lean"
value={tiltText}
description="Front or back deviation from your calibrated start"
/>
<DetailCard
label="Body Turn"
value={rotationText}
description="Twist away from your calibrated start"
/>
</section>
) : null}
</div>
</main>
);
}

function SignalDot({ state }: { state: AxisState }) {
const dotClass =
state === "aligned"
? "bg-white shadow-[0_0_18px_rgba(255,255,255,0.45)]"
: state === "shift"
? "bg-white/70"
: state === "recover"
? "bg-white/55"
: "bg-white/35";

return <div className={`h-4 w-4 rounded-full ${dotClass}`} />;
}

function StatBlock({
label,
value,
sublabel,
withBorder = false,
topBorder = false,
}: {
label: string;
value: string | number;
sublabel: string;
withBorder?: boolean;
topBorder?: boolean;
}) {
return (
<div
className={[
"px-8 py-7",
withBorder ? "sm:border-l sm:border-white/10" : "",
topBorder ? "border-t border-white/10" : "",
].join(" ")}
>
<div className="text-[10px] uppercase tracking-[0.32em] text-white/35">
{label}
</div>
<div className="mt-3 text-4xl font-semibold tracking-[0.14em]">{value}</div>
<div className="mt-2 text-sm text-white/45">{sublabel}</div>
</div>
);
}

function DetailCard({
label,
value,
description,
}: {
label: string;
value: string | number;
description: string;
}) {
return (
<div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
<div className="text-[10px] uppercase tracking-[0.32em] text-white/35">
{label}
</div>
<div className="mt-3 text-4xl font-semibold tracking-[0.14em]">{value}</div>
<div className="mt-2 text-sm text-white/45">{description}</div>
</div>
);
}