"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
evaluateAxis,
type AxisReading,
type AxisState,
} from "@/lib/axis/axisMovementModel";

export type AxisEngineStatus = "idle" | "running" | "stopped";

export type AxisEngineResult = {
status: AxisEngineStatus;
permission: "idle" | "granted" | "denied" | "unsupported";
reading: AxisReading;
heldState: AxisState;
heldScore: number;
rawTilt: number;
rawRotation: number;
smoothTilt: number;
smoothRotation: number;
start: () => Promise<void>;
stop: () => void;
requestMotionPermission: () => Promise<void>;
error: string;
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

export function useAxisEngine(): AxisEngineResult {
const [status, setStatus] = useState<AxisEngineStatus>("idle");
const [permission, setPermission] = useState<
"idle" | "granted" | "denied" | "unsupported"
>("idle");
const [error, setError] = useState("");

const [rawTilt, setRawTilt] = useState(0);
const [rawRotation, setRawRotation] = useState(0);
const [smoothTilt, setSmoothTilt] = useState(0);
const [smoothRotation, setSmoothRotation] = useState(0);

const [heldState, setHeldState] = useState<AxisState>("drop");
const [heldScore, setHeldScore] = useState(0);

const candidateRef = useRef<AxisState>("drop");
const candidateCountRef = useRef(0);

useEffect(() => {
const interval = window.setInterval(() => {
setSmoothTilt((prev) => prev + (rawTilt - prev) * 0.18);
setSmoothRotation((prev) => prev + (rawRotation - prev) * 0.18);
}, 16);

return () => window.clearInterval(interval);
}, [rawTilt, rawRotation]);

useEffect(() => {
if (typeof window === "undefined") return;

const onOrientation = (event: DeviceOrientationEvent) => {
const beta = typeof event.beta === "number" ? event.beta : 0;
const gamma = typeof event.gamma === "number" ? event.gamma : 0;

setRawTilt(clamp(beta / 10, -12, 12));
setRawRotation(clamp(gamma * 2, -90, 90));
};

window.addEventListener("deviceorientation", onOrientation, true);

return () => {
window.removeEventListener("deviceorientation", onOrientation, true);
};
}, []);

const reading = useMemo<AxisReading>(() => {
return evaluateAxis({
tilt: Math.abs(smoothTilt),
rotation: Math.abs(smoothRotation),
});
}, [smoothTilt, smoothRotation]);

useEffect(() => {
const next = reading.state;

if (candidateRef.current !== next) {
candidateRef.current = next;
candidateCountRef.current = 1;
return;
}

candidateCountRef.current += 1;

const threshold = next === "aligned" ? 4 : 6;

if (candidateCountRef.current >= threshold) {
setHeldState(next);
setHeldScore(reading.stability);
}
}, [reading.state, reading.stability]);

async function requestMotionPermission() {
try {
if (typeof window === "undefined") return;

const DeviceMotionEventAny = DeviceMotionEvent as typeof DeviceMotionEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

const DeviceOrientationEventAny =
DeviceOrientationEvent as typeof DeviceOrientationEvent & {
requestPermission?: () => Promise<"granted" | "denied">;
};

const motionNeedsPermission =
typeof DeviceMotionEventAny !== "undefined" &&
typeof DeviceMotionEventAny.requestPermission === "function";

const orientationNeedsPermission =
typeof DeviceOrientationEventAny !== "undefined" &&
typeof DeviceOrientationEventAny.requestPermission === "function";

if (!motionNeedsPermission && !orientationNeedsPermission) {
setPermission("granted");
return;
}

const results: string[] = [];

if (motionNeedsPermission && DeviceMotionEventAny.requestPermission) {
results.push(await DeviceMotionEventAny.requestPermission());
}

if (
orientationNeedsPermission &&
DeviceOrientationEventAny.requestPermission
) {
results.push(await DeviceOrientationEventAny.requestPermission());
}

const granted = results.every((result) => result === "granted");
setPermission(granted ? "granted" : "denied");

if (!granted) {
setError("Motion permission was denied.");
}
} catch {
setPermission("denied");
setError("Could not request motion permission.");
}
}

async function start() {
setError("");
setStatus("running");

if (
typeof window !== "undefined" &&
!("DeviceOrientationEvent" in window)
) {
setPermission("unsupported");
}

if (permission === "idle") {
await requestMotionPermission();
}
}

function stop() {
setStatus("stopped");
}

return {
status,
permission,
reading,
heldState,
heldScore,
rawTilt,
rawRotation,
smoothTilt,
smoothRotation,
start,
stop,
requestMotionPermission,
error,
};
}