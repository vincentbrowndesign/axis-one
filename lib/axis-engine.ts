export type AxisState = 'ALIGNED' | 'SHIFT' | 'DROP' | 'LOST';
export type DetectionMode = 'FULL' | 'TORSO' | 'UPPER' | 'FACE' | 'LOST';

export type Point = {
x: number;
y: number;
};

export type Calibration = {
leftBoundary: Point | null;
rightBoundary: Point | null;
target: Point | null;
playerStart: Point | null;
};

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

export type EngineOutput = {
state: AxisState;
mode: DetectionMode;
tiltDeg: number;
driftPx: number;
stackSpread: number;
bodyCenter: Point | null;
axisPoints: Point[] | null;
};

export function clamp(n: number, min: number, max: number) {
return Math.max(min, Math.min(max, n));
}

export function mean(arr: number[]) {
if (!arr.length) return 0;
return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function dist(a: Point, b: Point) {
return Math.hypot(a.x - b.x, a.y - b.y);
}

export function formatNow() {
return new Date().toLocaleTimeString([], {
hour: 'numeric',
minute: '2-digit',
second: '2-digit',
});
}

export function stateColor(state: AxisState) {
if (state === 'ALIGNED') return '#00FF9C';
if (state === 'SHIFT') return '#FFD400';
if (state === 'DROP') return '#3FA7FF';
return '#7A7A7A';
}

export function modeLabel(mode: DetectionMode) {
if (mode === 'FULL') return 'FULL BODY';
if (mode === 'TORSO') return 'TORSO';
if (mode === 'UPPER') return 'UPPER BODY';
if (mode === 'FACE') return 'FACE';
return 'NO SIGNAL';
}

export function labelForEvent(e: AxisEvent) {
if (e.state === 'ALIGNED') return 'Balanced window detected';
if (e.state === 'SHIFT') return 'Lateral shift';
if (e.state === 'DROP') return 'Drop / instability';
return 'Tracking lost';
}

function safeVis(v: unknown) {
return typeof v === 'number' ? v : 0;
}

function pointFromLandmark(
lm: { x: number; y: number } | undefined,
width: number,
height: number
): Point | null {
if (!lm) return null;
return {
x: lm.x * width,
y: lm.y * height,
};
}

function midpoint(
a: { x: number; y: number } | undefined,
b: { x: number; y: number } | undefined,
width: number,
height: number
): Point | null {
if (!a || !b) return null;
return {
x: ((a.x + b.x) / 2) * width,
y: ((a.y + b.y) / 2) * height,
};
}

function tiltBetween(a: Point, b: Point) {
const dx = b.x - a.x;
const dy = b.y - a.y;
return Math.atan2(dx, Math.max(1, dy)) * (180 / Math.PI);
}

export function evaluateAxisFrame(
landmarks: Array<{ x: number; y: number; visibility?: number }>,
width: number,
height: number,
axisX: number,
velocity: number
): EngineOutput {
const nose = landmarks[0];
const ls = landmarks[11];
const rs = landmarks[12];
const lh = landmarks[23];
const rh = landmarks[24];
const lk = landmarks[25];
const rk = landmarks[26];

const noseVis = safeVis(nose?.visibility);
const lsVis = safeVis(ls?.visibility);
const rsVis = safeVis(rs?.visibility);
const lhVis = safeVis(lh?.visibility);
const rhVis = safeVis(rh?.visibility);
const lkVis = safeVis(lk?.visibility);
const rkVis = safeVis(rk?.visibility);

const hasFace = noseVis > 0.15;
const hasShoulders = lsVis > 0.15 && rsVis > 0.15;
const hasHips = lhVis > 0.15 && rhVis > 0.15;
const hasKnees = lkVis > 0.15 && rkVis > 0.15;

let mode: DetectionMode = 'LOST';

if (hasShoulders && hasHips && hasKnees) mode = 'FULL';
else if (hasShoulders && hasHips) mode = 'TORSO';
else if (hasShoulders) mode = 'UPPER';
else if (hasFace) mode = 'FACE';

if (mode === 'LOST') {
return {
state: 'LOST',
mode,
tiltDeg: 0,
driftPx: 0,
stackSpread: 0,
bodyCenter: null,
axisPoints: null,
};
}

const shoulderMid = midpoint(ls, rs, width, height);
const hipMid = midpoint(lh, rh, width, height);
const kneeMid = midpoint(lk, rk, width, height);
const nosePt = pointFromLandmark(nose, width, height);

if (mode === 'FACE' && nosePt) {
const driftPx = Math.abs(nosePt.x - axisX);
const tiltDeg = 0;
const stackSpread = 0;

let state: AxisState = 'ALIGNED';
if (driftPx > width * 0.08) state = 'SHIFT';
if (driftPx > width * 0.16 || velocity > 18) state = 'DROP';

return {
state,
mode,
tiltDeg,
driftPx,
stackSpread,
bodyCenter: nosePt,
axisPoints: [nosePt],
};
}

if (mode === 'UPPER' && shoulderMid) {
const driftPx = Math.abs(shoulderMid.x - axisX);
const shoulderTiltDeg =
ls && rs ? Math.atan2((rs.y - ls.y) * height, Math.max(1, (rs.x - ls.x) * width)) * (180 / Math.PI) : 0;
const stackSpread = 0;

let state: AxisState = 'ALIGNED';
if (Math.abs(shoulderTiltDeg) > 8 || driftPx > width * 0.08) state = 'SHIFT';
if (Math.abs(shoulderTiltDeg) > 16 || driftPx > width * 0.16 || velocity > 22) state = 'DROP';

return {
state,
mode,
tiltDeg: shoulderTiltDeg,
driftPx,
stackSpread,
bodyCenter: shoulderMid,
axisPoints: [shoulderMid],
};
}

if (mode === 'TORSO' && shoulderMid && hipMid) {
const tiltDeg = tiltBetween(shoulderMid, hipMid);
const bodyCenter = {
x: (shoulderMid.x + hipMid.x) / 2,
y: (shoulderMid.y + hipMid.y) / 2,
};
const driftPx = Math.abs(bodyCenter.x - axisX);
const stackSpread = Math.abs(shoulderMid.x - hipMid.x);

let state: AxisState = 'ALIGNED';
if (Math.abs(tiltDeg) > 10 || driftPx > width * 0.08 || stackSpread > width * 0.04) state = 'SHIFT';
if (Math.abs(tiltDeg) > 20 || driftPx > width * 0.16 || stackSpread > width * 0.08 || velocity > 24)
state = 'DROP';

return {
state,
mode,
tiltDeg,
driftPx,
stackSpread,
bodyCenter,
axisPoints: [shoulderMid, hipMid],
};
}

if (mode === 'FULL' && shoulderMid && hipMid && kneeMid) {
const tiltDeg = tiltBetween(shoulderMid, hipMid);
const bodyCenter = {
x: (shoulderMid.x + hipMid.x + kneeMid.x) / 3,
y: (shoulderMid.y + hipMid.y + kneeMid.y) / 3,
};
const driftPx = Math.abs(bodyCenter.x - axisX);
const stackSpread = Math.max(
Math.abs(shoulderMid.x - hipMid.x),
Math.abs(hipMid.x - kneeMid.x),
Math.abs(shoulderMid.x - kneeMid.x)
);

let state: AxisState = 'ALIGNED';
if (Math.abs(tiltDeg) > 9 || driftPx > width * 0.07 || stackSpread > width * 0.035) state = 'SHIFT';
if (Math.abs(tiltDeg) > 18 || driftPx > width * 0.14 || stackSpread > width * 0.07 || velocity > 24)
state = 'DROP';

return {
state,
mode,
tiltDeg,
driftPx,
stackSpread,
bodyCenter,
axisPoints: [shoulderMid, hipMid, kneeMid],
};
}

return {
state: 'LOST',
mode: 'LOST',
tiltDeg: 0,
driftPx: 0,
stackSpread: 0,
bodyCenter: null,
axisPoints: null,
};
}