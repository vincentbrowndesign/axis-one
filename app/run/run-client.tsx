// app/run/run-client.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Pusher from "pusher-js";
import { saveLastRun } from "@/lib/runStore";

type Sample = { t: number; mag: number };

function uid() {
return (
Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
);
}

function btnClass(primary = false) {
return [
"px-4 py-3 rounded-xl border text-sm",
"bg-neutral-900 border-neutral-700 text-white",
primary ? "ring-1 ring-emerald-500/40 border-emerald-600/40" : "",
].join(" ");
}

export default function RunClient() {
const [status, setStatus] = useState<"ready" | "running" | "stopped">("ready");
const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
const [sid, setSid] = useState<string>("");

const samplesRef = useRef<Sample[]>([]);
const [avg, setAvg] = useState(0);
const [peak, setPeak] = useState(0);
const [stability, setStability] = useState(100);
const [tags, setTags] = useState<number[]>([]);

// ---- SID / pairing link ----
useEffect(() => {
const url = new URL(window.location.href);
const fromUrl = url.searchParams.get("sid");

if (fromUrl) {
setSid(fromUrl);
localStorage.setItem("axis:sid", fromUrl);
return;
}

const fromStorage = localStorage.getItem("axis:sid");
const newSid = fromStorage || uid();

setSid(newSid);
localStorage.setItem("axis:sid", newSid);

url.searchParams.set("sid", newSid);
window.history.replaceState({}, "", url.toString());
}, []);

const controlUrl = useMemo(() => {
if (!sid) return "";
const base = window.location.origin;
return `${base}/control?sid=${encodeURIComponent(sid)}`;
}, [sid]);

// ---- Pusher subscribe: listen for controller commands ----
useEffect(() => {
if (!sid) return;

const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

if (!key || !cluster) return;

const pusher = new Pusher(key, { cluster });

const channelName = `axis-${sid}`;
const channel = pusher.subscribe(channelName);

channel.bind("control", (msg: any) => {
const type = msg?.type as string;

if (type === "start") start();
if (type === "stop") stop();
if (type === "reset") reset();
if (type === "tag") tagDecision();
});

return () => {
try {
channel.unbind_all();
pusher.unsubscribe(channelName);
pusher.disconnect();
} catch {}
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [sid]);

// ---- Motion permission ----
async function requestMotion() {
try {
// iOS requires a user gesture and DeviceMotionEvent.requestPermission
const anyDM = DeviceMotionEvent as any;
if (typeof anyDM?.requestPermission === "function") {
const res = await anyDM.requestPermission();
setPermission(res === "granted" ? "granted" : "denied");
} else {
setPermission("granted");
}
} catch {
setPermission("denied");
}
}

// ---- Sensor loop ----
useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
if (status !== "running") return;

const ax = e.accelerationIncludingGravity?.x ?? 0;
const ay = e.accelerationIncludingGravity?.y ?? 0;
const az = e.accelerationIncludingGravity?.z ?? 0;

const mag = Math.sqrt(ax * ax + ay * ay + az * az);
samplesRef.current.push({ t: Date.now(), mag });

// keep last ~90s at 20Hz-ish (guard)
if (samplesRef.current.length > 2500) samplesRef.current.shift();
}

window.addEventListener("devicemotion", onMotion);
return () => window.removeEventListener("devicemotion", onMotion);
}, [status]);

// ---- UI metrics update loop ----
useEffect(() => {
const id = setInterval(() => {
const data = samplesRef.current;
if (data.length < 2) {
setAvg(0);
setPeak(0);
setStability(100);
return;
}

let sum = 0;
let pk = 0;

for (const s of data) {
sum += s.mag;
if (s.mag > pk) pk = s.mag;
}

const a = sum / data.length;

// simple “stability”: % of samples within +/- 15% of avg
let within = 0;
const band = a * 0.15;
for (const s of data) {
if (Math.abs(s.mag - a) <= band) within++;
}

setAvg(Number(a.toFixed(2)));
setPeak(Number(pk.toFixed(2)));
setStability(Math.round((within / data.length) * 100));
}, 250);

return () => clearInterval(id);
}, []);

function start() {
if (status === "running") return;
samplesRef.current = [];
setTags([]);
setStatus("running");
}

function stop() {
if (status !== "running") return;
setStatus("stopped");

const data = samplesRef.current;
const startedAt = data[0]?.t ?? Date.now();
const endedAt = data[data.length - 1]?.t ?? Date.now();
const durationMs = Math.max(0, endedAt - startedAt);

const lastRun = {
sid,
startedAt,
endedAt,
durationMs,
tags,
samples: data,
};

// ✅ Save using shared store (Measure reads this format)
saveLastRun(lastRun as any);
}

function reset() {
samplesRef.current = [];
setTags([]);
setStatus("ready");
setAvg(0);
setPeak(0);
setStability(100);

try {
localStorage.removeItem("axis:lastRun");
localStorage.removeItem("axis:lastRunAt");
if (sid) localStorage.removeItem(`axis:lastRun:${sid}`);
} catch {}
}

function tagDecision() {
if (status !== "running") return;
setTags((t) => [...t, Date.now()]);
}

async function copyControlLink() {
if (!controlUrl) return;
await navigator.clipboard.writeText(controlUrl);
}

return (
<div className="min-h-screen bg-black text-white">
<div className="max-w-2xl mx-auto p-6">
<div className="flex items-center justify-between gap-3 mb-4">
<div className="flex items-center gap-2">
<div className="h-2 w-2 rounded-full bg-emerald-400" />
<div className="text-lg font-semibold">Axis Run</div>
<div className="text-sm text-neutral-400">{status}</div>
</div>
</div>

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 mb-4">
<div className="text-xs text-neutral-400 mb-2">Controller pairing</div>
<div className="text-sm text-neutral-200 break-all">{controlUrl || "..."}</div>
<div className="flex gap-2 mt-3">
<button className={btnClass(true)} onClick={copyControlLink} disabled={!controlUrl}>
Copy Control Link
</button>
</div>
<div className="text-xs text-neutral-500 mt-2">
Open that link on the controller phone. It will control this session id.
</div>
</div>

<div className="flex flex-wrap gap-2 mb-3">
<button className={btnClass()} onClick={requestMotion}>
Motion Permission
</button>
<button className={btnClass(true)} onClick={start}>
Start
</button>
<button className={btnClass()} onClick={stop}>
Stop
</button>
<button className={btnClass()} onClick={reset}>
Reset
</button>
<button className={btnClass(true)} onClick={tagDecision}>
Tag Decision
</button>
</div>

<div className="text-sm text-neutral-400 mb-4">
Permission: <b className="text-neutral-200">{permission}</b> • Realtime:{" "}
<b className="text-neutral-200">enabled</b> • Tags:{" "}
<b className="text-neutral-200">{tags.length}</b>
</div>

<div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Avg Magnitude</div>
<div className="text-3xl font-semibold mt-2">{avg.toFixed(2)}</div>
</div>
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Peak Magnitude</div>
<div className="text-3xl font-semibold mt-2">{peak.toFixed(2)}</div>
</div>
<div className="rounded-2xl border border-neutral-800 bg-black p-4">
<div className="text-xs text-neutral-400">Stability</div>
<div className="text-3xl font-semibold mt-2">{stability}%</div>
</div>
</div>

<div className="text-xs text-neutral-500 mt-4">
Tip: On iPhone, tap <b className="text-neutral-300">Motion Permission</b> once, then{" "}
<b className="text-neutral-300">Start</b>. Use{" "}
<b className="text-neutral-300">Tag Decision</b> for key moments.
</div>
</div>
</div>
</div>
);
}