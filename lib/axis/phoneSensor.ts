import { AxisSensor, AxisSample } from "./sensorAdapter"

export class PhoneSensor implements AxisSensor {

private handler: any

async requestPermission() {

if (
typeof DeviceMotionEvent !== "undefined" &&
typeof (DeviceMotionEvent as any).requestPermission === "function"
) {
await (DeviceMotionEvent as any).requestPermission()
}

}

start(callback: (sample: AxisSample) => void) {

this.handler = (event: DeviceMotionEvent) => {

const accel = event.accelerationIncludingGravity
const rot = event.rotationRate

if (!accel || !rot) return

callback({
ax: accel.x ?? 0,
ay: accel.y ?? 0,
az: accel.z ?? 0,
gx: rot.alpha ?? 0,
gy: rot.beta ?? 0,
gz: rot.gamma ?? 0,
timestamp: Date.now()
})

}

window.addEventListener("devicemotion", this.handler)

}

stop() {

if (this.handler) {
window.removeEventListener("devicemotion", this.handler)
}

}

}