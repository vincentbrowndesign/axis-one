// lib/runStore.ts

export type AxisSample = { t: number; mag: number };

export type AxisLastRun = {
sid: string;
startedAt: number;
endedAt: number;
durationMs: number;
tags: number[]; // timestamps
samples: AxisSample[];
};

export type AxisRunSummary = {
sid: string;
at: number;
durationMs: number;
samples: number;
tags: number;
avgMagnitude: number;
peakMagnitude: number;
stability: number; // 0..100
controlTime: number; // 0..100
jolts: number;
resultLabel: string;
};

const LAST_RUN_KEY = "axis:lastRun";

export function saveLastRun(run: AxisLastRun) {
try {
localStorage.setItem(LAST_RUN_KEY, JSON.stringify(run));
if (run?.sid) {
localStorage.setItem(`axis:lastRun:${run.sid}`, JSON.stringify(run));
}
localStorage.setItem("axis:lastRunAt", String(Date.now()));
} catch {}
}

export function loadLastRun(sid?: string): AxisLastRun | null {
try {
if (sid) {
const bySid = localStorage.getItem(`axis:lastRun:${sid}`);
if (bySid) return JSON.parse(bySid);
}
const raw = localStorage.getItem(LAST_RUN_KEY);
if (!raw) return null;
return JSON.parse(raw);
} catch {
return null;
}
}

export function clearLastRun() {
try {
const raw = localStorage.getItem(LAST_RUN_KEY);
if (raw) {
const parsed = JSON.parse(raw) as AxisLastRun;
if (parsed?.sid) localStorage.removeItem(`axis:lastRun:${parsed.sid}`);
}
} catch {}
try {
localStorage.removeItem(LAST_RUN_KEY);
localStorage.removeItem("axis:lastRunAt");
} catch {}
}

function round2(n: number) {
return Number(n.toFixed(2));
}

export function computeSummary(run: AxisLastRun): AxisRunSummary {
const data = run.samples || [];
const count = data.length;

if (count < 2) {
return {
sid: run.sid,
at: run.endedAt || Date.now(),
durationMs: run.durationMs || 0,
samples: count,
tags: run.tags?.length ?? 0,
avgMagnitude: 0,
peakMagnitude: 0,
stability: 100,
controlTime: 100,
jolts: 0,
resultLabel: "No Signal",
};
}

let sum = 0;
let peak = 0;

for (const s of data) {
sum += s.mag;
if (s.mag > peak) peak = s.mag;
}

const avg = sum / count;

// control band: within +/- 15% of avg
const band = Math.max(0.0001, avg * 0.15);

let within = 0;
let jolts = 0;

// “jolt” = sample outside +/- 35% band (you can tune)
const joltBand = Math.max(0.0001, avg * 0.35);

for (const s of data) {
const d = Math.abs(s.mag - avg);
if (d <= band) within++;
if (d > joltBand) jolts++;
}

const controlTime = Math.round((within / count) * 100);

// stability = same thing for now (v1)
const stability = controlTime;

const resultLabel =
stability >= 90 ? "In Control" :
stability >= 75 ? "In Rhythm" :
stability >= 55 ? "Searching" :
"Out of Control";

return {
sid: run.sid,
at: run.endedAt || Date.now(),
durationMs: run.durationMs || 0,
samples: count,
tags: run.tags?.length ?? 0,
avgMagnitude: round2(avg),
peakMagnitude: round2(peak),
stability,
controlTime,
jolts,
resultLabel,
};
}