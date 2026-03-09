export type AxisState =
| "FLOAT"
| "DROP"
| "SHIFT"
| "OFF AXIS"
| "CENTERED";

export type PushDirection =
| "CENTER"
| "FORWARD"
| "BACK"
| "LEFT"
| "RIGHT"
| "FORWARD-RIGHT"
| "FORWARD-LEFT"
| "BACK-RIGHT"
| "BACK-LEFT";

export type AxisFrame = {
time: number;
rawX: number;
rawY: number;
smoothX: number;
smoothY: number;
magnitude: number;
stability: number;
state: AxisState;
direction: PushDirection;
locked: boolean;
};

export type AxisHistoryItem = {
id: string;
time: number;
state: AxisState;
direction: PushDirection;
stability: number;
label: string;
};

const clamp = (value: number, min: number, max: number) =>
Math.min(max, Math.max(min, value));

const round = (value: number) => Math.round(value);

export function smoothAxis(
current: { x: number; y: number },
target: { x: number; y: number },
factor = 0.18,
) {
return {
x: current.x + (target.x - current.x) * factor,
y: current.y + (target.y - current.y) * factor,
};
}

export function normalizeTilt(beta: number, gamma: number) {
// beta: front/back tilt, gamma: left/right tilt
// clamp to a sane human-movement range, then normalize to -1..1
const x = clamp(gamma / 35, -1, 1);
const y = clamp(beta / 35, -1, 1);
return { x, y };
}

export function computeMagnitude(x: number, y: number) {
return clamp(Math.sqrt(x * x + y * y), 0, 1.5);
}

export function computeStability(
x: number,
y: number,
velocityX: number,
velocityY: number,
) {
const magnitude = computeMagnitude(x, y);
const movement = clamp(Math.sqrt(velocityX * velocityX + velocityY * velocityY), 0, 1);
const centeredScore = 1 - clamp(magnitude, 0, 1);
const movementPenalty = movement * 0.65;
const score = clamp((centeredScore * 100) - movementPenalty * 35, 0, 100);
return round(score);
}

export function classifyAxisState(
x: number,
y: number,
stability: number,
): AxisState {
const magnitude = computeMagnitude(x, y);

if (magnitude < 0.18 && stability >= 88) return "CENTERED";
if (stability >= 82 && magnitude < 0.42) return "FLOAT";
if (y > 0.48) return "DROP";
if (magnitude > 0.86) return "OFF AXIS";
return "SHIFT";
}

export function detectPushDirection(x: number, y: number): PushDirection {
const threshold = 0.22;
const horizontal = Math.abs(x) > threshold ? (x > 0 ? "RIGHT" : "LEFT") : "";
const vertical = Math.abs(y) > threshold ? (y > 0 ? "FORWARD" : "BACK") : "";

if (!horizontal && !vertical) return "CENTER";
if (horizontal && vertical) return `${vertical}-${horizontal}` as PushDirection;
return (vertical || horizontal) as PushDirection;
}

export function isAxisLock(stability: number, holdMs: number) {
return stability >= 90 && holdMs >= 420;
}

export function formatTime(time: number) {
const d = new Date(time);
return d.toLocaleTimeString([], {
hour: "numeric",
minute: "2-digit",
second: "2-digit",
});
}

export function buildHistoryLabel(state: AxisState, direction: PushDirection) {
const cleanDirection = direction === "CENTER" ? "Center" : direction;
return `${state} · ${cleanDirection}`;
}

export function createHistoryItem(frame: AxisFrame): AxisHistoryItem {
return {
id: `${frame.time}-${frame.state}-${frame.direction}`,
time: frame.time,
state: frame.state,
direction: frame.direction,
stability: round(frame.stability),
label: buildHistoryLabel(frame.state, frame.direction),
};
}