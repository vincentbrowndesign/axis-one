import type {
AxisDecision,
AxisFeatures,
AxisLinePoint,
AxisOneSample,
AxisOneSession,
AxisPatternGuess,
Vec3,
} from "./types";
import { argMax, clamp, interpArray, lpfVec, mean, norm, onePoleAlpha, std, sub, mul, dot } from "./math";

type InterpretOptions = {
fsHz?: number; // default 60
preSec?: number; // default 1.0
postSec?: number; // default 4.0
N?: number; // default 128
gravityCutoffHz?: number; // default 0.7
gyroUnits?: "deg/s" | "rad/s"; // default deg/s based on your data
};

function toVec3FromRotationRate(rr: { alpha: number; beta: number; gamma: number }): Vec3 {
// treat alpha/beta/gamma as a 3-axis angular velocity vector in device coords
return { x: rr.alpha, y: rr.beta, z: rr.gamma };
}

function resampleToFixedFs(samples: AxisOneSample[], fsHz: number) {
// Samples are already ~60Hz but not perfectly uniform. We do a time-based resample.
// Output arrays at fixed dt from first to last sample.
if (samples.length < 2) return { t: [] as number[], aG: [] as Vec3[], w: [] as Vec3[] };

const t0 = samples[0].t;
const t1 = samples[samples.length - 1].t;
const dtMs = 1000 / fsHz;

const outT: number[] = [];
const outAG: Vec3[] = [];
const outW: Vec3[] = [];

let j = 0;

for (let tt = t0; tt <= t1; tt += dtMs) {
while (j < samples.length - 2 && samples[j + 1].t < tt) j++;

const s0 = samples[j];
const s1 = samples[j + 1];
const span = Math.max(1, s1.t - s0.t);
const w = clamp((tt - s0.t) / span, 0, 1);

const lerpV = (a: Vec3, b: Vec3): Vec3 => ({
x: a.x + w * (b.x - a.x),
y: a.y + w * (b.y - a.y),
z: a.z + w * (b.z - a.z),
});

const aG0 = s0.accelIncludingGravity;
const aG1 = s1.accelIncludingGravity;

const w0 = toVec3FromRotationRate(s0.rotationRate);
const w1 = toVec3FromRotationRate(s1.rotationRate);

outT.push(tt);
outAG.push(lerpV(aG0, aG1));
outW.push(lerpV(w0, w1));
}

return { t: outT, aG: outAG, w: outW };
}

function computeAxisSignals(params: {
tMs: number[];
accelIncludingG: Vec3[];
gyro: Vec3[];
fsHz: number;
gravityCutoffHz: number;
gyroUnits: "deg/s" | "rad/s";
}) {
const { tMs, accelIncludingG, gyro, fsHz, gravityCutoffHz, gyroUnits } = params;

const dt = 1 / fsHz;
const alphaG = onePoleAlpha(gravityCutoffHz, dt);

let gHat: Vec3 = accelIncludingG[0];

const D: number[] = [];
const R: number[] = [];
const J: number[] = [];

let prevAd: Vec3 | null = null;

const kOmega = gyroUnits === "deg/s" ? 0.02 : 1.0;

for (let i = 0; i < tMs.length; i++) {
gHat = lpfVec(gHat, accelIncludingG[i], alphaG);

const ad = sub(accelIncludingG[i], gHat); // dynamic accel
const L = norm(ad);

// spine axis from gravity
const gMag = norm(gHat) || 1e-9;
const s = mul(gHat, -1 / gMag); // unit "up" axis

const cosTheta = clamp(dot(ad, s) / ((L || 1e-9) * 1.0), -1, 1);
const theta = Math.acos(cosTheta);

const d = L * Math.sin(theta); // Structural deviation under load
D.push(d);

const omega = norm(gyro[i]);
R.push(kOmega * omega);

if (!prevAd) J.push(0);
else {
const jerkVec = mul(sub(ad, prevAd), fsHz); // /dt
J.push(norm(jerkVec));
}
prevAd = ad;
}

return { D, R, J };
}

function normalizeWindow(arr: number[]) {
const eps = 1e-6;
const mx = Math.max(...arr) + eps;
return { norm: arr.map(v => v / mx), max: mx - eps };
}

function resampleN(arr: number[], N: number) {
const M = arr.length;
if (M === 0) return new Array(N).fill(0);
if (M === 1) return new Array(N).fill(arr[0]);

const out: number[] = [];
for (let i = 0; i < N; i++) {
const u = (i / (N - 1)) * (M - 1);
out.push(interpArray(arr, u));
}
return out;
}

function extractWindowIndices(tMs: number[], startMs: number, endMs: number) {
// inclusive start, inclusive end-ish
let i0 = 0;
while (i0 < tMs.length && tMs[i0] < startMs) i0++;

let i1 = i0;
while (i1 < tMs.length && tMs[i1] <= endMs) i1++;

return { i0, i1 }; // slice [i0, i1)
}

function computeFeatures(points: AxisLinePoint[], peaksRaw: { Dmax: number; Rmax: number; Jmax: number }): AxisFeatures {
const D = points.map(p => p.D);
const R = points.map(p => p.R);
const J = points.map(p => p.J);

const iPeakD = argMax(D);
const iPeakR = argMax(R);
const iPeakJ = argMax(J);

const tPeakD = points[iPeakD]?.u ?? 0;
const tPeakR = points[iPeakR]?.u ?? 0;
const tPeakJ = points[iPeakJ]?.u ?? 0;

// smoothness: std of first derivative of D+R (lower = smoother)
const deriv: number[] = [];
for (let i = 1; i < points.length; i++) {
const d = (D[i] - D[i - 1]) + (R[i] - R[i - 1]);
deriv.push(d);
}
const smoothness = std(deriv);

// asymmetry: compare left half vs right half energy in D
const mid = Math.floor(points.length / 2);
const left = D.slice(0, mid);
const right = D.slice(mid);
const eL = mean(left.map(x => x * x));
const eR = mean(right.map(x => x * x));
const asymmetry = Math.abs(eL - eR) / (eL + eR + 1e-6);

// impulse: how concentrated jerk is around its peak
const peak = Math.max(...J) + 1e-6;
const above = J.filter(v => v > 0.6 * peak).length;
const impulseIndex = 1 - clamp(above / J.length, 0, 1); // fewer points above threshold = sharper impulse

return {
tPeakD,
tPeakR,
tPeakJ,
smoothness,
asymmetry,
impulseIndex,
Dmax: peaksRaw.Dmax,
Rmax: peaksRaw.Rmax,
Jmax: peaksRaw.Jmax,
};
}

function guessPattern(features: AxisFeatures): AxisPatternGuess {
// v0 heuristic classifier
// - crossover: high rotation + sharp impulse + early peak
// - stepback: late peak D + high jerk + higher asymmetry
// - drive: earlier D peak + smoother curve + moderate rotation
// - stop: high jerk but low rotation and D falls fast (we approximate using impulse + low R)
const { Rmax, Jmax, Dmax, tPeakD, tPeakR, tPeakJ, smoothness, asymmetry, impulseIndex } = features;

// normalize raw magnitudes into rough bands (device dependent)
const Rhi = Rmax > 0.9; // after scaling; tends to be >~1 for big turns
const Jhi = Jmax > 8; // jerk spikes can go high; tune later
const Dhi = Dmax > 2; // deviation raw (m/s^2-ish); tune later

// crossover
if (Rhi && impulseIndex > 0.6 && tPeakR < 0.55) {
const conf = clamp(0.65 + 0.15 * impulseIndex + (tPeakR < 0.4 ? 0.1 : 0), 0, 0.95);
return { label: "crossover", confidence: conf, reason: "High rotation + sharp impulse + early rotation peak." };
}

// stepback
if (tPeakD > 0.6 && (Jhi || impulseIndex > 0.55) && asymmetry > 0.12) {
const conf = clamp(0.6 + 0.15 * asymmetry + 0.1 * impulseIndex, 0, 0.92);
return { label: "stepback", confidence: conf, reason: "Late deviation peak + impulse + asymmetric energy." };
}

// stop
if (Jhi && !Rhi && !Dhi && impulseIndex > 0.65) {
const conf = clamp(0.55 + 0.2 * impulseIndex, 0, 0.9);
return { label: "stop", confidence: conf, reason: "Sharp jerk spike with low rotation/deviation." };
}

// drive
if (tPeakD < 0.55 && smoothness < 0.08 && (Dhi || Jhi)) {
const conf = clamp(0.55 + (smoothness < 0.05 ? 0.1 : 0) + (Dhi ? 0.1 : 0), 0, 0.9);
return { label: "drive", confidence: conf, reason: "Earlier deviation peak with smoother load curve." };
}

return { label: "unknown", confidence: 0.25, reason: "Not enough pattern confidence yet." };
}

export function interpretAxisOneSession(session: AxisOneSession, opts: InterpretOptions = {}) {
const fsHz = opts.fsHz ?? 60;
const preSec = opts.preSec ?? 1.0;
const postSec = opts.postSec ?? 4.0;
const N = opts.N ?? 128;
const gravityCutoffHz = opts.gravityCutoffHz ?? 0.7;

// Your file shows gyro values like 40, 60, etc → deg/s.
const gyroUnits = opts.gyroUnits ?? "deg/s";

const tags = session.tags ?? [];
if (!tags.length) {
return {
decisions: [] as AxisDecision[],
meta: { fsHz, preSec, postSec, N, gyroUnits },
warning: "No tags found in session.tags. Export includes tags_count but tags array missing.",
};
}

// resample whole session to fixed time base
const { t: tMs, aG, w } = resampleToFixedFs(session.samples, fsHz);

// compute signals across entire time base
const { D, R, J } = computeAxisSignals({
tMs,
accelIncludingG: aG,
gyro: w,
fsHz,
gravityCutoffHz,
gyroUnits,
});

const decisions: AxisDecision[] = [];

for (let k = 0; k < tags.length; k++) {
const tagTimeMs = tags[k].t;

const windowStartMs = tagTimeMs - preSec * 1000;
const windowEndMs = tagTimeMs + postSec * 1000;

const { i0, i1 } = extractWindowIndices(tMs, windowStartMs, windowEndMs);
const Dw = D.slice(i0, i1);
const Rw = R.slice(i0, i1);
const Jw = J.slice(i0, i1);

if (Dw.length < 10) continue;

const Dn = normalizeWindow(Dw);
const Rn = normalizeWindow(Rw);
const Jn = normalizeWindow(Jw);

const D128 = resampleN(Dn.norm, N);
const R128 = resampleN(Rn.norm, N);
const J128 = resampleN(Jn.norm, N);

const points: AxisLinePoint[] = [];
for (let i = 0; i < N; i++) {
const u = i / (N - 1);
points.push({ u, D: D128[i], R: R128[i], J: J128[i] });
}

const peaks = { Dmax: Dn.max, Rmax: Rn.max, Jmax: Jn.max };
const features = computeFeatures(points, peaks);
const pattern = guessPattern(features);

decisions.push({
tagIndex: k,
tagTimeMs,
windowStartMs,
windowEndMs,
points,
peaks,
features,
pattern,
});
}

return {
decisions,
meta: { fsHz, preSec, postSec, N, gravityCutoffHz, gyroUnits },
};
}