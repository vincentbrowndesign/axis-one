export interface AxisSample {
ax: number
ay: number
az: number
gx: number
gy: number
gz: number
timestamp: number
}

export interface AxisSensor {
start(callback: (sample: AxisSample) => void): void
stop(): void
}