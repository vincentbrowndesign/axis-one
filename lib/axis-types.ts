export type AxisState =
| "aligned"
| "shift"
| "drop"
| "recover"
| "unknown"

export type SignalType =
| "tilt"
| "stability"
| "rotation"

export interface SessionEvent {
timestamp: number
state: AxisState
tilt: number
stability: number
rotation: number
}

export interface RunSummary {
duration: number
alignedTime: number
shiftTime: number
dropTime: number
recoverTime: number
}

export const CENTER = {
x: 0,
y: 0
}

export const STORAGE_KEY = "axis-session"

export const RUN_SECONDS = 60