"use client";

import * as React from "react";
import type { AxisLinePoint } from "@/lib/axis/types";

type Props = {
points: AxisLinePoint[];
height?: number;
};

function pathFrom(points: { x: number; y: number }[]) {
if (!points.length) return "";
const [p0, ...rest] = points;
let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`;
for (const p of rest) d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
return d;
}

export function AxisLineChart({ points, height = 160 }: Props) {
const w = 640;
const h = height;
const pad = 12;

const x = (u: number) => pad + u * (w - 2 * pad);
const y = (v: number) => pad + (1 - v) * (h - 2 * pad); // invert

const D = points.map(p => ({ x: x(p.u), y: y(p.D) }));
const R = points.map(p => ({ x: x(p.u), y: y(p.R) }));
const J = points.map(p => ({ x: x(p.u), y: y(p.J) }));

return (
<div className="w-full overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-3">
<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
{/* grid */}
{[0.25, 0.5, 0.75].map((g) => (
<line
key={g}
x1={pad}
x2={w - pad}
y1={y(g)}
y2={y(g)}
stroke="rgba(255,255,255,0.06)"
strokeWidth="1"
/>
))}
{/* curves */}
<path d={pathFrom(D)} fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2" />
<path d={pathFrom(R)} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeDasharray="4 4" />
<path d={pathFrom(J)} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeDasharray="2 6" />

{/* legend */}
<g transform="translate(12,12)">
<text x="0" y="0" fill="rgba(255,255,255,0.85)" fontSize="12">D</text>
<text x="18" y="0" fill="rgba(255,255,255,0.55)" fontSize="12">R</text>
<text x="36" y="0" fill="rgba(255,255,255,0.35)" fontSize="12">J</text>
</g>
</svg>
</div>
);
}