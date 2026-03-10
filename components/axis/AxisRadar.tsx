"use client"

import { useEffect, useRef } from "react"

interface Props {
tilt: number
rotation: number
}

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value))
}

export default function AxisRadar({ tilt, rotation }: Props) {
const canvasRef = useRef<HTMLCanvasElement>(null)

useEffect(() => {
const canvas = canvasRef.current
if (!canvas) return

const ctx = canvas.getContext("2d")
if (!ctx) return

const w = canvas.width
const h = canvas.height
const cx = w / 2
const cy = h / 2
const radius = 108

ctx.clearRect(0, 0, w, h)

// background
ctx.fillStyle = "#05070a"
ctx.fillRect(0, 0, w, h)

// rings
ctx.strokeStyle = "rgba(255,255,255,0.08)"
ctx.lineWidth = 1
;[34, 68, 102].forEach((r) => {
ctx.beginPath()
ctx.arc(cx, cy, r, 0, Math.PI * 2)
ctx.stroke()
})

// crosshair
ctx.strokeStyle = "rgba(255,255,255,0.16)"
ctx.beginPath()
ctx.moveTo(cx - radius, cy)
ctx.lineTo(cx + radius, cy)
ctx.stroke()

ctx.beginPath()
ctx.moveTo(cx, cy - radius)
ctx.lineTo(cx, cy + radius)
ctx.stroke()

// labels
ctx.fillStyle = "rgba(255,255,255,0.42)"
ctx.font = "12px sans-serif"
ctx.fillText("ALIGN", cx - 18, cy - radius - 8)
ctx.fillText("DROP", cx - 14, cy + radius + 18)
ctx.fillText("SHIFT", cx + radius + 8, cy + 4)
ctx.fillText("RECOVER", 10, cy + 4)

// movement point
const x = cx + clamp(tilt * 10, -92, 92)
const y = cy + clamp(rotation * 0.8, -92, 92)

ctx.fillStyle = "#8CFFB5"
ctx.beginPath()
ctx.arc(x, y, 7, 0, Math.PI * 2)
ctx.fill()

ctx.fillStyle = "rgba(140,255,181,0.18)"
ctx.beginPath()
ctx.arc(x, y, 18, 0, Math.PI * 2)
ctx.fill()
}, [tilt, rotation])

return (
<canvas
ref={canvasRef}
width={260}
height={260}
className="rounded-full border border-white/10 bg-black"
/>
)
}