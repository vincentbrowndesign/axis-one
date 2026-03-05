"use client";

import React, { useEffect, useRef } from "react";

export default function AxisLiveChart({
data,
}: {
data: number[];
}) {
const canvasRef = useRef<HTMLCanvasElement | null>(null);

useEffect(() => {
const canvas = canvasRef.current;
if (!canvas) return;

const ctx = canvas.getContext("2d");
if (!ctx) return;

const width = canvas.width;
const height = canvas.height;

ctx.clearRect(0, 0, width, height);

if (!data || data.length < 2) return;

const min = Math.min(...data);
const max = Math.max(...data);
const range = max - min || 1;

const step = width / (data.length - 1);

ctx.beginPath();
ctx.lineWidth = 2;
ctx.strokeStyle = "white";

data.forEach((v, i) => {
const x = i * step;
const y = height - ((v - min) / range) * height;

if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
});

ctx.stroke();
}, [data]);

return (
<canvas
ref={canvasRef}
width={350}
height={150}
style={{
width: "100%",
background: "black",
borderRadius: "12px",
}}
/>
);
}