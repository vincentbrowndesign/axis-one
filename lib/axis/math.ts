import type { Vec3 } from "./types";

export const norm = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const mul = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function onePoleAlpha(fcHz: number, dt: number) {
return Math.exp(-2 * Math.PI * fcHz * dt);
}

export function lpfVec(prev: Vec3, x: Vec3, alpha: number): Vec3 {
return {
x: alpha * prev.x + (1 - alpha) * x.x,
y: alpha * prev.y + (1 - alpha) * x.y,
z: alpha * prev.z + (1 - alpha) * x.z,
};
}

export function lerp(a: number, b: number, w: number) {
return a + w * (b - a);
}

export function interpArray(arr: number[], u: number) {
// u in [0, arr.length-1]
const n = arr.length;
if (n === 0) return 0;
if (n === 1) return arr[0];

const i0 = Math.floor(u);
const i1 = Math.min(n - 1, i0 + 1);
const w = u - i0;
return lerp(arr[i0], arr[i1], w);
}

export function argMax(arr: number[]) {
let best = -Infinity;
let idx = 0;
for (let i = 0; i < arr.length; i++) {
if (arr[i] > best) {
best = arr[i];
idx = i;
}
}
return idx;
}

export function mean(arr: number[]) {
if (!arr.length) return 0;
return arr.reduce((s, x) => s + x, 0) / arr.length;
}

export function std(arr: number[]) {
if (arr.length < 2) return 0;
const m = mean(arr);
const v = mean(arr.map(x => (x - m) ** 2));
return Math.sqrt(v);
}