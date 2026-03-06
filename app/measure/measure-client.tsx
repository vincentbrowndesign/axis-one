"use client"

import { useEffect, useRef, useState } from "react"

type FormState = "Out of Control" | "In Rhythm" | "In Control"
type SignalState = "Chaotic" | "Reactive" | "Clean"
type EnergyState = "Off" | "On" | "High"

type Reading = {
form: FormState
signal: SignalState
energy: EnergyState
transitions: number
windows: number
charge: number
}

export default function MeasureClient() {
const [running, setRunning] = useState(false)
const [time, setTime] = useState(0)
const [storedCharge, setStoredCharge] = useState(0)

const [reading, setReading] = useState<Reading>({
form: "In Control",
signal: "Clean",
energy: "Off",
transitions: 0,
windows: 0,
charge: 0,
})

const samples = useRef<number[]>([])
const lastSignal = useRef<SignalState>("Clean")
const startTime = useRef<number>(0)
const timer = useRef<ReturnType<typeof setInterval> | null>(null)

const motionHandler = (e: DeviceMotionEvent) => {
const ax = e.accelerationIncludingGravity?.x || 0
const ay = e.accelerationIncludingGravity?.y || 0
const az = e.accelerationIncludingGravity?.z || 0

const mag = Math.sqrt(ax * ax + ay * ay + az * az)

samples.current.push(mag)

if (samples.current.length > 60) {
samples.current.shift()
}
}

async function enableMotion() {
if (
typeof DeviceMotionEvent !== "undefined" &&
typeof (DeviceMotionEvent as any).requestPermission === "function"
) {
const res = await (DeviceMotionEvent as any).requestPermission()

if (res === "granted") {
window.addEventListener("devicemotion", motionHandler)
}
} else {
window.addEventListener("devicemotion", motionHandler)
}
}

function computeReading() {
if (samples.current.length < 10) return

const avg =
samples.current.reduce((a, b) => a + b, 0) / samples.current.length

let signal: SignalState
if (avg < 0.4) signal = "Clean"
else if (avg < 1.2) signal = "Reactive"
else signal = "Chaotic"

let energy: EnergyState
if (avg < 0.3) energy = "Off"
else if (avg < 1.5) energy = "On"
else energy = "High"

let form: FormState
if (signal === "Clean") form = "In Control"
else if (signal === "Reactive") form = "In Rhythm"
else form = "Out of Control"

let transitions = reading.transitions

if (signal !== lastSignal.current) {
transitions++
lastSignal.current = signal
}

const chargeGain = Math.floor(avg * 5)

setStoredCharge((c) => c + chargeGain)

setReading({
form,
signal,
energy,
transitions,
windows: Math.floor(time / 5),
charge: chargeGain,
})
}

function start() {
setRunning(true)
startTime.current = Date.now()

timer.current = setInterval(() => {
const t = Math.floor((Date.now() - startTime.current) / 1000)
setTime(t)
computeReading()
}, 500)
}

function stop() {
setRunning(false)

if (timer.current) {
clearInterval(timer.current)
timer.current = null
}
}

useEffect(() => {
return () => {
window.removeEventListener("devicemotion", motionHandler)

if (timer.current) {
clearInterval(timer.current)
timer.current = null
}
}
}, [])

return (
<div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif" }}>
<h2>Axis Machine</h2>

<p>Time {time}s</p>
<p>Stored Charge {storedCharge}</p>

<button onClick={enableMotion}>Motion Permission</button>

{!running ? (
<button onClick={start}>Start</button>
) : (
<button onClick={stop}>Stop</button>
)}

<hr />

<h3>Reading</h3>

<p>Form {reading.form}</p>
<p>Signal {reading.signal}</p>
<p>Energy {reading.energy}</p>
<p>Transitions {reading.transitions}</p>
<p>Windows {reading.windows}</p>
<p>Charge +{reading.charge}</p>
</div>
)
}