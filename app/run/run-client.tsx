"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Accel = { x: number | null; y: number | null; z: number | null };
type Gyro = { alpha: number | null; beta: number | null; gamma: number | null };

type Sample = {
t: number; // epoch ms
dt: number; // ms since start
accel: Accel; // m/s^2 (or device-provided)
accelIncludingGravity: Accel;
gyro: Gyro; // deg/s-ish (browser dependent)
rotationRate: Gyro; // from DeviceMotionEvent rotationRate (if available)
};

type Tag = {
t: number; // epoch ms
dt: number; // ms since start
label: string;
};

function clampNum(v: any) {
if (typeof v !== "number") return null;
if (Number.isNaN(v)) return null;
if (!Number.isFinite(v)) return null;
return v;
}

function downloadJson(filename: string, data: unknown) {
const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url);
}

export default function RunClient() {
const [supported, setSupported] = useState<boolean>(true);
const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");

const [isCapturing, setIsCapturing] = useState(false);
const [startEpoch, setStartEpoch] = useState<number | null>(null);

const [accel, setAccel] = useState<Accel>({ x: null, y: null, z: null });
const [accelG, setAccelG] = useState<Accel>({ x: null, y: null, z: null });
const [gyro, setGyro] = useState<Gyro>({ alpha: null, beta: null, gamma: null });
const [rotationRate, setRotationRate] = useState<Gyro>({ alpha: null, beta: null, gamma: null });

const samplesRef = useRef<Sample[]>([]);
const tagsRef = useRef<Tag[]>([]);
const lastTRef = useRef<number | null>(null);

const [sampleCount, setSampleCount] = useState(0);
const [tagCount, setTagCount] = useState(0);

const [status, setStatus] = useState<string>("Idle");
const [label, setLabel] = useState<string>("Decision");

const approxHz = useMemo(() => {
// crude estimate: compute based on last 200 deltas if possible
const s = samplesRef.current;
if (s.length < 5) return null;
const recent = s.slice(-200);
const dts = [];
for (let i = 1; i < recent.length; i++) dts.push(recent[i].t - recent[i - 1].t);
const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
if (!avg || avg <= 0) return null;
return Math.round((1000 / avg) * 10) / 10;
}, [sampleCount]);

useEffect(() => {
// Detect support
const hasDeviceMotion = typeof window !== "undefined" && "DeviceMotionEvent" in window;
const hasDeviceOrientation = typeof window !== "undefined" && "DeviceOrientationEvent" in window;
if (!hasDeviceMotion && !hasDeviceOrientation) {
setSupported(false);
setStatus("Not supported on this device/browser.");
}
}, []);

async function requestPermission() {
try {
// iOS Safari requires explicit permission request.
// Chrome/Android usually doesn't.
const DME: any = (window as any).DeviceMotionEvent;
const DOE: any = (window as any).DeviceOrientationEvent;

// If either has requestPermission, call it (iOS).
if (DME?.requestPermission) {
const res = await DME.requestPermission();
if (res === "granted") {
setPermission("granted");
setStatus("Permission granted.");
return;
} else {
setPermission("denied");
setStatus("Permission denied.");
return;
}
}
if (DOE?.requestPermission) {
const res = await DOE.requestPermission();
if (res === "granted") {
setPermission("granted");
setStatus("Permission granted.");
return;
} else {
setPermission("denied");
setStatus("Permission denied.");
return;
}
}

// Non-iOS: assume allowed (but may still be blocked by settings)
setPermission("granted");
setStatus("Permission not required (or already granted).");
} catch (e: any) {
setPermission("denied");
setStatus(`Permission error: ${e?.message ?? "unknown"}`);
}
}

function onMotion(e: DeviceMotionEvent) {
const t = Date.now();
const start = startEpoch ?? t;
const dt = t - start;

const a = e.acceleration || null;
const ag = e.accelerationIncludingGravity || null;
const rr = (e as any).rotationRate || null;

const nextAccel: Accel = {
x: clampNum(a?.x),
y: clampNum(a?.y),
z: clampNum(a?.z),
};

const nextAccelG: Accel = {
x: clampNum(ag?.x),
y: clampNum(ag?.y),
z: clampNum(ag?.z),
};

const nextRotationRate: Gyro = {
alpha: clampNum(rr?.alpha),
beta: clampNum(rr?.beta),
gamma: clampNum(rr?.gamma),
};

setAccel(nextAccel);
setAccelG(nextAccelG);
setRotationRate(nextRotationRate);

// If you want a single "gyro" signal, rotationRate is closest we get from motion events
setGyro(nextRotationRate);

const sample: Sample = {
t,
dt,
accel: nextAccel,
accelIncludingGravity: nextAccelG,
gyro: nextRotationRate,
rotationRate: nextRotationRate,
};

samplesRef.current.push(sample);

// keep memory sane
if (samplesRef.current.length > 20000) {
samplesRef.current.splice(0, 5000);
}

setSampleCount(samplesRef.current.length);
lastTRef.current = t;
}

function onOrientation(e: DeviceOrientationEvent) {
// Optional: some browsers supply gyro-ish data here (orientation angles)
// We'll store to state for display only
setGyro({
alpha: clampNum(e.alpha),
beta: clampNum(e.beta),
gamma: clampNum(e.gamma),
});
}

function startCapture() {
if (!supported) return;

const now = Date.now();
setStartEpoch(now);
lastTRef.current = null;
samplesRef.current = [];
tagsRef.current = [];
setSampleCount(0);
setTagCount(0);

window.addEventListener("devicemotion", onMotion, { passive: true });
window.addEventListener("deviceorientation", onOrientation, { passive: true });

setIsCapturing(true);
setStatus("Capturing… move the device.");
}

function stopCapture() {
window.removeEventListener("devicemotion", onMotion as any);
window.removeEventListener("deviceorientation", onOrientation as any);

setIsCapturing(false);
setStatus("Stopped.");
}

function tagDecision(customLabel?: string) {
const t = Date.now();
const start = startEpoch ?? t;
const dt = t - start;

const tag: Tag = {
t,
dt,
label: (customLabel ?? label).trim() || "Decision",
};

tagsRef.current.push(tag);
setTagCount(tagsRef.current.length);
}

function exportSession() {
const startedAt = startEpoch ?? Date.now();
const endedAt = Date.now();

const payload = {
exported_at: new Date().toISOString(),
environment: "axis-one",
started_at_epoch_ms: startedAt,
ended_at_epoch_ms: endedAt,
samples_count: samplesRef.current.length,
tags_count: tagsRef.current.length,
samples: samplesRef.current,
tags: tagsRef.current,
};

const stamp = new Date().toISOString().replaceAll(":", "-");
downloadJson(`axis-one-session-${stamp}.json`, payload);
}

return (
<div className="rounded-2xl border border-white/10 bg-white/5 p-6">
<div className="flex items-center justify-between gap-4">
<div>
<div className="text-sm text-white/60">Axis One • Run</div>
<div className="mt-1 text-lg font-semibold">{status}</div>
</div>
<Link href="/" className="text-sm text-white/60 hover:text-white">
Home
</Link>
</div>

{!supported && (
<div className="mt-6 rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white/70">
This browser/device doesn’t expose motion sensors. Try Safari on iPhone or Chrome on Android.
</div>
)}

<div className="mt-6 flex flex-wrap gap-3">
<button
onClick={requestPermission}
className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
>
1) Enable Sensors
</button>

<button
onClick={startCapture}
disabled={permission !== "granted" || isCapturing || !supported}
className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
>
2) Start
</button>

<button
onClick={stopCapture}
disabled={!isCapturing}
className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-40"
>
Stop
</button>

<div className="flex items-center gap-2">
<input
value={label}
onChange={(e) => setLabel(e.target.value)}
placeholder="Tag label"
className="h-9 w-40 rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-white/30"
/>
<button
onClick={() => tagDecision()}
disabled={!isCapturing}
className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-40"
>
3) Tag
</button>
</div>

<button
onClick={exportSession}
disabled={sampleCount === 0}
className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-40"
>
Download JSON
</button>
</div>

<div className="mt-6 grid gap-4 md:grid-cols-3">
<StatCard title="Samples" value={`${sampleCount}`} sub={approxHz ? `~${approxHz} Hz` : "—"} />
<StatCard title="Tags" value={`${tagCount}`} sub="Decision events" />
<StatCard title="Permission" value={permission} sub="Sensor access" />
</div>

<div className="mt-6 grid gap-4 md:grid-cols-2">
<Readout title="Acceleration (m/s²-ish)">
<Line k="x" v={accel.x} />
<Line k="y" v={accel.y} />
<Line k="z" v={accel.z} />
</Readout>

<Readout title="Accel + Gravity">
<Line k="x" v={accelG.x} />
<Line k="y" v={accelG.y} />
<Line k="z" v={accelG.z} />
</Readout>

<Readout title="Rotation Rate (gyro-ish)">
<Line k="alpha" v={rotationRate.alpha} />
<Line k="beta" v={rotationRate.beta} />
<Line k="gamma" v={rotationRate.gamma} />
</Readout>

<Readout title="Orientation (angles)">
<Line k="alpha" v={gyro.alpha} />
<Line k="beta" v={gyro.beta} />
<Line k="gamma" v={gyro.gamma} />
</Readout>
</div>

<div className="mt-6 text-xs text-white/50">
Tip: iPhone Safari requires tapping <b>Enable Sensors</b> first. If values stay null, check iOS Settings → Safari → Motion & Orientation Access.
</div>
</div>
);
}

function StatCard({ title, value, sub }: { title: string; value: string; sub: string }) {
return (
<div className="rounded-2xl border border-white/10 bg-black/30 p-5">
<div className="text-xs font-semibold text-white/60">{title}</div>
<div className="mt-2 text-2xl font-semibold">{value}</div>
<div className="mt-1 text-xs text-white/50">{sub}</div>
</div>
);
}

function Readout({ title, children }: { title: string; children: React.ReactNode }) {
return (
<div className="rounded-2xl border border-white/10 bg-black/30 p-5">
<div className="text-sm font-semibold">{title}</div>
<div className="mt-3 space-y-2">{children}</div>
</div>
);
}

function Line({ k, v }: { k: string; v: number | null }) {
return (
<div className="flex items-center justify-between text-sm">
<div className="text-white/60">{k}</div>
<div className="tabular-nums">{v === null ? "—" : v.toFixed(3)}</div>
</div>
);
}