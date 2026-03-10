import { AxisState, RunSummary, SessionEvent, SignalType } from "@/lib/axis-types";

import { CENTER, STORAGE_KEY, RUN_SECONDS } from "@/lib/axis-types";



export function clamp(n: number, min: number, max: number) {

  return Math.max(min, Math.min(max, n));

}



export function round(n: number, d = 0) {

  const p = Math.pow(10, d);

  return Math.round(n * p) / p;

}



export function avg(values: number[]) {

  if (!values.length) return 0;

  return values.reduce((a, b) => a + b, 0) / values.length;

}



export function scoreReaction(ms: number) {

  return clamp(100 - (ms - 220) / 6, 25, 100);

}



export function scoreRecovery(ms: number) {

  return clamp(100 - (ms - 350) / 8, 20, 100);

}



export function scoreStability(v: number) {

  return clamp(v * 100, 0, 100);

}



export function deriveAxisState(x: number, y: number, center = CENTER): AxisState {

  const dx = x - center;

  const dy = y - center;

  const dist = Math.sqrt(dx * dx + dy * dy);



  if (dist < 42) return "AXIS";

  if (dy > 58) return "DROP";

  if (dist > 145) return "OFF AXIS";

  return "SHIFT";

}



export function signalToPosition(signal: SignalType, center = CENTER) {

  const radius = 205;



  switch (signal) {

    case "LEFT":

      return { x: center - radius, y: center };

    case "RIGHT":

      return { x: center + radius, y: center };

    case "SHOOT":

      return { x: center, y: center - radius };

    case "PASS":

      return { x: center, y: center + radius };

  }

}



export function formatStateLabel(state: AxisState) {

  if (state === "OFF AXIS") return "Off Axis";

  return state.charAt(0) + state.slice(1).toLowerCase();

}



export function loadRunHistory(): RunSummary[] {

  if (typeof window === "undefined") return [];

  try {

    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];

  } catch {

    return [];

  }

}



export function saveRunHistory(history: RunSummary[]) {

  if (typeof window === "undefined") return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 12)));

}



export function buildRunSummary(

  collectedEvents: SessionEvent[],

  fallbackStability: number,

): RunSummary {

  const hits = collectedEvents.filter((e) => e.success).length;

  const misses = collectedEvents.filter((e) => !e.success).length;

  const reaction = round(avg(collectedEvents.map((e) => e.reactionMs)) || 0);

  const recovery = round(avg(collectedEvents.map((e) => e.recoveryMs)) || 0);

  const avgStability = round(

    avg(collectedEvents.map((e) => e.stabilityAtTap)) || fallbackStability,

    2,

  );

  const consistency = collectedEvents.length

    ? round((collectedEvents.filter((e) => e.stateAtTap === "AXIS").length / collectedEvents.length) * 100)

    : 0;



  const score = round(

    scoreStability(avgStability) * 0.35 +

      scoreReaction(reaction || 700) * 0.25 +

      scoreRecovery(recovery || 1200) * 0.2 +

      consistency * 0.2,

    0,

  );



  return {

    id: crypto.randomUUID(),

    createdAt: new Date().toISOString(),

    durationSec: RUN_SECONDS,

    score,

    stability: round(scoreStability(avgStability)),

    reaction: round(scoreReaction(reaction || 700)),

    recovery: round(scoreRecovery(recovery || 1200)),

    consistency,

    hits,

    misses,

  };

}