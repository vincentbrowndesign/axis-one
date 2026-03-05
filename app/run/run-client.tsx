"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Pusher from "pusher-js";
import { saveLastRun, type AxisRunSummary } from "@/lib/runStore";

type Sample = { t: number; mag: number };

function uid() {
return (
Math.random().toString(36).slice(2, 10) +
Math.random().toString(36).slice(2, 10)
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
const [permission, setPermission] = useState<
"unknown" | "granted" | "denied"
>("unknown");
const [sid, setSid] = useState("");

const samplesRef = useRef<Sample[]>([]);
const tagsRef = useRef<number[]>([]);

const [avg, setAvg] = useState(0);
const [peak, setPeak] = useState(0);
const [stability, setStability] = useState(100);
const [tagsCount, setTagsCount] = useState(0);

const canvasRef = useRef<HTMLCanvasElement | null>(null);
const rafRef = useRef<number | null>(null);

useEffect(() => {
const url = new URL(window.location.href);
const param = url.searchParams.get("sid");

if (param) {
setSid(param);
localStorage.setItem("axis:sid", param);
return;
}

const stored = localStorage.getItem("axis:sid");
const id = stored || uid();

setSid(id);
localStorage.setItem("axis:sid", id);

url.searchParams.set("sid", id);
window.history.replaceState({}, "", url.toString());
}, []);

const controlUrl = useMemo(() => {
if (!sid) return "";
return `${window.location.origin}/control?sid=${sid}`;
}, [sid]);

useEffect(() => {
if (!sid) return;

const key = process.env.NEXT_PUBLIC_PUSHER_KEY!;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER!;

const pusher = new Pusher(key, { cluster });
const channel = pusher.subscribe(`axis-${sid}`);

channel.bind("control", (msg: any) => {
const type = msg?.type;
if (type === "start") start();
if (type === "stop") stop();
if (type === "reset") reset();
if (type === "tag") tagDecision();
});

return () => {
channel.unbind_all();
pusher.unsubscribe(`axis-${sid}`);
pusher.disconnect();
};
}, [sid]);

async function requestMotion() {
try {
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

useEffect(() => {
function onMotion(e: DeviceMotionEvent) {
if (status !== "running") return;

const ax = e.accelerationIncludingGravity?.x ?? 0;
const ay = e.accelerationIncludingGravity?.y ?? 0;
const az = e.accelerationIncludingGravity?.z ?? 0;

const mag = Math.sqrt(ax * ax + ay * ay + az * az);

samplesRef.current.push({
t: Date.now(),
mag,
});

if (samplesRef.current.length > 2500) {
samplesRef.current.shift();
}
}

window.addEventListener("devicemotion", onMotion);
return () => window.removeEventListener("devicemotion", onMotion);
}, [status]);

useEffect(() => {
const id = setInterval(() => {
const data = samplesRef.current;

if (data.length < 2) {
setAvg(0);
setPeak(0);
setStability(100);
setTagsCount(tagsRef.current.length);
return;
}

let sum = 0;
let pk = 0;

for (const s of data) {
sum += s.mag;
if (s.mag > pk) pk = s.mag;
}

const a = sum / data.length;

let within = 0;
const band = a * 0.15;

for (const s of data) {
if (Math.abs(s.mag - a) <= band) within++;
}

setAvg(Number(a.toFixed(2)));
setPeak(Number(pk.toFixed(2)));
setStability(Math.round((within / data.length) * 100));
setTagsCount(tagsRef.current.length);
}, 250);

return () => clearInterval(id);
}, []);

useEffect(() => {
function draw() {
const canvas = canvasRef.current;
if (!canvas) {
rafRef.current = requestAnimationFrame(draw);
return;
}

const ctx = canvas.getContext("2d");
if (!ctx) {
rafRef.current = requestAnimationFrame(draw);
return;
}

const w = canvas.clientWidth;
const h = canvas.clientHeight;

canvas.width = w;
canvas.height = h;

ctx.clearRect(0, 0, w, h);

const data = samplesRef.current;

if (data.length < 2) {
rafRef.current = requestAnimationFrame(draw);
return;
}

const slice = data.slice(-300);

let min = Infinity;
let max = -Infinity;

for (const s of slice) {
if (s.mag < min) min = s.mag;
if (s.mag > max) max = s.mag;
}

const span = max - min || 1;

ctx.strokeStyle = "#34d399";
ctx.lineWidth = 2;
ctx.beginPath();

slice.forEach((s, i) => {
const x = (i / (slice.length - 1)) * w;
const y = h - ((s.mag - min) / span) * h;

if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
});

ctx.stroke();

rafRef.current = requestAnimationFrame(draw);
}

rafRef.current = requestAnimationFrame(draw);

return () => {
if (rafRef.current) cancelAnimationFrame(rafRef.current);
};
}, []);

function start() {
if (status === "running") return;

samplesRef.current = [];
tagsRef.current = [];

setTagsCount(0);
setStatus("running");
}

function stop() {
if (status !== "running") return;

setStatus("stopped");

const data = samplesRef.current;

const startT = data[0]?.t ?? Date.now();
const endT = data[data.length - 1]?.t ?? Date.now();
const duration = endT - startT;

let sum = 0;
let pk = 0;

for (const s of data) {
sum += s.mag;
if (s.mag > pk) pk = s.mag;
}

const avgMag = data.length ? sum / data.length : 0;

let within = 0;
const band = avgMag * 0.15;

for (const s of data) {
if (Math.abs(s.mag - avgMag) <= band) within++;
}

const stab = data.length ? Math.round((within / data.length) * 100) : 100;

let jolts = 0;
for (let i = 1; i < data.length; i++) {
const d = Math.abs(data[i].mag - data[i - 1].mag);
if (d > 2) jolts++;
}

const controlTime = stab;

const resultLabel =
stab >= 85 ? "In Control" : stab >= 65 ? "Searching" : "Out of Control";

const summary: AxisRunSummary = {
sid,
at: Date.now(),
durationMs: duration,
samples: data.length,
tags: tagsRef.current.length,
avgMagnitude: Number(avgMag.toFixed(2)),
peakMagnitude: Number(pk.toFixed(2)),
stability: stab,
controlTime,
jolts,
resultLabel,
};

saveLastRun(summary);
}

function reset() {
samplesRef.current = [];
tagsRef.current = [];

setStatus("ready");
setAvg(0);
setPeak(0);
setStability(100);
setTagsCount(0);
}

function tagDecision() {
if (status !== "running") return;

tagsRef.current.push(Date.now());
setTagsCount(tagsRef.current.length);
}

async function copyControlLink() {
if (!controlUrl) return;
await navigator.clipboard.writeText(controlUrl);
}

return (
<div className="min-h-screen bg-black text-white">
<div className="max-w-2xl mx-auto p-6">
<div className="flex items-center gap-2 mb-4">
<div className="h-2 w-2 rounded-full bg-emerald-400" />
<div className="text-lg font-semibold">Axis Run</div>
<div className="text-sm text-neutral-400">{status}</div>
</div>

<div className="border border-neutral-800 rounded-xl p-4 mb-4">
<div className="text-xs text-neutral-400 mb-1">
Controller pairing
</div>
<div className="text-sm break-all">{controlUrl}</div>

<button className={btnClass(true)} onClick={copyControlLink}>
Copy Control Link
</button>
</div>

<div className="flex gap-2 flex-wrap mb-3">
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
Permission: <b>{permission}</b> • Tags: <b>{tagsCount}</b>
</div>

<div className="border border-neutral-800 rounded-xl p-4 mb-4">
<canvas ref={canvasRef} className="w-full h-[200px]" />
</div>

<div className="grid grid-cols-3 gap-3">
<div className="border border-neutral-800 rounded-xl p-4">
<div className="text-xs text-neutral-400">Avg</div>
<div className="text-2xl">{avg}</div>
</div>

<div className="border border-neutral-800 rounded-xl p-4">
<div className="text-xs text-neutral-400">Peak</div>
<div className="text-2xl">{peak}</div>
</div>

<div className="border border-neutral-800 rounded-xl p-4">
<div className="text-xs text-neutral-400">Stability</div>
<div className="text-2xl">{stability}%</div>
</div>
</div>
</div>
</div>
);
}