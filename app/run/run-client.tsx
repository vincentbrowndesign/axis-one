"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type AxisSample = {
t: number;
accel: { x: number; y: number; z: number };
accelIncludingGravity: { x: number; y: number; z: number };
rotationRate: { alpha: number; beta: number; gamma: number };
orientation: { alpha: number; beta: number; gamma: number };
};

type AxisTag = {
id: number;
t: number;
label: string;
};

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
// keep 3 decimals like your files
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

async function requestMotionPermission(): Promise<{
granted: boolean;
message: string;
}> {
// iOS Safari requires permission via user gesture
const DeviceMotionAny = DeviceMotionEvent as unknown as {
requestPermission?: () => Promise<"granted" | "denied">;
};

if (typeof DeviceMotionAny?.requestPermission === "function") {
try {
const res = await DeviceMotionAny.requestPermission();
if (res === "granted") return { granted: true, message: "Permission granted." };
return { granted: false, message: "Permission denied." };
} catch {
return { granted: false, message: "Permission request failed." };
}
}

// Android/desktop usually doesn't need explicit permission
return { granted: true, message: "Permission granted." };
}

export default function RunClient() {
const environment = "basketball";

const [permission, setPermission] = useState<{
granted: boolean;
message: string;
}>({ granted: false, message: "Idle" });

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

// “latest reading” refs so we can sample at ~60Hz on RAF
const latestAccelRef = useRef(lastAccel);
const latestAccelGRef = useRef(lastAccelG);
const latestGyroRef = useRef(lastGyro);
const latestOriRef = useRef(lastOri);

useEffect(() => {
latestAccelRef.current = lastAccel;
}, [lastAccel]);
useEffect(() => {
latestAccelGRef.current = lastAccelG;
}, [lastAccelG]);
useEffect(() => {
latestGyroRef.current = lastGyro;
}, [lastGyro]);
useEffect(() => {
latestOriRef.current = lastOri;
}, [lastOri]);

const rafRef = useRef<number | null>(null);
const lastPushMsRef = useRef<number>(0);

// Attach listeners (but only record when isRunning === true)
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
setLastOri({
alpha: n(e.alpha),
beta: n(e.beta),
gamma: n(e.gamma),
});
}

window.addEventListener("devicemotion", onMotion as any, { passive: true });
window.addEventListener("deviceorientation", onOrientation as any, { passive: true });

return () => {
window.removeEventListener("devicemotion", onMotion as any);
window.removeEventListener("deviceorientation", onOrientation as any);
};
}, []);

// Sampling loop (~60Hz)
useEffect(() => {
if (!isRunning) {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
return;
}

const tick = (now: number) => {
// throttle close to 60Hz
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

// reset timing only if first start in this run
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
// you can change label later (e.g., "stepback", "crossover")
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
if (isRunning) return "Permission granted.";
if (permission.granted) return "Permission granted.";
return "Idle";
}, [isRunning, permission.granted]);

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-2xl px-5 py-10">
<h1 className="text-5xl font-semibold tracking-tight">Run (Axis One)</h1>
<p className="mt-3 text-xl text-white/60">
Capture motion, tag decision windows, export the session.
</p>

<div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
<div className="text-sm text-white/50">Axis One • Run</div>
<div className="mt-2 text-4xl font-semibold">{statusText}</div>

<div className="mt-6 grid grid-cols-2 gap-4">
<button
onClick={onEnableSensors}
className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6 text-lg font-semibold disabled:opacity-40"
>
1) Enable
<br />
Sensors
</button>

<button
onClick={onStart}
disabled={!canStart}
className="rounded-2xl bg-white px-5 py-6 text-lg font-semibold text-black disabled:opacity-40"
>
2) Start
</button>

<button
onClick={onStop}
disabled={!canStop}
className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold disabled:opacity-40"
>
Stop
</button>

<button
onClick={onDecision}
disabled={!canTag}
className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold disabled:opacity-40"
>
Decision
</button>
</div>

<button
onClick={onTag}
disabled={!canTag}
className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold disabled:opacity-40"
>
3) Tag
</button>

<button
onClick={onDownload}
className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-lg font-semibold"
>
Download JSON
</button>

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

{/* Live sensor readouts (matches your “cards” section) */}
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

function SensorCard({
title,
rows,
}: {
title: string;
rows: Array<[string, number]>;
}) {
return (
<div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-6">
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