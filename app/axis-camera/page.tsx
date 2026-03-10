"use client"

import { useEffect, useState } from "react"

import { evaluateAxis } from "@/lib/axis/axisMovementModel"
import { PhoneSensor } from "@/lib/axis/phoneSensor"

import AxisRadar from "@/components/axis/AxisRadar"
import AxisSignalScope from "@/components/axis/AxisSignalScope"

import { AxisSession } from "@/lib/axis/axisSession"

export default function AxisCamera() {

const [state, setState] = useState("unknown")
const [tilt, setTilt] = useState(0)
const [stability, setStability] = useState(0)
const [rotation, setRotation] = useState(0)

useEffect(() => {

const sensor = new PhoneSensor()
const session = new AxisSession()

session.start()

sensor.requestPermission()

sensor.start((sample) => {

const result = evaluateAxis(sample)

setState(result.state)
setTilt(result.tilt)
setRotation(result.rotation)
setStability(result.stability)

session.record({
timestamp: Date.now(),
state: result.state,
tilt: result.tilt,
stability: result.stability,
rotation: result.rotation
})

})

return () => {

sensor.stop()
session.stop()

}

}, [])

return (

<div className="h-screen flex flex-col items-center justify-center bg-black text-white gap-8">

<h1 className="text-4xl font-bold tracking-widest">
AXIS INSTRUMENT
</h1>

<AxisRadar
tilt={tilt}
rotation={rotation}
/>

<AxisSignalScope value={tilt} />

<div className="flex gap-8 text-lg">

<div>State: {state}</div>
<div>Tilt: {tilt.toFixed(2)}</div>
<div>Stability: {stability.toFixed(2)}</div>

</div>

</div>

)
}