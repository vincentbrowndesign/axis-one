"use client"

import { useEffect, useRef } from "react"

interface Props {
value: number
}

export default function AxisSignalScope({ value }: Props) {
const canvasRef = useRef<HTMLCanvasElement>(null)
const historyRef = useRef<number[]>([])

useEffect(() => {
const canvas = canvasRef.current
if (!canvas) return

const ctx = canvas.getContext("2d")
if (!ctx) return

const width = canvas.width
const height = canvas.height

historyRef.current.push(value)
if (historyRef.current.length > 140) {
historyRef.current.shift()
}

ctx.clearRect(0, 0, width, height)

// background
ctx.fillStyle = "#040506"
ctx.fillRect(0, 0, width, height)

// grid
ctx.strokeStyle = "rgba(255,255,255,0.08)"
ctx.lineWidth = 1

for (let x = 0; x <= width; x += 40) {
ctx.beginPath()
ctx.moveTo(x, 0)
ctx.lineTo(x, height)
ctx.stroke()
}

for (let y = 0; y <= height; y += 30) {
ctx.beginPath()
ctx.moveTo(0, y)
ctx.lineTo(width, y)
ctx.stroke()
}

// midline
ctx.strokeStyle = "rgba(255,255,255,0.18)"
ctx.beginPath()
ctx.moveTo(0, height / 2)
ctx.lineTo(width, height / 2)
ctx.stroke()

// waveform
ctx.strokeStyle = "#8CFFB5"
ctx.lineWidth = 2.5
ctx.beginPath()

historyRef.current.forEach((v, i) => {
const x = (i / Math.max(historyRef.current.length - 1, 1)) * width
const y = height / 2 - v * 12

if (i === 0) ctx.moveTo(x, y)
else ctx.lineTo(x, y)
})

ctx.stroke()
}, [value])

return (
<canvas
ref={canvasRef}
width={560}
height={180}
className="w-full max-w-[560px] rounded-2xl border border-white/10 bg-black"
/>
)
}