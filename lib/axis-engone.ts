export type AxisState = 'ALIGNED' | 'SHIFT' | 'DROP' | 'LOST';
export type DetectionMode = 'FULL BODY' | 'MID BODY' | 'UPPER BODY' | 'LOST';

export type Point = { x: number; y: number };

export type AxisEvent = {
id: string;
at: string;
state: AxisState;
mode: DetectionMode;
tilt: number;
stability: number;
velocity: number;
windowMs: number;
driftPx: number;
};

export type Calibration = {
leftBoundary: Point | null;
rightBoundary: Point | null;
target: Point | null;
playerStart: Point | null;
};

export type EngineOutput = {
mode: DetectionMode;
state: AxisState;
axisPoints: Point[] | null;
bodyCenter: Point | null;
tiltDeg: number;
stackSpread: number;
driftPx: number;
};

export function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

export function dist(a: Point, b: Point) {
return Math.hypot(a.x - b.x, a.y - b.y);
}

export function mean(values: number[]) {
if (!values.length) return 0;
return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function formatNow() {
return new Date().toLocaleTimeString([], {
hour: 'numeric',
minute: '2-digit',
second: '2-digit',
});
}

export function midpoint(
a?: { x: number; y: number; visibility?: number },
b?: { x: number; y: number; visibility?: number }
): Point | null {
if (!a || !b) return null;
const aVis = a.visibility ?? 1;
const bVis = b.visibility ?? 1;
if (aVis < 0.15 || bVis < 0.15) return null;

return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
};
}

export function toPx(point: Point, width: number, height: number): Point {
return { x: point.x * width, y: point.y * height };
}

export function avgPoints(points: Array<Point | null>): Point | null {
const valid = points.filter(Boolean) as Point[];
if (!valid.length) return null;
return {
x: valid.reduce((sum, p) => sum + p.x, 0) / valid.length,
y: valid.reduce((sum, p) => sum + p.y, 0) / valid.length,
};
}

function tiltBetween(top: Point, bottom: Point) {
const dx = top.x - bottom.x;
const dy = bottom.y - top.y;
return Math.abs((Math.atan2(dx, Math.max(1, dy)) * 180) / Math.PI);
}

export function stateColor(state: AxisState) {
switch (state) {
case 'ALIGNED':
return '#00FF9C';
case 'SHIFT':
return '#FFD400';
case 'DROP':
return '#3FA7FF';
case 'LOST':
default:
return '#7A7A7A';
}
}

export function modeLabel(mode: DetectionMode) {
switch (mode) {
case 'FULL BODY':
return 'FULL';
case 'MID BODY':
return 'MID';
case 'UPPER BODY':
return 'UPPER';
default:
return 'NO SIGNAL';
}
}

export function labelForEvent(event: AxisEvent) {
if (event.state === 'LOST') return 'Tracking lost';
return `${event.mode} • Velocity ${event.velocity.toFixed(4)} • Drift ${event.driftPx.toFixed(1)} px`;
}

export function evaluateAxisFrame(
landmarks: Array<{ x: number; y: number; visibility?: number }>,
width: number,
height: number,
axisX: number,
velocity: number
): EngineOutput {
const shoulderMidNorm = midpoint(landmarks[11], landmarks[12]);
const hipMidNorm = midpoint(landmarks[23], landmarks[24]);
const kneeMidNorm = midpoint(landmarks[25], landmarks[26]);
const ankleMidNorm = midpoint(landmarks[27], landmarks[28]);

const shoulderMid = shoulderMidNorm ? toPx(shoulderMidNorm, width, height) : null;
const hipMid = hipMidNorm ? toPx(hipMidNorm, width, height) : null;
const kneeMid = kneeMidNorm ? toPx(kneeMidNorm, width, height) : null;
const ankleMid = ankleMidNorm ? toPx(ankleMidNorm, width, height) : null;

if (shoulderMid && hipMid && kneeMid && ankleMid) {
const bodyCenter = avgPoints([shoulderMid, hipMid, kneeMid, ankleMid]);
const tiltDeg = tiltBetween(shoulderMid, ankleMid);
const stackSpread = Math.max(
Math.abs(shoulderMid.x - ankleMid.x),
Math.abs(hipMid.x - ankleMid.x),
Math.abs(kneeMid.x - ankleMid.x)
);
const driftPx = bodyCenter ? Math.abs(bodyCenter.x - axisX) : 0;

let state: AxisState = 'SHIFT';
if (tiltDeg <= 7 && stackSpread <= 22 && driftPx <= 26) state = 'ALIGNED';
else if (tiltDeg >= 16 || stackSpread >= 46 || driftPx >= 54 || velocity >= 20) state = 'DROP';

return {
mode: 'FULL BODY',
state,
axisPoints: [shoulderMid, hipMid, kneeMid, ankleMid],
bodyCenter,
tiltDeg,
stackSpread,
driftPx,
};
}

if (shoulderMid && hipMid && kneeMid) {
const bodyCenter = avgPoints([shoulderMid, hipMid, kneeMid]);
const tiltDeg = tiltBetween(shoulderMid, kneeMid);
const stackSpread = Math.max(
Math.abs(shoulderMid.x - kneeMid.x),
Math.abs(hipMid.x - kneeMid.x)
);
const driftPx = bodyCenter ? Math.abs(bodyCenter.x - axisX) : 0;

let state: AxisState = 'SHIFT';
if (tiltDeg <= 9 && stackSpread <= 28 && driftPx <= 34) state = 'ALIGNED';
else if (tiltDeg >= 20 || stackSpread >= 56 || driftPx >= 62 || velocity >= 24) state = 'DROP';

return {
mode: 'MID BODY',
state,
axisPoints: [shoulderMid, hipMid, kneeMid],
bodyCenter,
tiltDeg,
stackSpread,
driftPx,
};
}

if (shoulderMid && hipMid) {
const bodyCenter = avgPoints([shoulderMid, hipMid]);
const tiltDeg = tiltBetween(shoulderMid, hipMid);
const stackSpread = Math.abs(shoulderMid.x - hipMid.x);
const driftPx = bodyCenter ? Math.abs(bodyCenter.x - axisX) : 0;

let state: AxisState = 'SHIFT';
if (tiltDeg <= 11 && stackSpread <= 34 && driftPx <= 42) state = 'ALIGNED';
else if (tiltDeg >= 26 || stackSpread >= 72 || driftPx >= 84 || (velocity >= 30 && tiltDeg >= 18)) {
state = 'DROP';
}

return {
mode: 'UPPER BODY',
state,
axisPoints: [shoulderMid, hipMid],
bodyCenter,
tiltDeg,
stackSpread,
driftPx,
};
}

return {
mode: 'LOST',
state: 'LOST',
axisPoints: null,
bodyCenter: null,
tiltDeg: 0,
stackSpread: 0,
driftPx: 0,
};
}