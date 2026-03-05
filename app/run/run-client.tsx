"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import AxisLiveChart from "@/components/AxisLiveChart";

type AxisSample = {
t: number;
accel: { x: number; y: number; z: number };
accelIncludingGravity: { x: number; y: number; z: number };
rotationRate: { alpha: number; beta: number; gamma: number };
orientation: { alpha: number; beta: number; gamma: number };
};

type AxisTag = { id: number; t: number; label: string };

type AxisSessionExport = {
exported_at: string;
environment: string;
started_at_epoch_ms?: number;
ended_at_epoch_ms?: number;
samples_count: number;
tags_count: number;
samples: AxisSample[];
tags?: AxisTag[];
};

function n(v: unknown): number {
const x = typeof v === "number" && Number.isFinite(v) ? v : 0;
return Math.round(x * 1000) / 1000;
}

function downloadJson(filename: string, obj: unknown) {
const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
}

async function requestMotionPermission(): Promise<{ granted: boolean; message: string }> {
const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };

if (typeof DME?.requestPermission === "function") {
try {
const res = await DME.requestPermission();
if (res === "granted") return { granted: true, message: "Permission granted." };
return { granted: false, message: "Permission denied." };
} catch {
return { granted: false, message: "Permission request failed." };
}
}
return { granted: true, message: "Permission granted." };
}

export default function RunClient() {
const environment = "basketball";

const [permission, setPermission] = useState<{ granted: boolean; message: string }>({
granted: false,
message: "Idle",
});
const [isRunning, setIsRunning] = useState(false);

const [samplesCount, setSamplesCount] = useState(0);
const [tagsCount, setTagsCount] = useState(0);

const [lastAccel, setLastAccel] = useState({ x: 0, y: 0, z: 0 });
const [lastAccelG, setLastAccelG] = useState({ x: 0, y: 0, z: 0 });
const [lastGyro, setLastGyro] = useState({ alpha: 0, beta: 0, gamma: 0 });
const [lastOri, setLastOri] = useState({ alpha: 0, beta: 0, gamma: 0 });

const startedAtRef = useRef<number | undefined>(undefined);
const endedAtRef = useRef<number | undefined>(undefined);

const samplesRef = useRef<AxisSample[]>([]);
const tagsRef = useRef<AxisTag[]>([]);
const tagIdRef = useRef(1);

// live signal buffer (Axis Line)
const [axisLine, setAxisLine] = useState<number[]>([]);
const axisLineRef = useRef<number[]>([]);
const AXIS_LINE_LEN = 180;

// latest refs to sample at ~60Hz
const latestAccelRef = useRef(lastAccel);
const latestAccelGRef = useRef(lastAccelG);
const latestGyroRef = useRef(lastGyro);
const latestOriRef = useRef(lastOri);

useEffect(() => void (latestAccelRef.current = lastAccel), [lastAccel]);
useEffect(() => void (latestAccelGRef.current = lastAccelG), [lastAccelG]);
useEffect(() => void (latestGyroRef.current = lastGyro), [lastGyro]);
useEffect(() => void (latestOriRef.current = lastOri), [lastOri]);

const rafRef = useRef<number | null>(null);
const lastPushMsRef = useRef<number>(0);

// sensor listeners
useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
const a = e.acceleration;
const ag = e.accelerationIncludingGravity;
const r = e.rotationRate;

if (a) setLastAccel({ x: n(a.x), y: n(a.y), z: n(a.z) });
if (ag) setLastAccelG({ x: n(ag.x), y: n(ag.y), z: n(ag.z) });

if (r) {
setLastGyro({
alpha: n((r as any).alpha),
beta: n((r as any).beta),
gamma: n((r as any).gamma),
});
}
}

function onOrientation(e: DeviceOrientationEvent) {
setLastOri({ alpha: n(e.alpha), beta: n(e.beta), gamma: n(e.gamma) });
}

window.addEventListener("devicemotion", onMotion as any, { passive: true });
window.addEventListener("deviceorientation", onOrientation as any, { passive: true });

return () => {
window.removeEventListener("devicemotion", onMotion as any);
window.removeEventListener("deviceorientation", onOrientation as any);
};
}, []);

// sampling loop (~60Hz)
useEffect(() => {
if (!isRunning) {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
return;
}

const tick = (now: number) => {
if (now - lastPushMsRef.current >= 1000 / 60) {
lastPushMsRef.current = now;

const t = Date.now();
const sample: AxisSample = {
t,
accel: { ...latestAccelRef.current },
accelIncludingGravity: { ...latestAccelGRef.current },
rotationRate: { ...latestGyroRef.current },
orientation: { ...latestOriRef.current },
};

samplesRef.current.push(sample);
setSamplesCount(samplesRef.current.length);

// ---- Axis Line signal (stable version):
// magnitude of accelIncludingGravity, minus gravity baseline drift by using a tiny high-pass
const ag = sample.accelIncludingGravity;
const mag = Math.sqrt(ag.x * ag.x + ag.y * ag.y + ag.z * ag.z);

// quick high-pass: mag - EMA(mag)
const prev = axisLineRef.current;
const emaPrev = prev.length ? prev[prev.length - 1] : mag;
const ema = emaPrev + 0.08 * (mag - emaPrev);
const hp = mag - ema;

const next = prev.length >= AXIS_LINE_LEN ? prev.slice(1) : prev.slice();
next.push(n(hp));
axisLineRef.current = next;
setAxisLine(next);
}

rafRef.current = requestAnimationFrame(tick);
};

rafRef.current = requestAnimationFrame(tick);
return () => {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
};
}, [isRunning]);

const canStart = permission.granted && !isRunning;
const canStop = isRunning;
const canTag = isRunning;

async function onEnableSensors() {
const res = await requestMotionPermission();
setPermission(res);
}

function onStart() {
if (!permission.granted) return;

if (!startedAtRef.current) startedAtRef.current = Date.now();
endedAtRef.current = undefined;

setIsRunning(true);
}

function onStop() {
setIsRunning(false);
endedAtRef.current = Date.now();
}

function addTag(label: string) {
if (!isRunning) return;
const t = Date.now();
const tag: AxisTag = { id: tagIdRef.current++, t, label };
tagsRef.current.push(tag);
setTagsCount(tagsRef.current.length);
}

function onDecision() {
addTag("decision");
}

function onTag() {
const label = prompt("Tag label (e.g., stepback, crossover):")?.trim();
if (!label) return;
addTag(label);
}

function onDownload() {
const exported: AxisSessionExport = {
exported_at: new Date().toISOString(),
environment,
started_at_epoch_ms: startedAtRef.current,
ended_at_epoch_ms: endedAtRef.current ?? (isRunning ? Date.now() : undefined),
samples_count: samplesRef.current.length,
tags_count: tagsRef.current.length,
samples: samplesRef.current,
tags: tagsRef.current,
};

const stamp = exported.exported_at.replace(/[:.]/g, "-");
downloadJson(`axis-one-session-${stamp}.json`, exported);
}

const statusText = useMemo(() => {
if (isRunning) return "Capturing... move the device.";
if (permission.granted) return "Permission granted.";
return "Idle";
}, [isRunning, permission.granted]);

return (
<div className="min-h-screen bg-black text-white">
{/* Background pop */}
<div className="pointer-events-none fixed inset-0">
<div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
<div className="absolute -bottom-48 left-1/4 h-[520px] w-[520px] rounded-full bg-white/5 blur-3xl" />
<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.12),transparent_55%)]" />
</div>

<div className="relative mx-auto max-w-2xl px-5 py-10">
<h1 className="text-5xl font-semibold tracking-tight">Run (Axis One)</h1>
<p className="mt-3 text-xl text-white/60">
Capture motion, tag decision windows, export the session.
</p>

<div className="mt-8 rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_80px_rgba(0,0,0,0.55)]">
<div className="text-sm text-white/50">Axis One • Run</div>
<div className="mt-2 text-4xl font-semibold">{statusText}</div>

<div className="mt-6 grid grid-cols-2 gap-4">
<button
onClick={onEnableSensors}
className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6 text-lg font-semibold hover:bg-white/10 active:scale-[0.99]"
>
1) Enable
<br />
Sensors
</button>

<button
onClick={onStart}
disabled={!canStart}
className="rounded-2xl bg-white px-5 py-6 text-lg font-semibold text-black hover:bg-white/90 disabled:opacity-40 active:scale-[0.99]"
>
2) Start
</button>

<button
onClick={onStop}
disabled={!canStop}
className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold hover:bg-white/10 disabled:opacity-40 active:scale-[0.99]"
>
Stop
</button>

<button
onClick={onDecision}
disabled={!canTag}
className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold hover:bg-white/10 disabled:opacity-40 active:scale-[0.99]"
>
Decision
</button>
</div>

<button
onClick={onTag}
disabled={!canTag}
className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold hover:bg-white/10 disabled:opacity-40 active:scale-[0.99]"
>
3) Tag
</button>

<button
onClick={onDownload}
className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold hover:bg-white/10 active:scale-[0.99]"
>
Download JSON
</button>

{/* Axis Line Card */}
<div className="mt-6 rounded-3xl border border-white/10 bg-black/30 p-5">
<div className="flex items-center justify-between">
<div className="text-lg font-semibold">Axis Line</div>
<div className="text-xs text-white/50">live signal</div>
</div>
<div className="mt-3">
<AxisLiveChart data={axisLine} height={150} />
</div>
<div className="mt-3 text-xs text-white/50">
(This is a stable high-pass signal from accel+gravity magnitude. Next step is D/R/J extraction.)
</div>
</div>

<div className="mt-6 grid grid-cols-2 gap-4">
<div className="rounded-2xl border border-white/10 bg-white/5 p-5">
<div className="text-sm text-white/50">Samples</div>
<div className="mt-1 text-5xl font-semibold">{samplesCount}</div>
<div className="mt-1 text-white/50">~60 Hz</div>
</div>

<div className="rounded-2xl border border-white/10 bg-white/5 p-5">
<div className="text-sm text-white/50">Tags</div>
<div className="mt-1 text-5xl font-semibold">{tagsCount}</div>
<div className="mt-1 text-white/50">Decision events</div>
</div>
</div>

<div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
<div className="text-sm text-white/50">Permission</div>
<div className="mt-1 text-lg font-semibold">{permission.message}</div>
<div className="mt-2 text-sm text-white/50">
Tip: iPhone Safari requires tapping <span className="font-semibold text-white/70">Enable Sensors</span>{" "}
first. If values stay null, check iOS Settings → Safari → Motion & Orientation Access.
</div>
</div>
</div>

{/* Readouts */}
<div className="mt-6 space-y-4">
<SensorCard
title="Acceleration (m/s²-ish)"
rows={[
["x", lastAccel.x],
["y", lastAccel.y],
["z", lastAccel.z],
]}
/>
<SensorCard
title="Accel + Gravity"
rows={[
["x", lastAccelG.x],
["y", lastAccelG.y],
["z", lastAccelG.z],
]}
/>
<SensorCard
title="Rotation Rate (gyro-ish)"
rows={[
["alpha", lastGyro.alpha],
["beta", lastGyro.beta],
["gamma", lastGyro.gamma],
]}
/>
<SensorCard
title="Orientation (angles)"
rows={[
["alpha", lastOri.alpha],
["beta", lastOri.beta],
["gamma", lastOri.gamma],
]}
/>
</div>
</div>
</div>
);
}

function SensorCard({ title, rows }: { title: string; rows: Array<[string, number]> }) {
return (
<div className="mx-auto max-w-2xl rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
<div className="text-3xl font-semibold">{title}</div>
<div className="mt-4 space-y-3">
{rows.map(([k, v]) => (
<div key={k} className="flex items-center justify-between text-xl">
<div className="text-white/70">{k}</div>
<div className="font-semibold tabular-nums">{v ? v : "—"}</div>
</div>
))}
</div>
</div>
);
}