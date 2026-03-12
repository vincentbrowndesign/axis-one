export type AxisState =
| "ALIGNED"
| "SHIFT"
| "DROP"
| "LOST"

export type DetectionMode =
| "FULL"
| "TORSO"
| "UPPER"
| "FACE"
| "LOST"

export type Point = {
x: number
y: number
}

export type Calibration = {
leftBoundary: Point | null
rightBoundary: Point | null
target: Point | null
playerStart: Point | null
}

export type AxisEvent = {
id: string
at: string
state: AxisState
mode: DetectionMode
tilt: number
stability: number
velocity: number
windowMs: number
driftPx: number
}

export function clamp(n: number, min: number, max: number) {
return Math.max(min, Math.min(max, n))
}

export function mean(arr: number[]) {
if (!arr.length) return 0
return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function dist(a: Point, b: Point) {
return Math.hypot(a.x - b.x, a.y - b.y)
}

export function formatNow() {
return new Date().toLocaleTimeString()
}

export function stateColor(state: AxisState) {
if (state === "ALIGNED") return "#00FF9C"
if (state === "SHIFT") return "#FFD400"
if (state === "DROP") return "#3FA7FF"
return "#7A7A7A"
}

export function modeLabel(mode: DetectionMode) {
if (mode === "FULL") return "FULL BODY"
if (mode === "TORSO") return "TORSO"
if (mode === "UPPER") return "UPPER BODY"
if (mode === "FACE") return "FACE"
return "NO SIGNAL"
}

export function labelForEvent(e: AxisEvent) {
if (e.state === "ALIGNED") return "Balanced window detected"
if (e.state === "SHIFT") return "Lateral shift"
if (e.state === "DROP") return "Drop / instability"
return "Tracking lost"
}

export function evaluateAxisFrame(
landmarks: any[],
width: number,
height: number,
axisX: number,
velocity: number
) {
const nose = landmarks[0]
const ls = landmarks[11]
const rs = landmarks[12]
const lh = landmarks[23]
const rh = landmarks[24]

const hasFace = nose?.visibility > 0.5
const hasShoulders = ls?.visibility > 0.5 && rs?.visibility > 0.5
const hasHips = lh?.visibility > 0.5 && rh?.visibility > 0.5

let mode: DetectionMode = "LOST"

if (hasShoulders && hasHips) mode = "TORSO"
else if (hasShoulders) mode = "UPPER"
else if (hasFace) mode = "FACE"

if (mode === "LOST") {
return {
state: "LOST" as AxisState,
mode,
tiltDeg: 0,
driftPx: 0,
stackSpread: 0,
bodyCenter: null,
axisPoints: null,
}
}

const sx = (ls.x + rs.x) / 2 * width
const sy = (ls.y + rs.y) / 2 * height

let hx = sx
let hy = sy

if (mode === "TORSO") {
hx = (lh.x + rh.x) / 2 * width
hy = (lh.y + rh.y) / 2 * height
}

const dx = (rs.x - ls.x)
const dy = (rs.y - ls.y)

const tilt = Math.atan2(dy, dx) * 180 / Math.PI

const center = {
x: (sx + hx) / 2,
y: (sy + hy) / 2
}

const drift = Math.abs(center.x - axisX)

const stack = Math.abs(sx - hx)

let state: AxisState = "ALIGNED"

if (Math.abs(tilt) > 18) state = "SHIFT"
if (drift > width * 0.15) state = "DROP"

return {
state,
mode,
tiltDeg: tilt,
driftPx: drift,
stackSpread: stack,
bodyCenter: center,
axisPoints: [
{ x: sx, y: sy },
{ x: hx, y: hy }
]
}
}