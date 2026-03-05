"use client";

import { useEffect, useRef } from "react";

export default function AxisLineCanvas({
data,
height = 140,
}: {
data: number[];
height?: number;
}) {
const ref = useRef<HTMLCanvasElement | null>(null);

useEffect(() => {
const canvas = ref.current;
if (!canvas) return;

const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
const parent = canvas.parentElement;
const w = parent ? parent.clientWidth : 320;
const h = height;

canvas.width = Math.floor(w * dpr);
canvas.height = Math.floor(h * dpr);
canvas.style.width = `${w}px`;
canvas.style.height = `${h}px`;

const ctx = canvas.getContext("2d");
if (!ctx) return;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

// background
ctx.clearRect(0, 0, w, h);
ctx.fillStyle = "rgba(0,0,0,0)";
ctx.fillRect(0, 0, w, h);

// grid
ctx.strokeStyle = "rgba(255,255,255,0.08)";
ctx.lineWidth = 1;
const gridX = 6;
const gridY = 4;
for (let i = 1; i < gridX; i++) {
const x = (w * i) / gridX;
ctx.beginPath();
ctx.moveTo(x, 0);
ctx.lineTo(x, h);
ctx.stroke();
}
for (let j = 1; j < gridY; j++) {
const y = (h * j) / gridY;
ctx.beginPath();
ctx.moveTo(0, y);
ctx.lineTo(w, y);
ctx.stroke();
}

if (!data || data.length < 2) return;

// sanitize (avoid NaN crashes)
const clean = data.map((v) => (Number.isFinite(v) ? v : 0));

let min = Infinity;
let max = -Infinity;
for (const v of clean) {
if (v < min) min = v;
if (v > max) max = v;
}
if (!Number.isFinite(min) || !Number.isFinite(max)) return;
if (min === max) {
min -= 1;
max += 1;
}

const pad = 8;
const plotW = w - pad * 2;
const plotH = h - pad * 2;

const toX = (i: number) => pad + (i / (clean.length - 1)) * plotW;
const toY = (v: number) => pad + (1 - (v - min) / (max - min)) * plotH;

ctx.strokeStyle = "rgba(255,255,255,0.92)";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(toX(0), toY(clean[0]));
for (let i = 1; i < clean.length; i++) {
ctx.lineTo(toX(i), toY(clean[i]));
}
ctx.stroke();
}, [data, height]);

return <canvas ref={ref} className="block w-full rounded-2xl" />;
}