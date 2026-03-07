"use client"

import { useEffect, useRef } from "react"

export function useSensor() {
const energyRef = useRef(0)

useEffect(() => {
const handleMotion = (e: DeviceMotionEvent) => {
const ax = e.accelerationIncludingGravity?.x ?? 0
const ay = e.accelerationIncludingGravity?.y ?? 0
const az = e.accelerationIncludingGravity?.z ?? 0

const magnitude = Math.sqrt(ax * ax + ay * ay + az * az)

energyRef.current = magnitude
}

window.addEventListener("devicemotion", handleMotion)

return () => {
window.removeEventListener("devicemotion", handleMotion)
}
}, [])

return energyRef
}