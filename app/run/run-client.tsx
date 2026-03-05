"use client";

import { useEffect, useRef, useState } from "react";

type Sample = {
t: number;
accel?: any;
accelIncludingGravity?: any;
rotationRate?: any;
orientation?: any;
};

type Tag = {
t: number;
};

export default function RunClient() {
const [running, setRunning] = useState(false);
const [sampleCount, setSampleCount] = useState(0);
const [tagCount, setTagCount] = useState(0);

const samples = useRef<Sample[]>([]);
const tags = useRef<Tag[]>([]);

function start() {
samples.current = [];
tags.current = [];

setSampleCount(0);
setTagCount(0);

setRunning(true);

window.addEventListener("devicemotion", onMotion);
window.addEventListener("deviceorientation", onOrientation);
}

function stop() {
setRunning(false);

window.removeEventListener("devicemotion", onMotion);
window.removeEventListener("deviceorientation", onOrientation);

exportSession();
}

function tagDecision() {
tags.current.push({ t: Date.now() });
setTagCount(tags.current.length);
}

function onMotion(e: DeviceMotionEvent) {
samples.current.push({
t: Date.now(),
accel: e.acceleration,
accelIncludingGravity: e.accelerationIncludingGravity,
rotationRate: e.rotationRate,
});

setSampleCount(samples.current.length);
}

function onOrientation(e: DeviceOrientationEvent) {
const last = samples.current[samples.current.length - 1];

if (last) {
last.orientation = {
alpha: e.alpha,
beta: e.beta,
gamma: e.gamma,
};
}
}

function exportSession() {
const json = {
exported_at: new Date().toISOString(),
environment: "basketball",
started_at_epoch_ms: samples.current[0]?.t,
ended_at_epoch_ms: samples.current[samples.current.length - 1]?.t,
samples_count: samples.current.length,
tags_count: tags.current.length,
samples: samples.current,
tags: tags.current,
};

const blob = new Blob([JSON.stringify(json, null, 2)], {
type: "application/json",
});

const url = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = url;
a.download = `axis-one-session-${Date.now()}.json`;
a.click();
}

return (
<div className="min-h-screen bg-black text-white p-8">
<h1 className="text-3xl font-semibold mb-6">Axis One Capture</h1>

<div className="flex gap-4 mb-6">

{!running && (
<button
onClick={start}
className="bg-green-600 px-6 py-3 rounded-lg"
>
Start
</button>
)}

{running && (
<>
<button
onClick={tagDecision}
className="bg-yellow-500 px-6 py-3 rounded-lg"
>
Tag Decision
</button>

<button
onClick={stop}
className="bg-red-600 px-6 py-3 rounded-lg"
>
Stop
</button>
</>
)}

</div>

<div className="text-white/70 text-lg">
Samples: {sampleCount} | Tags: {tagCount}
</div>
</div>
);
}