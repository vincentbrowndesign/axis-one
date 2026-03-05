"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Vec3 = { x: number; y: number; z: number };

type AxisOneSample = {
t: number; // epoch ms
accel?: Vec3;
accelIncludingGravity: Vec3;
rotationRate: { alpha: number; beta: number; gamma: number };
orientation?: { alpha: number; beta: number; gamma: number };
};

type AxisTag = {
t: number; // epoch ms
dt: number; // ms since start
label: "Decision";
};

type ExportPayload = {
exported_at: string;
environment: string;
started_at_epoch_ms: number;
ended_at_epoch_ms: number;
samples_count: number;
tags_count: number;
samples: AxisOneSample[];
tags: AxisTag[];
};

function round3(n: number) {
return Math.round(n * 1000) / 1000;
}
function safeNum(x: any) {
const n = Number(x);
return Number.isFinite(n) ? n : 0;
}
function toVec3(x: any, y: any, z: any): Vec3 {
return { x: round3(safeNum(x)), y: round3(safeNum(y)), z: round3(safeNum(z)) };
}
function isoForFilename(iso: string) {
return iso.replace(/[:.]/g, "-");
}

async function requestIOSMotionPermission(): Promise<"granted" | "denied" | "unknown"> {
try {
const DME: any = (window as any).DeviceMotionEvent;
if (DME && typeof DME.requestPermission === "function") {
const res = await DME.requestPermission();
return res === "granted" ? "granted" : "denied";
}
return "unknown";
} catch {
return "denied";
}
}

export default function RunClient() {
const [permission, setPermission] = useState<"idle" | "granted" | "denied" | "unknown">("idle");
const [isCapturing, setIsCapturing] = useState(false);

const [samplesCount, setSamplesCount] = useState(0);
const [tagsCount, setTagsCount] = useState(0);

const [lastAccel, setLastAccel] = useState<Vec3 | null>(null);
const [lastAccelG, setLastAccelG] = useState<Vec3 | null>(null);
const [lastGyro, setLastGyro] = useState<{ alpha: number; beta: number; gamma: number } | null>(null);
const [lastOri, setLastOri] = useState<{ alpha: number; beta: number; gamma: number } | null>(null);

const samplesRef = useRef<AxisOneSample[]>([]);
const tagsRef = useRef<AxisTag[]>([]);
const startedAtRef = useRef<number | null>(null);

const lastTickMsRef = useRef<number>(0);

const statusText = useMemo(() => {
if (permission === "granted") return "Permission granted.";
if (permission === "denied") return "Permission denied.";
if (permission === "unknown") return "Permission not required.";
return "Idle";
}, [permission]);

const headerText = isCapturing ? "Capturing... move the device." : statusText;

async function enableSensors() {
const res = await requestIOSMotionPermission();
if (res === "granted") setPermission("granted");
else if (res === "denied") setPermission("denied");
else setPermission("unknown");
}

function start() {
if (permission === "denied") return;

samplesRef.current = [];
tagsRef.current = [];
setSamplesCount(0);
setTagsCount(0);

startedAtRef.current = Date.now();
setIsCapturing(true);
}

function stop() {
setIsCapturing(false);
}

function decision() {
if (!isCapturing) return;
const now = Date.now();
const startedAt = startedAtRef.current ?? now;
tagsRef.current.push({ t: now, dt: now - startedAt, label: "Decision" });
setTagsCount(tagsRef.current.length);
}

function downloadJSON() {
const startedAt = startedAtRef.current ?? Date.now();
const endedAt = Date.now();

const payload: ExportPayload = {
exported_at: new Date().toISOString(),
environment: "basketball",
started_at_epoch_ms: startedAt,
ended_at_epoch_ms: endedAt,
samples_count: samplesRef.current.length,
tags_count: tagsRef.current.length,
samples: samplesRef.current,
tags: tagsRef.current, // ✅ tags included
};

const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `axis-one-session-${isoForFilename(payload.exported_at)}.json`;
a.click();
URL.revokeObjectURL(url);
}

// capture motion
useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
if (!isCapturing) return;

const t = Date.now();

// soft cap to avoid insane event spam
const last = lastTickMsRef.current;
if (last && t - last < 10) return;
lastTickMsRef.current = t;

const ag = e.accelerationIncludingGravity;
const rr = e.rotationRate;

if (!ag || !rr) return;

const accel = e.acceleration ? toVec3(e.acceleration.x, e.acceleration.y, e.acceleration.z) : undefined;
const accelIncludingGravity = toVec3(ag.x, ag.y, ag.z);

const rotationRate = {
alpha: round3(safeNum((rr as any).alpha)),
beta: round3(safeNum((rr as any).beta)),
gamma: round3(safeNum((rr as any).gamma)),
};

const sample: AxisOneSample = {
t,
accel,
accelIncludingGravity,
rotationRate,
orientation: lastOri ?? undefined,
};

samplesRef.current.push(sample);
setSamplesCount(samplesRef.current.length);

if (accel) setLastAccel(accel);
setLastAccelG(accelIncludingGravity);
setLastGyro(rotationRate);
}

window.addEventListener("devicemotion", onMotion as any, { passive: true });
return () => window.removeEventListener("devicemotion", onMotion as any);
}, [isCapturing, lastOri]);

// orientation (optional)
useEffect(() => {
function onOri(e: DeviceOrientationEvent) {
setLastOri({
alpha: round3(safeNum(e.alpha)),
beta: round3(safeNum(e.beta)),
gamma: round3(safeNum(e.gamma)),
});
}
window.addEventListener("deviceorientation", onOri as any, { passive: true });
return () => window.removeEventListener("deviceorientation", onOri as any);
}, []);

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-xl p-5">
<h1 className="text-4xl font-semibold">Run (Axis One)</h1>
<p className="mt-2 text-white/60">Capture motion, tag decision windows, export the session.</p>

<div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-sm text-white/50">Axis One • Run</div>
<div className="mt-2 text-2xl font-semibold">{headerText}</div>

<div className="mt-5 grid grid-cols-2 gap-3">
<button
onClick={enableSensors}
className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold hover:bg-white/5"
>
1) Enable Sensors
</button>

<button
onClick={start}
disabled={permission === "denied" || isCapturing}
className={[
"rounded-2xl px-4 py-3 text-sm font-semibold",
isCapturing ? "bg-white/10 text-white/50" : "bg-white text-black hover:bg-white/90",
permission === "denied" ? "opacity-40" : "",
].join(" ")}
>
2) Start
</button>

<button
onClick={stop}
disabled={!isCapturing}
className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 disabled:opacity-40"
>
Stop
</button>

<button
onClick={decision}
disabled={!isCapturing}
className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold hover:bg-white/5 disabled:opacity-40"
>
Decision
</button>

<button
onClick={downloadJSON}
disabled={samplesCount < 10}
className="col-span-2 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold hover:bg-white/5 disabled:opacity-40"
>
Download JSON
</button>
</div>

<div className="mt-5 grid gap-3">
<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
<div className="text-xs text-white/50">Samples</div>
<div className="mt-1 text-3xl font-semibold">{samplesCount}</div>
<div className="mt-1 text-xs text-white/50">~60 Hz</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
<div className="text-xs text-white/50">Tags</div>
<div className="mt-1 text-3xl font-semibold">{tagsCount}</div>
<div className="mt-1 text-xs text-white/50">Decision events</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
<div className="text-xs text-white/50">Permission</div>
<div className="mt-1 text-3xl font-semibold">
{permission === "idle" ? "idle" : permission}
</div>
<div className="mt-1 text-xs text-white/50">Sensor access</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
<div className="text-lg font-semibold">Acceleration (m/s²-ish)</div>
<div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/80">
<div>x</div><div className="text-right">{lastAccel?.x ?? "—"}</div>
<div>y</div><div className="text-right">{lastAccel?.y ?? "—"}</div>
<div>z</div><div className="text-right">{lastAccel?.z ?? "—"}</div>
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
<div className="text-lg font-semibold">Accel + Gravity</div>
<div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/80">
<div>x</div><div className="text-right">{lastAccelG?.x ?? "—"}</div>
<div>y</div><div className="text-right">{lastAccelG?.y ?? "—"}</div>
<div>z</div><div className="text-right">{lastAccelG?.z ?? "—"}</div>
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
<div className="text-lg font-semibold">Rotation Rate (gyro-ish)</div>
<div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/80">
<div>alpha</div><div className="text-right">{lastGyro?.alpha ?? "—"}</div>
<div>beta</div><div className="text-right">{lastGyro?.beta ?? "—"}</div>
<div>gamma</div><div className="text-right">{lastGyro?.gamma ?? "—"}</div>
</div>
</div>

<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
<div className="text-lg font-semibold">Orientation (angles)</div>
<div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/80">
<div>alpha</div><div className="text-right">{lastOri?.alpha ?? "—"}</div>
<div>beta</div><div className="text-right">{lastOri?.beta ?? "—"}</div>
<div>gamma</div><div className="text-right">{lastOri?.gamma ?? "—"}</div>
</div>

<div className="mt-4 text-xs text-white/45">
Tip: iPhone Safari requires tapping <b>Enable Sensors</b> first. If values stay null, check iOS
Settings → Safari → Motion & Orientation Access.
</div>
</div>
</div>
</div>
</div>
</div>
);
}