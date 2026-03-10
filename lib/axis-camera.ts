export type AxisCameraState =
| "SEARCHING"
| "AXIS"
| "SHIFT"
| "DROP"
| "OFF_AXIS";

export type Point = {
x: number;
y: number;
};

export type AxisCameraFrame = {
center: Point;
shoulderMid: Point;
hipMid: Point;
axisAngleDeg: number;
stability: number;
visibility: number;
shiftX: number;
dropY: number;
state: AxisCameraState;
};

export type AxisCameraSummary = {
frames: number;
axisPct: number;
shiftPct: number;
dropPct: number;
offAxisPct: number;
};

type DrawArgs = {
canvas: HTMLCanvasElement;
video: HTMLVideoElement;
landmarks: any[];
axisFrame: AxisCameraFrame;
};

export function clamp(n: number, min: number, max: number) {
return Math.max(min, Math.min(max, n));
}

export function avg(values: number[]) {
if (!values.length) return 0;
return values.reduce((a, b) => a + b, 0) / values.length;
}

function midpoint(a: Point, b: Point): Point {
return {
x: (a.x + b.x) / 2,
y: (a.y + b.y) / 2,
};
}

function radToDeg(rad: number) {
return (rad * 180) / Math.PI;
}

function landmarkToPixel(lm: any, w: number, h: number): Point {
return {
x: lm.x * w,
y: lm.y * h,
};
}

function getVisibility(landmarks: any[], idx: number[]) {
return avg(idx.map((i) => landmarks[i]?.visibility ?? 0));
}

export function computeAxisFrameFromLandmarks(
landmarks: any[],
_world: any,
baseline: AxisCameraFrame | null,
width: number,
height: number
): AxisCameraFrame {
const leftShoulder = landmarkToPixel(landmarks[11], width, height);
const rightShoulder = landmarkToPixel(landmarks[12], width, height);
const leftHip = landmarkToPixel(landmarks[23], width, height);
const rightHip = landmarkToPixel(landmarks[24], width, height);

const shoulderMid = midpoint(leftShoulder, rightShoulder);
const hipMid = midpoint(leftHip, rightHip);
const center = midpoint(shoulderMid, hipMid);

const dx = shoulderMid.x - hipMid.x;
const dy = shoulderMid.y - hipMid.y;

const axisAngleDeg = radToDeg(Math.atan2(dx, -dy));
const visibility = getVisibility(landmarks, [11, 12, 23, 24]);

const baseCenter = baseline?.center ?? center;
const baseAngle = baseline?.axisAngleDeg ?? axisAngleDeg;

const shiftX = center.x - baseCenter.x;
const dropY = center.y - baseCenter.y;

const angleDelta = axisAngleDeg - baseAngle;

const shiftNorm = Math.abs(shiftX) / (width * 0.08);
const dropNorm = Math.abs(dropY) / (height * 0.08);
const angleNorm = Math.abs(angleDelta) / 16;

const instability = shiftNorm * 0.45 + dropNorm * 0.3 + angleNorm * 0.25;

const stability = clamp(1 - instability, 0, 1);

let state: AxisCameraState = "AXIS";

if (visibility < 0.45) {
state = "SEARCHING";
} else if (Math.abs(dropY) > height * 0.07) {
state = "DROP";
} else if (Math.abs(shiftX) > width * 0.08) {
state = "SHIFT";
} else if (Math.abs(angleDelta) > 16 || stability < 0.42) {
state = "OFF_AXIS";
}

return {
center,
shoulderMid,
hipMid,
axisAngleDeg,
stability,
visibility,
shiftX,
dropY,
state,
};
}

export function smoothFrame(
prev: AxisCameraFrame | null,
next: AxisCameraFrame,
alpha = 0.35
): AxisCameraFrame {
if (!prev) return next;

function mix(a: number, b: number) {
return a * (1 - alpha) + b * alpha;
}

return {
center: {
x: mix(prev.center.x, next.center.x),
y: mix(prev.center.y, next.center.y),
},
shoulderMid: {
x: mix(prev.shoulderMid.x, next.shoulderMid.x),
y: mix(prev.shoulderMid.y, next.shoulderMid.y),
},
hipMid: {
x: mix(prev.hipMid.x, next.hipMid.x),
y: mix(prev.hipMid.y, next.hipMid.y),
},
axisAngleDeg: mix(prev.axisAngleDeg, next.axisAngleDeg),
stability: mix(prev.stability, next.stability),
visibility: mix(prev.visibility, next.visibility),
shiftX: mix(prev.shiftX, next.shiftX),
dropY: mix(prev.dropY, next.dropY),
state: next.state,
};
}

export function calibrateBaseline(samples: AxisCameraFrame[]) {
const centerX = avg(samples.map((s) => s.center.x));
const centerY = avg(samples.map((s) => s.center.y));
const shoulderX = avg(samples.map((s) => s.shoulderMid.x));
const shoulderY = avg(samples.map((s) => s.shoulderMid.y));
const hipX = avg(samples.map((s) => s.hipMid.x));
const hipY = avg(samples.map((s) => s.hipMid.y));
const angle = avg(samples.map((s) => s.axisAngleDeg));
const visibility = avg(samples.map((s) => s.visibility));
const stability = avg(samples.map((s) => s.stability));

return {
center: { x: centerX, y: centerY },
shoulderMid: { x: shoulderX, y: shoulderY },
hipMid: { x: hipX, y: hipY },
axisAngleDeg: angle,
stability,
visibility,
shiftX: 0,
dropY: 0,
state: "AXIS" as AxisCameraState,
};
}

export function scoreFromFrames(frames: AxisCameraFrame[]): AxisCameraSummary {
if (!frames.length) {
return {
frames: 0,
axisPct: 0,
shiftPct: 0,
dropPct: 0,
offAxisPct: 0,
};
}

const valid = frames.filter((f) => f.state !== "SEARCHING");
const base = valid.length || 1;

return {
frames: valid.length,
axisPct: Math.round(
(valid.filter((f) => f.state === "AXIS").length / base) * 100
),
shiftPct: Math.round(
(valid.filter((f) => f.state === "SHIFT").length / base) * 100
),
dropPct: Math.round(
(valid.filter((f) => f.state === "DROP").length / base) * 100
),
offAxisPct: Math.round(
(valid.filter((f) => f.state === "OFF_AXIS").length / base) * 100
),
};
}

export function formatStateLabel(state: AxisCameraState) {
if (state === "OFF_AXIS") return "Off Axis";
if (state === "SEARCHING") return "Searching";
return state;
}

export function getStateColor(state: AxisCameraState) {
switch (state) {
case "AXIS":
return "#ffffff";
case "SHIFT":
return "#5fa8ff";
case "DROP":
return "#ffd166";
case "OFF_AXIS":
return "#ff6b6b";
default:
return "rgba(255,255,255,0.5)";
}
}

export function drawPoseOverlay({
canvas,
video,
landmarks,
axisFrame,
}: DrawArgs) {
const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

ctx.strokeStyle = "rgba(255,255,255,0.25)";
ctx.lineWidth = 3;

ctx.beginPath();
ctx.moveTo(axisFrame.hipMid.x, axisFrame.hipMid.y);
ctx.lineTo(axisFrame.shoulderMid.x, axisFrame.shoulderMid.y);
ctx.stroke();

ctx.beginPath();
ctx.arc(axisFrame.center.x, axisFrame.center.y, 10, 0, Math.PI * 2);
ctx.fillStyle = getStateColor(axisFrame.state);
ctx.fill();

ctx.strokeStyle = "rgba(255,255,255,0.25)";
ctx.lineWidth = 1;

ctx.beginPath();
ctx.moveTo(axisFrame.center.x - 24, axisFrame.center.y);
ctx.lineTo(axisFrame.center.x + 24, axisFrame.center.y);
ctx.moveTo(axisFrame.center.x, axisFrame.center.y - 24);
ctx.lineTo(axisFrame.center.x, axisFrame.center.y + 24);
ctx.stroke();
}