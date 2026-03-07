"use client";

import { useEffect, useRef } from "react";

type IOSMotionEvent = typeof DeviceMotionEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

let sharedEnergy = 0;
let listenersAttached = false;

function attachGlobalMotionListener() {
if (listenersAttached || typeof window === "undefined") return;
listenersAttached = true;

const handleMotion = (e: DeviceMotionEvent) => {
const ax = e.accelerationIncludingGravity?.x ?? 0;
const ay = e.accelerationIncludingGravity?.y ?? 0;
const az = e.accelerationIncludingGravity?.z ?? 0;

const mag = Math.sqrt(ax * ax + ay * ay + az * az);
sharedEnergy = sharedEnergy * 0.85 + mag * 0.15;
};

window.addEventListener("devicemotion", handleMotion, { passive: true });
}

async function requestMotionPermissionIfNeeded() {
if (typeof window === "undefined") return;

try {
const motion = DeviceMotionEvent as IOSMotionEvent;

if (typeof motion.requestPermission === "function") {
const result = await motion.requestPermission();
if (result !== "granted") return;
}

attachGlobalMotionListener();
} catch {
attachGlobalMotionListener();
}
}

export function useSensor() {
const energyRef = useRef(0);

useEffect(() => {
requestMotionPermissionIfNeeded();

const id = window.setInterval(() => {
energyRef.current = sharedEnergy;
}, 16);

return () => window.clearInterval(id);
}, []);

return energyRef;
}