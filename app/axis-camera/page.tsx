"use client"

import { useEffect, useState } from "react"

import { evaluateAxis } from "@/lib/axis/axisMovementModel"
import { PhoneSensor } from "@/lib/axis/phoneSensor"

import AxisRadar from "@/components/axis/AxisRadar"
import AxisSignalScope from "@/components/axis/AxisSignalScope"

export default function AxisCameraPage() {
const [permission, setPermission] = useState<"idle" | "ready" | "denied">("idle")
const [running, setRunning] = useState(false)

const [state, setState] = useState("unknown")
const [tilt, setTilt] = useState(0)
const [stability, setStability] = useState(0)
const [rotation, setRotation] = useState(0)

useEffect(() => {
const sensor = new PhoneSensor()

async function start() {
try {
await sensor.requestPermission()
setPermission("ready")

sensor.start((sample) => {
const result = evaluateAxis(sample)

setState(result.state)
setTilt(result.tilt)
setRotation(result.rotation)
setStability(result.stability)
setRunning(true)
})
} catch {
setPermission("denied")
setRunning(false)
}
}

start()

return () => {
sensor.stop()
setRunning(false)
}
}, [])

return (
<main className="min-h-screen bg-[#030405] text-white">
<div className="mx-auto flex min-h-screen max-w-[1200px] flex-col items-center justify-center gap-8 px-4 py-10">
<div className="text-center">
<div className="mb-3 text-[11px] tracking-[0.28em] text-white/45">
AXIS MOVEMENT INSTRUMENT
</div>
<h1 className="text-4xl font-semibold tracking-[0.08em] sm:text-5xl">
STATE / SIGNAL / FIELD
</h1>
<p className="mt-3 text-sm text-white/55 sm:text-base">
Movement model first. Sensor-ready for phone now, chip later.
</p>
</div>

{permission === "denied" ? (
<div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
Motion permission denied. Refresh and allow motion access.
</div>
) : null}

<div className="grid w-full gap-8 lg:grid-cols-[300px_minmax(0,560px)] lg:items-center">
<div className="flex justify-center">
<AxisRadar tilt={tilt} rotation={rotation} />
</div>

<div className="flex justify-center">
<AxisSignalScope value={tilt} />
</div>
</div>

<div className="grid w-full max-w-[900px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
<div className="text-[11px] tracking-[0.22em] text-white/45">STATE</div>
<div className="mt-2 text-2xl font-semibold text-[#8CFFB5]">{state}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
<div className="text-[11px] tracking-[0.22em] text-white/45">TILT</div>
<div className="mt-2 text-2xl font-semibold text-white">{tilt.toFixed(2)}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
<div className="text-[11px] tracking-[0.22em] text-white/45">ROTATION</div>
<div className="mt-2 text-2xl font-semibold text-white">{rotation.toFixed(2)}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
<div className="text-[11px] tracking-[0.22em] text-white/45">STABILITY</div>
<div className="mt-2 text-2xl font-semibold text-white">{stability.toFixed(0)}%</div>
</div>
</div>

<div className="text-xs tracking-[0.18em] text-white/35">
{running ? "LIVE SENSOR ACTIVE" : "WAITING FOR SENSOR"}
</div>
</div>
</main>
)
}