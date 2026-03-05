// lib/runStore.ts

export type Sample = { t: number; mag: number };

export type AxisLastRun = {
sid: string;

startedAt: number;
endedAt: number;
durationMs: number;

samples: Sample[];
tags: number[];

avgMagnitude: number;
peakMagnitude: number;
stability: number; // 0..100

controlTime: number; // 0..100 (v1 can mirror stability)
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
const parsed = JSON.parse(raw) as Partial<AxisLastRun>;
if (parsed?.sid) localStorage.removeItem(`axis:lastRun:${parsed.sid}`);
}
localStorage.removeItem(LAST_RUN_KEY);
} catch {
localStorage.removeItem(LAST_RUN_KEY);
}
}