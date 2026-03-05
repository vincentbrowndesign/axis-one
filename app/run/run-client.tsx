"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Vec3 = { x: number; y: number; z: number };

type AxisOneSample = {
t: number; // epoch ms
accel?: Vec3; // m/s^2-ish (linear accel)
accelIncludingGravity: Vec3; // m/s^2-ish (includes gravity)
rotationRate: { alpha: number; beta: number; gamma: number }; // deg/s-ish on iOS
orientation?: { alpha: number; beta: number; gamma: number }; // degrees
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

function clamp(n: number, lo: number, hi: number) {
return Math.max(lo, Math.min(hi, n));
}

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

function nowIsoForFilename(iso: string) {
return iso.replace(/[:.]/g, "-");
}

async function requestIOSMotionPermission(): Promise<"granted" | "denied" | "unknown"> {
// iOS Safari requires a user gesture and explicit permission
try {
const DME: any = (window as any).DeviceMotionEvent;
if (DME && typeof DME.requestPermission === "function") {
const res = await DME.requestPermission();
return res === "granted" ? "granted" : "denied";
}
return "unknown"; // not iOS permission model
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
const rafRef = useRef<number | null>(null);

const hzEstimate = useMemo(() => {
// rough estimate based on count + duration; you can ignore
const start = startedAtRef.current;
if (!start || samplesCount < 2) return null;
const durSec = (Date.now() - start) / 1000;
if (durSec <= 0) return null;
return samplesCount / durSec;
}, [samplesCount]);

const resetSession = useCallback(() => {
samplesRef.current = [];
tagsRef.current = [];
startedAtRef.current = null;
lastTickMsRef.current = 0;
setSamplesCount(0);
setTagsCount(0);
}, []);

const enableSensors = useCallback(async () => {
const res = await requestIOSMotionPermission();
if (res === "granted") setPermission("granted");
else if (res === "denied") setPermission("denied");
else setPermission("unknown");
}, []);

const onDecision = useCallback(() => {
if (!startedAtRef.current) return;
const t = Date.now();
const dt = t - startedAtRef.current;
tagsRef.current.push({ t, dt, label: "Decision" });
setTagsCount(tagsRef.current.length);
}, []);

const stopCapture = useCallback(() => {
setIsCapturing(false);
}, []);

const startCapture = useCallback(() => {
// must have permission on iOS or "unknown" on other platforms is fine
if (permission === "denied") return;

resetSession();
startedAtRef.current = Date.now();
setIsCapturing(true);
}, [permission, resetSession]);

const downloadJSON = useCallback(() => {
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
tags: tagsRef.current, // ✅ THIS IS THE FIX
};

const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `axis-one-session-${nowIsoForFilename(payload.exported_at)}.json`;
a.click();
URL.revokeObjectURL(url);
}, []);

// DeviceMotion handler (main capture)
useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
if (!isCapturing) return;

const t = Date.now();

// throttle slightly if Safari fires too fast; target ~60Hz
const last = lastTickMsRef.current;
if (last && t - last < 10) return; // ~100Hz cap
lastTickMsRef.current = t;

const a = e.acceleration; // may be null on some devices
const ag = e.accelerationIncludingGravity;
const rr = e.rotationRate;

if (!ag || !rr) return;

const accel = a ? toVec3(a.x, a.y, a.z) : undefined;
const accelIncludingGravity = toVec3(ag.x, ag.y, ag.z);

// iOS rotationRate can be alpha/beta/gamma in deg/s
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

// update UI readouts
if (accel) setLastAccel(accel);
setLastAccelG(accelIncludingGravity);
setLastGyro(rotationRate);
}

window.addEventListener("devicemotion", onMotion as any, { passive: true });
return () => window.removeEventListener("devicemotion", onMotion as any);
}, [isCapturing, lastOri]);

// DeviceOrientation handler (optional, useful for future)
useEffect(() => {
function onOri(e: DeviceOrientationEvent) {
const alpha = safeNum(e.alpha);
const beta = safeNum(e.beta);
const gamma = safeNum(e.gamma);

// keep small noise down; store even if not capturing so it’s ready
setLastOri({
alpha: round3(alpha),
beta: round3(beta),
gamma: round3(gamma),
});
}

window.addEventListener("deviceorientation", onOri as any, { passive: true });
return () => window.removeEventListener("deviceorientation", onOri as any);
}, []);

// auto-stop safety if tab is hidden
useEffect(() => {
function onVis() {
if (document.hidden) setIsCapturing(false);
}
document.addEventListener("visibilitychange", onVis);
return () => document.removeEventListener("visibilitychange", onVis);
}, []);

const statusText = useMemo(() => {
if (permission === "granted") return "Permission granted.";
if (permission === "denied") return "Permission denied.";
if (permission === "unknown") return "Permission not required on this device/browser.";
return "Idle";
}, [permission]);

const capturingText = isCapturing ? "Capturing... move the device." : statusText;

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-xl p-5">
<h1 className="text-4xl font-semibold">Run (Axis One)</h1>
<p className="mt-2 text-white/60">Capture motion, tag decision windows, export the session.</p>

<div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-sm text-white/50">Axis One • Run</div>
<div className="mt-2 text-2xl font-semibold">{capturingText}</div>

<div className="mt-5 grid grid-cols-2 gap-3">
<button
onClick={enableSensors}
className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold hover:bg-white/5"
>
1) Enable Sensors
</button>

<button
onClick={startCapture}
disabled={permission === "denied" || isCapturing}
className={[
"rounded-2xl px-4 py-3 text-sm font-semibold",
isCapturing
? "bg-white/10 text-white/50"
: "bg-white text-black hover:bg-white/90",
permission === "denied" ? "opacity-40" : "",
].join(" ")}
>
2) Start
</button>

<button
onClick={stopCapture}
disabled={!isCapturing}
className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/5 disabled:opacity-40"
>
Stop
</button>

<button
onClick={onDecision}
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
<div className="mt-1 text-xs text-white/50">{hzEstimate ? `~${Math.round(hzEstimate)} Hz` : "—"}</div>
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

<div className="mt-5 text-xs text-white/45">
Export includes <b>samples</b> and <b>tags</b>. History uses <b>tags[].t</b> to slice decision windows.
</div>
</div>
</div>
);
}