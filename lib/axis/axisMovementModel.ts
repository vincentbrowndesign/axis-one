import type { AxisSample } from "./sensorAdapter"

export type AxisState =
| "aligned"
| "shift"
| "drop"
| "recover"
| "unknown"

export interface AxisReading {
state: AxisState
stability: number
tilt: number
rotation: number
}

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value))
}

export function evaluateAxis(sample: AxisSample): AxisReading {
const tilt = Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay)
const rotation = Math.sqrt(sample.gx * sample.gx + sample.gy * sample.gy)

// device gravity baseline is around ~9.8. Lower deviation = more stable.
const gravityDelta = Math.abs(Math.abs(sample.az) - 9.8)
const stabilityRaw = 100 - gravityDelta * 18 - tilt * 8 - rotation * 0.08
const stability = clamp(stabilityRaw, 0, 100)

let state: AxisState = "unknown"

if (stability >= 82 && tilt < 2.8 && rotation < 30) {
state = "aligned"
} else if (stability >= 62 && tilt < 5.2 && rotation < 75) {
state = "shift"
} else if (stability >= 38 || tilt >= 5.2) {
state = "drop"
}

if (state === "drop" && stability >= 68 && tilt < 3.8 && rotation < 45) {
state = "recover"
}

return {
state,
stability,
tilt,
rotation,
}
}