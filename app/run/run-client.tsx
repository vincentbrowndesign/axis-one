"use client";

import { useEffect, useRef, useState } from "react";
import Pusher from "pusher-js";
import QRCode from "qrcode.react";

function createId() {
return Math.random().toString(36).substring(2, 10);
}

export default function RunClient() {
const [sid] = useState(createId());
const [permission, setPermission] = useState("idle");
const [capturing, setCapturing] = useState(false);
const [samples, setSamples] = useState(0);
const [tags, setTags] = useState(0);
const [axisLine, setAxisLine] = useState<number[]>([]);

const filterRef = useRef(0);

const pairingURL =
typeof window !== "undefined"
? `${window.location.origin}/control?sid=${sid}`
: "";

useEffect(() => {
const pusher = new Pusher(
process.env.NEXT_PUBLIC_PUSHER_KEY!,
{
cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
}
);

const channel = pusher.subscribe(`axis-one-${sid}`);

channel.bind("cmd", (data: any) => {
if (data.type === "start") start();
if (data.type === "stop") stop();
if (data.type === "tag") tag();
if (data.type === "decision") decision();
});

return () => {
pusher.disconnect();
};
}, [sid]);

function enableSensors() {
const anyDM: any = DeviceMotionEvent;

if (anyDM?.requestPermission) {
anyDM.requestPermission().then((res: string) => {
if (res === "granted") setPermission("granted");
});
} else {
setPermission("granted");
}
}

function start() {
if (permission !== "granted") return;

setCapturing(true);

window.addEventListener("devicemotion", onMotion);
}

function stop() {
setCapturing(false);
window.removeEventListener("devicemotion", onMotion);
}

function tag() {
setTags((t) => t + 1);
}

function decision() {
setTags((t) => t + 1);
}

function onMotion(e: DeviceMotionEvent) {
if (!capturing) return;

const x = e.accelerationIncludingGravity?.x ?? 0;
const y = e.accelerationIncludingGravity?.y ?? 0;
const z = e.accelerationIncludingGravity?.z ?? 0;

const mag = Math.sqrt(x * x + y * y + z * z);

filterRef.current =
filterRef.current + 0.02 * (mag - filterRef.current);

const axis = mag - filterRef.current;

setAxisLine((prev) => {
const next = [...prev.slice(-200), axis];
return next;
});

setSamples((s) => s + 1);
}

return (
<main className="min-h-screen bg-black text-white p-6">
<h1 className="text-5xl font-semibold">Run (Axis One)</h1>

<div className="mt-6 text-3xl">
{capturing ? "Capturing..." : "Idle"}
</div>

<div className="grid grid-cols-2 gap-4 mt-6">

<button
onClick={enableSensors}
className="p-5 bg-white/10 rounded-xl"
>
Enable Sensors
</button>

<button
onClick={start}
className="p-5 bg-white text-black rounded-xl"
>
Start
</button>

<button
onClick={stop}
className="p-5 bg-white/10 rounded-xl"
>
Stop
</button>

<button
onClick={decision}
className="p-5 bg-white/10 rounded-xl"
>
Decision
</button>

</div>

<button
onClick={tag}
className="p-5 bg-white/10 rounded-xl mt-4 w-full"
>
Tag
</button>

<div className="mt-10">
<h2 className="text-3xl">Axis Line</h2>

<div className="bg-white/5 p-4 rounded-xl mt-3">
{axisLine.slice(-40).map((v, i) => (
<div key={i}>{v.toFixed(2)}</div>
))}
</div>
</div>

<div className="grid grid-cols-2 gap-4 mt-6">

<div className="bg-white/5 p-5 rounded-xl">
<div className="text-sm text-white/50">Samples</div>
<div className="text-5xl">{samples}</div>
</div>

<div className="bg-white/5 p-5 rounded-xl">
<div className="text-sm text-white/50">Tags</div>
<div className="text-5xl">{tags}</div>
</div>

</div>

<div className="mt-10 bg-white/5 p-6 rounded-2xl">

<div className="text-xl font-semibold">
Pair Controller
</div>

<div className="mt-3 flex justify-center">
<div className="bg-white p-4 rounded-xl">
<QRCode value={pairingURL} size={200} />
</div>
</div>

<div className="text-xs text-white/50 mt-3">
Scan from another phone
</div>

</div>
</main>
);
}