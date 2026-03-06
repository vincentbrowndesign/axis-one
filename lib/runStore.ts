// lib/runStore.ts
export type AxisLastRun = {
sid: string;
at: number;

startedAt: number;
endedAt: number;

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
localStorage.setItem("axis:lastRunAt", String(Date.now()));
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

export function clearLastRun(sid?: string) {
try {
if (sid) localStorage.removeItem(`axis:lastRun:${sid}`);
localStorage.removeItem(LAST_RUN_KEY);
localStorage.removeItem("axis:lastRunAt");
} catch {}
}