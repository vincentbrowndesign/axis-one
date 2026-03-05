"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AxisLineCanvas from "@/components/AxisLineCanvas";
import { makePusherClient } from "@/lib/pusher-client";

type RunState = "idle" | "ready" | "capturing";

type Sample = {
t: number;
ax: number;
ay: number;
az: number;
amag: number; // accel+gravity magnitude
};

function id(prefix = "sess_") {
return prefix + Math.random().toString(36).slice(2, 14);
}

function clamp(n: number, lo: number, hi: number) {
return Math.max(lo, Math.min(hi, n));
}

// Simple high-pass-ish: y[n] = a*(y[n-1] + x[n] - x[n-1])
function hpFilter(series: number[], a = 0.92) {
const out: number[] = [];
let y = 0;
let prev = series[0] ?? 0;
for (let i = 0; i < series.length; i++) {
const x = series[i] ?? 0;
y = a * (y + x - prev);
out.push(y);
prev = x;
}
return out;
}

export default function RunClient() {
const [runState, setRunState] = useState<RunState>("idle");
const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
const [sessionId, setSessionId] = useState<string>(() => id());
const [samples, setSamples] = useState<Sample[]>([]);
const [tags, setTags] = useState<number>(0);
const [lastCmd, setLastCmd] = useState<string>("");

const capturingRef = useRef(false);
const rafRef = useRef<number | null>(null);

// iOS motion
const lastAccelRef = useRef<{ x: number; y: number; z: number } | null>(null);
const lastAccelGRef = useRef<{ x: number; y: number; z: number } | null>(null);

const channelName = useMemo(() => `private-axis-${sessionId}`, [sessionId]);

// Subscribe to remote commands
useEffect(() => {
const p = makePusherClient();
const ch = p.subscribe(channelName);

const handler = (payload: any) => {
const action = String(payload?.action || "");
setLastCmd(action);

if (action === "START") doStart();
if (action === "STOP") doStop();
if (action === "TAG") doTag();
if (action === "DECISION") doDecision();
};

ch.bind("remote-command", handler);

return () => {
try {
ch.unbind("remote-command", handler);
p.unsubscribe(channelName);
p.disconnect();
} catch {}
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [channelName]);

// DeviceMotion listener (does nothing until capturingRef true)
useEffect(() => {
const onMotion = (e: DeviceMotionEvent) => {
// prefer accel+gravity (includes gravity) for your “structure under load” baseline
const ag = e.accelerationIncludingGravity;
const a = e.acceleration;

if (a && (a.x !== null || a.y !== null || a.z !== null)) {
lastAccelRef.current = {
x: Number(a.x ?? 0),
y: Number(a.y ?? 0),
z: Number(a.z ?? 0),
};
}
if (ag && (ag.x !== null || ag.y !== null || ag.z !== null)) {
lastAccelGRef.current = {
x: Number(ag.x ?? 0),
y: Number(ag.y ?? 0),
z: Number(ag.z ?? 0),
};
}
};

window.addEventListener("devicemotion", onMotion);
return () => window.removeEventListener("devicemotion", onMotion);
}, []);

// capture loop
const pump = () => {
if (!capturingRef.current) return;

const ag = lastAccelGRef.current;
const a = lastAccelRef.current;

// if no sensor data, keep looping but don't push garbage
if (ag) {
const amag = Math.sqrt(ag.x * ag.x + ag.y * ag.y + ag.z * ag.z);
const now = performance.now();

setSamples((prev) => {
const next: Sample[] = [
...prev,
{
t: now,
ax: a?.x ?? 0,
ay: a?.y ?? 0,
az: a?.z ?? 0,
amag,
},
];

// keep last ~10 seconds at ~60hz = ~600 samples (lightweight)
const max = 700;
if (next.length > max) return next.slice(next.length - max);
return next;
});

setRunState("capturing");
}

rafRef.current = requestAnimationFrame(pump);
};

const enableSensors = async () => {
try {
// iOS requires permission request
const anyDM = DeviceMotionEvent as any;
if (typeof anyDM?.requestPermission === "function") {
const res = await anyDM.requestPermission();
if (res !== "granted") {
setPermission("denied");
return;
}
}
setPermission("granted");
setRunState("ready");
} catch {
setPermission("denied");
}
};

const doStart = () => {
if (permission !== "granted") return;
if (capturingRef.current) return;

capturingRef.current = true;
setLastCmd("START");
rafRef.current = requestAnimationFrame(pump);
};

const doStop = () => {
capturingRef.current = false;
if (rafRef.current) cancelAnimationFrame(rafRef.current);
rafRef.current = null;
setRunState(permission === "granted" ? "ready" : "idle");
setLastCmd("STOP");
};

const doTag = () => {
setTags((t) => t + 1);
setLastCmd("TAG");
};

const doDecision = () => {
// for now, decision = tag (you can split later)
setTags((t) => t + 1);
setLastCmd("DECISION");
};

const downloadJSON = () => {
const payload = {
exported_at: new Date().toISOString(),
session_id: sessionId,
samples_count: samples.length,
tags_count: tags,
samples,
};
const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `axis-one-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
a.click();
URL.revokeObjectURL(url);
};

// Axis Line series
const axisLine = useMemo(() => {
if (!samples.length) return [];
const mags = samples.map((s) => s.amag);
const filtered = hpFilter(mags, 0.92);
// keep it visually stable
const scaled = filtered.map((v) => clamp(v, -15, 15));
return scaled;
}, [samples]);

return (
<main className="min-h-screen bg-black text-white px-5 py-10">
<div className="max-w-xl mx-auto space-y-6">
<header>
<h1 className="text-5xl font-semibold tracking-tight">Run (Axis One)</h1>
<p className="text-white/60 mt-2">
Capture motion, tag decision windows, export the session.
</p>
<div className="text-white/40 text-sm mt-3">
Session: <span className="text-white/70">{sessionId}</span>{" "}
{lastCmd ? (
<span className="ml-3 text-white/40">
last: <span className="text-white/70">{lastCmd}</span>
</span>
) : null}
</div>
</header>

<section className="rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-white/40 text-sm mb-2">Axis One • Run</div>
<div className="text-4xl font-semibold">
{permission === "granted" ? (runState === "capturing" ? "Capturing…" : "Permission granted.") : "Idle"}
</div>

<div className="grid grid-cols-2 gap-4 mt-6">
<button
onClick={enableSensors}
className="rounded-3xl border border-white/10 bg-white/10 px-6 py-7 text-xl font-semibold active:scale-[0.99]"
>
1) Enable
<br />
Sensors
</button>

<button
onClick={doStart}
disabled={permission !== "granted"}
className="rounded-3xl px-6 py-7 text-xl font-semibold bg-white text-black disabled:opacity-40 active:scale-[0.99]"
>
2) Start
</button>

<button
onClick={doStop}
disabled={runState !== "capturing"}
className="rounded-3xl border border-white/10 bg-white/10 px-6 py-6 text-xl font-semibold disabled:opacity-40 active:scale-[0.99]"
>
Stop
</button>

<button
onClick={doDecision}
disabled={runState !== "capturing"}
className="rounded-3xl border border-white/10 bg-white/10 px-6 py-6 text-xl font-semibold disabled:opacity-40 active:scale-[0.99]"
>
Decision
</button>

<button
onClick={doTag}
disabled={runState !== "capturing"}
className="col-span-2 rounded-3xl border border-white/10 bg-white/10 px-6 py-6 text-xl font-semibold disabled:opacity-40 active:scale-[0.99]"
>
3) Tag
</button>

<button
onClick={downloadJSON}
className="col-span-2 rounded-3xl border border-white/10 bg-white/10 px-6 py-6 text-xl font-semibold active:scale-[0.99]"
>
Download JSON
</button>
</div>
</section>

<section className="rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="flex items-center justify-between">
<h2 className="text-3xl font-semibold">Axis Line</h2>
<div className="text-white/50">live signal</div>
</div>

<div className="mt-4 rounded-3xl border border-white/10 bg-black/40 p-3">
<AxisLineCanvas data={axisLine} height={160} />
</div>

<p className="text-white/45 mt-3">
(Stable high-pass signal from accel+gravity magnitude. Next step is D/R/J extraction.)
</p>
</section>

<section className="grid grid-cols-2 gap-4">
<div className="rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-white/45">Samples</div>
<div className="text-6xl font-semibold mt-2">{samples.length}</div>
<div className="text-white/35 mt-1">~60 Hz</div>
</div>
<div className="rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-white/45">Tags</div>
<div className="text-6xl font-semibold mt-2">{tags}</div>
<div className="text-white/35 mt-1">Decision events</div>
</div>
</section>

<section className="rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-white/50 text-sm mb-2">Pairing</div>
<div className="text-white/80">
Open Controller on another device:
<div className="mt-2 font-mono text-white/70 break-all">
{typeof window !== "undefined"
? `${window.location.origin}/control?sid=${encodeURIComponent(sessionId)}`
: ""}
</div>
</div>
</section>
</div>
</main>
);
}