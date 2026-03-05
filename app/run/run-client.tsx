"use client";

import React, { useState, useRef } from "react";

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

const samples = useRef<Sample[]>([]);
const tags = useRef<Tag[]>([]);

function start() {
samples.current = [];
tags.current = [];

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
tags.current.push({
t: Date.now(),
});
}

function onMotion(e: DeviceMotionEvent) {
samples.current.push({
t: Date.now(),
accel: e.acceleration,
accelIncludingGravity: e.accelerationIncludingGravity,
rotationRate: e.rotationRate,
});
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

// IMPORTANT
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
<div className="p-6 text-white">
<h1 className="text-2xl mb-6">Axis One Capture</h1>

<div className="flex gap-4">

{!running && (
<button
className="bg-green-600 px-4 py-2 rounded"
onClick={start}
>
Start
</button>
)}

{running && (
<>
<button
className="bg-yellow-500 px-4 py-2 rounded"
onClick={tagDecision}
>
Tag Decision
</button>

<button
className="bg-red-600 px-4 py-2 rounded"
onClick={stop}
>
Stop
</button>
</>
)}

</div>

<div className="mt-6 text-sm opacity-70">
Samples: {samples.current.length} | Tags: {tags.current.length}
</div>
</div>
);
}