// lib/runStore.ts

export type Sample = { t: number; mag: number };

export type AxisLastRun = {
sid: string;
startedAt: number;
endedAt: number;
durationMs: number;
tags: number[];
samples: Sample[];
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
controlTime: number; // 0..100 (simple proxy for now)
jolts: number;
resultLabel: string;
};

const LAST_RUN_KEY = "axis:lastRun";

export function saveLastRun(run: AxisLastRun) {
try {
localStorage.setItem(LAST_RUN_KEY, JSON.stringify(run));
if (run?.sid) localStorage.setItem(`axis:lastRun:${run.sid}`, JSON.stringify(run));
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

export function clearLastRun(sid?: string) {
try {
localStorage.removeItem(LAST_RUN_KEY);
if (sid) localStorage.removeItem(`axis:lastRun:${sid}`);
} catch {}
}

export function computeSummary(run: AxisLastRun): AxisRunSummary {
const data = run.samples || [];
const n = data.length;

if (n < 2) {
return {
sid: run.sid,
at: Date.now(),
durationMs: run.durationMs || 0,
samples: n,
tags: run.tags?.length || 0,
avgMagnitude: 0,
peakMagnitude: 0,
stability: 100,
controlTime: 0,
jolts: 0,
resultLabel: "Searching",
};
}

let sum = 0;
let pk = 0;
for (const s of data) {
sum += s.mag;
if (s.mag > pk) pk = s.mag;
}
const avg = sum / n;

// stability = % within +/- 15% of avg
let within = 0;
const band = avg * 0.15;
for (const s of data) {
if (Math.abs(s.mag - avg) <= band) within++;
}
const stability = Math.round((within / n) * 100);

// jolts = big jumps between consecutive samples (very simple v1)
let jolts = 0;
for (let i = 1; i < n; i++) {
const d = Math.abs(data[i].mag - data[i - 1].mag);
if (d >= 3.0) jolts++;
}

// controlTime proxy = stability for now (until we compute true “in-control windows”)
const controlTime = stability;

const resultLabel = stability >= 85 ? "In Control" : "Searching";

return {
sid: run.sid,
at: Date.now(),
durationMs: run.durationMs || 0,
samples: n,
tags: run.tags?.length || 0,
avgMagnitude: Number(avg.toFixed(2)),
peakMagnitude: Number(pk.toFixed(2)),
stability,
controlTime,
jolts,
resultLabel,
};
}