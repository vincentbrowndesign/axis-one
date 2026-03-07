"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CircleDot, Send, Sparkles, RotateCcw } from "lucide-react";

type LiveState = "OFF" | "LIVE";
type Sensitivity = "Low" | "Medium" | "High" | "Raw";
type OrbType = "form" | "scale" | "transmit";
type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type Mode = "ambient" | "build";

type SlotId =
| "n"
| "ne"
| "se"
| "s"
| "sw"
| "nw"
| "n2"
| "e2"
| "s2"
| "w2"
| "ne2"
| "sw2";

type Slot = {
id: SlotId;
x: number;
y: number;
ring: 1 | 2;
};

type Orb = {
id: string;
slotId: SlotId;
type: OrbType;
level: number;
baseSize: number;
transmitting: boolean;
integrity: number;
capacity: number;
load: number;
depth: number; // -1 to 1
phase: number; // unique drift seed
};

type Pattern = {
name: string;
bonus: number;
};

const CHARGE_KEY = "axis_pyron_star_charge_v1";
const LIVE_KEY = "axis_pyron_star_live_v1";
const ENERGY_KEY = "axis_pyron_star_energy_v1";
const SENSITIVITY_KEY = "axis_pyron_star_sensitivity_v1";
const ORBS_KEY = "axis_pyron_star_orbs_v1";
const FOCUS_KEY = "axis_pyron_star_focus_v1";
const MODE_KEY = "axis_pyron_star_mode_v1";
const WINDOWS_KEY = "axis_pyron_star_windows_v1";
const TRANSITIONS_KEY = "axis_pyron_star_transitions_v1";
const SESSION_CHARGE_KEY = "axis_pyron_star_session_charge_v1";
const ELAPSED_KEY = "axis_pyron_star_elapsed_v1";
const SCORE_KEY = "axis_pyron_star_score_v1";

const FORM_COST = 45;
const SCALE_COST = 60;
const TRANSMIT_COST = 100;

const SLOTS: Slot[] = [
{ id: "n", x: 0, y: -118, ring: 1 },
{ id: "ne", x: 108, y: -62, ring: 1 },
{ id: "se", x: 108, y: 62, ring: 1 },
{ id: "s", x: 0, y: 118, ring: 1 },
{ id: "sw", x: -108, y: 62, ring: 1 },
{ id: "nw", x: -108, y: -62, ring: 1 },

{ id: "n2", x: 0, y: -198, ring: 2 },
{ id: "e2", x: 178, y: 0, ring: 2 },
{ id: "s2", x: 0, y: 198, ring: 2 },
{ id: "w2", x: -178, y: 0, ring: 2 },
{ id: "ne2", x: 148, y: -114, ring: 2 },
{ id: "sw2", x: -148, y: 114, ring: 2 },
];

const SLOT_ORDER: SlotId[] = [
"n",
"ne",
"se",
"s",
"sw",
"nw",
"n2",
"e2",
"s2",
"w2",
"ne2",
"sw2",
];

const INNER_RING: SlotId[] = ["n", "ne", "se", "s", "sw", "nw"];

function getStage(charge: number): Stage {
if (charge < 50) return "Seed";
if (charge < 150) return "Core";
if (charge < 400) return "Pulse";
if (charge < 1000) return "Nova";
return "Titan";
}

function getNextThreshold(stage: Stage): number {
if (stage === "Seed") return 50;
if (stage === "Core") return 150;
if (stage === "Pulse") return 400;
if (stage === "Nova") return 1000;
return 1600;
}

function getStageMin(stage: Stage): number {
if (stage === "Seed") return 0;
if (stage === "Core") return 50;
if (stage === "Pulse") return 150;
if (stage === "Nova") return 400;
return 1000;
}

function getUnlockedSlotIds(charge: number): SlotId[] {
if (charge < 50) return ["n", "sw", "se"];
if (charge < 150) return ["n", "ne", "se", "s", "sw", "nw"];
if (charge < 400) return ["n", "ne", "se", "s", "sw", "nw", "e2", "w2"];
return SLOT_ORDER;
}

function getEnergyMultiplier(value: Sensitivity) {
if (value === "Low") return 0.42;
if (value === "Medium") return 0.76;
if (value === "High") return 1;
return 1.34;
}

function getOrbIcon(type: OrbType) {
if (type === "form") return CircleDot;
if (type === "scale") return Sparkles;
return Send;
}

function getOrbLabel(type: OrbType) {
if (type === "form") return "Form";
if (type === "scale") return "Scale";
return "Transmit";
}

function findSlot(slotId: SlotId) {
return SLOTS.find((s) => s.id === slotId)!;
}

function getFirstEmptySlot(orbs: Orb[], unlocked: SlotId[]) {
const used = new Set(orbs.map((o) => o.slotId));
for (const slotId of SLOT_ORDER) {
if (unlocked.includes(slotId) && !used.has(slotId)) return slotId;
}
return null;
}

function detectPattern(orbs: Orb[]): Pattern | null {
const occupied = new Set(orbs.map((o) => o.slotId));

const triangles: SlotId[][] = [
["n", "sw", "se"],
["s", "nw", "ne"],
["n", "se", "s"],
["n", "sw", "s"],
];

for (const set of triangles) {
if (set.every((id) => occupied.has(id))) {
return { name: "Triangle", bonus: 12 };
}
}

const chains: SlotId[][] = [
["n2", "n", "s", "s2"],
["w2", "sw", "se", "e2"],
];

for (const set of chains) {
if (set.every((id) => occupied.has(id))) {
return { name: "Chain", bonus: 18 };
}
}

const hubCount = INNER_RING.filter((id) => occupied.has(id)).length;
if (hubCount >= 4) {
return { name: "Hub", bonus: 20 };
}

return null;
}

function formatTime(totalSeconds: number) {
const mins = Math.floor(totalSeconds / 60);
const secs = totalSeconds % 60;
return `${mins}m ${secs}s`;
}

function getStateRead(energy: number, transitions: number, integrityAvg: number) {
if (integrityAvg < 38) {
return { form: "Breaking", signal: "Chaotic", energy: "Critical" };
}
if (energy < 22) {
return { form: "In Control", signal: "Clean", energy: "Low" };
}
if (energy < 48) {
return { form: "Searching", signal: "Reactive", energy: "On" };
}
if (transitions > 18 || energy > 72) {
return { form: "Out of Control", signal: "Chaotic", energy: "High" };
}
return { form: "In Rhythm", signal: "Reactive", energy: "On" };
}

function getNeighbors(slotId: SlotId): SlotId[] {
const neighborMap: Record<SlotId, SlotId[]> = {
n: ["ne", "nw", "n2"],
ne: ["n", "se", "e2"],
se: ["ne", "s", "e2"],
s: ["se", "sw", "s2"],
sw: ["s", "nw", "w2"],
nw: ["n", "sw", "w2"],
n2: ["n", "ne2", "w2"],
e2: ["ne", "se", "n2", "s2"],
s2: ["s", "sw2", "e2"],
w2: ["nw", "sw", "n2", "s2"],
ne2: ["n2", "e2", "ne"],
sw2: ["s2", "w2", "sw"],
};
return neighborMap[slotId] ?? [];
}

function computeLoadDistribution(orbs: Orb[], liveEnergy: number, elapsedSeconds: number) {
const orbMap = new Map(orbs.map((o) => [o.slotId, o]));
const timePressure = 6 + Math.min(28, elapsedSeconds * 0.15);

return orbs.map((orb) => {
const neighbors = getNeighbors(orb.slotId)
.map((id) => orbMap.get(id))
.filter(Boolean) as Orb[];

const neighborTransfer =
neighbors.reduce((sum, n) => sum + n.level * 3 + n.load * 0.08, 0) /
Math.max(1, neighbors.length);

const typeBias =
orb.type === "transmit" ? 18 : orb.type === "scale" ? 12 : 8;

const liveBias = liveEnergy * 0.34;
const load = Math.max(
0,
Math.round(typeBias + liveBias + neighborTransfer + timePressure)
);

return { ...orb, load };
});
}

function applyDecay(
orbs: Orb[],
elapsedSeconds: number,
liveEnergy: number,
pattern: Pattern | null
) {
const timeDecay = 0.7 + Math.min(2.4, elapsedSeconds / 90);
const patternShield = pattern ? pattern.bonus * 0.05 : 0;

return orbs
.map((orb) => {
const overload = Math.max(0, orb.load - orb.capacity);
const overloadPenalty = overload * 0.18;
const energyPenalty = liveEnergy > 78 ? 1.2 : 0;
const integrityLoss = timeDecay + overloadPenalty + energyPenalty - patternShield;

const nextIntegrity = Math.max(0, orb.integrity - integrityLoss);

return {
...orb,
integrity: Number(nextIntegrity.toFixed(1)),
};
})
.filter((orb) => orb.integrity > 0);
}

function makeOrb(slotId: SlotId, type: OrbType = "form"): Orb {
return {
id: `orb-${slotId}-${Date.now()}`,
slotId,
type,
level: 1,
baseSize: 52,
transmitting: false,
integrity: 100,
capacity: 120,
load: 0,
depth: Math.random() * 2 - 1,
phase: Math.random() * Math.PI * 2,
};
}

function getDefaultOrbs(): Orb[] {
return [
makeOrb("n", "form"),
makeOrb("sw", "scale"),
makeOrb("se", "transmit"),
];
}

function safeParseOrbs(raw: string | null): Orb[] {
if (!raw) return getDefaultOrbs();
try {
const parsed = JSON.parse(raw) as Orb[];
if (!Array.isArray(parsed) || parsed.length === 0) return getDefaultOrbs();
return parsed.map((o) => ({
...o,
depth: typeof o.depth === "number" ? o.depth : Math.random() * 2 - 1,
phase: typeof o.phase === "number" ? o.phase : Math.random() * Math.PI * 2,
baseSize: typeof o.baseSize === "number" ? o.baseSize : 52,
}));
} catch {
return getDefaultOrbs();
}
}

function slotRenderPosition(slot: Slot, orb: Orb, time: number) {
const depthScale = 1 + orb.depth * 0.12;
const driftX = Math.sin(time * 0.0008 + orb.phase) * (6 + Math.abs(orb.depth) * 8);
const driftY = Math.cos(time * 0.001 + orb.phase * 1.37) * (4 + Math.abs(orb.depth) * 6);
const parallaxY = orb.depth * 12;
const x = slot.x * depthScale + driftX;
const y = slot.y * (1 - orb.depth * 0.06) + driftY + parallaxY;

return { x, y };
}

function orbVisuals(orb: Orb) {
const size = orb.baseSize * (1 + orb.level * 0.08) * (1 + orb.depth * 0.08);
const opacity = orb.integrity > 70 ? 1 : orb.integrity > 40 ? 0.78 : 0.52;
const blur = orb.depth < -0.35 ? 0.8 : 0;
const glow = 18 + orb.level * 6 + (orb.transmitting ? 24 : 0);
return { size, opacity, blur, glow };
}

export default function PyronClient() {
const [charge, setCharge] = useState(149);
const [liveState, setLiveState] = useState<LiveState>("OFF");
const [liveEnergy, setLiveEnergy] = useState(18);
const [sensitivity, setSensitivity] = useState<Sensitivity>("Medium");
const [orbs, setOrbs] = useState<Orb[]>(getDefaultOrbs());
const [focusedOrbId, setFocusedOrbId] = useState<string | null>(null);
const [mode, setMode] = useState<Mode>("ambient");
const [message, setMessage] = useState("Goal: maintain structure under pressure.");
const [windowsCount, setWindowsCount] = useState(0);
const [transitions, setTransitions] = useState(0);
const [sessionCharge, setSessionCharge] = useState(0);
const [elapsedSeconds, setElapsedSeconds] = useState(0);
const [score, setScore] = useState(0);
const [tick, setTick] = useState(0);

const prevEnergyRef = useRef(18);

useEffect(() => {
if (typeof window === "undefined") return;

const savedCharge = Number(window.localStorage.getItem(CHARGE_KEY) ?? 149);
const savedLive =
(window.localStorage.getItem(LIVE_KEY) as LiveState | null) ?? "OFF";
const savedEnergy = Number(window.localStorage.getItem(ENERGY_KEY) ?? 18);
const savedSensitivity =
(window.localStorage.getItem(SENSITIVITY_KEY) as Sensitivity | null) ?? "Medium";
const savedOrbs = safeParseOrbs(window.localStorage.getItem(ORBS_KEY));
const savedFocus = window.localStorage.getItem(FOCUS_KEY);
const savedMode =
(window.localStorage.getItem(MODE_KEY) as Mode | null) ?? "ambient";
const savedWindows = Number(window.localStorage.getItem(WINDOWS_KEY) ?? 0);
const savedTransitions = Number(window.localStorage.getItem(TRANSITIONS_KEY) ?? 0);
const savedSessionCharge = Number(
window.localStorage.getItem(SESSION_CHARGE_KEY) ?? 0
);
const savedElapsed = Number(window.localStorage.getItem(ELAPSED_KEY) ?? 0);
const savedScore = Number(window.localStorage.getItem(SCORE_KEY) ?? 0);

if (!Number.isNaN(savedCharge)) setCharge(savedCharge);
if (savedLive === "LIVE" || savedLive === "OFF") setLiveState(savedLive);
if (!Number.isNaN(savedEnergy)) {
setLiveEnergy(savedEnergy);
prevEnergyRef.current = savedEnergy;
}
if (
savedSensitivity === "Low" ||
savedSensitivity === "Medium" ||
savedSensitivity === "High" ||
savedSensitivity === "Raw"
) {
setSensitivity(savedSensitivity);
}
setOrbs(savedOrbs);
setFocusedOrbId(savedFocus ?? savedOrbs[0]?.id ?? null);
if (savedMode === "ambient" || savedMode === "build") setMode(savedMode);
if (!Number.isNaN(savedWindows)) setWindowsCount(savedWindows);
if (!Number.isNaN(savedTransitions)) setTransitions(savedTransitions);
if (!Number.isNaN(savedSessionCharge)) setSessionCharge(savedSessionCharge);
if (!Number.isNaN(savedElapsed)) setElapsedSeconds(savedElapsed);
if (!Number.isNaN(savedScore)) setScore(savedScore);
}, []);

useEffect(() => {
if (typeof window === "undefined") return;
window.localStorage.setItem(CHARGE_KEY, String(charge));
window.localStorage.setItem(LIVE_KEY, liveState);
window.localStorage.setItem(ENERGY_KEY, String(liveEnergy));
window.localStorage.setItem(SENSITIVITY_KEY, sensitivity);
window.localStorage.setItem(ORBS_KEY, JSON.stringify(orbs));
if (focusedOrbId) window.localStorage.setItem(FOCUS_KEY, focusedOrbId);
window.localStorage.setItem(MODE_KEY, mode);
window.localStorage.setItem(WINDOWS_KEY, String(windowsCount));
window.localStorage.setItem(TRANSITIONS_KEY, String(transitions));
window.localStorage.setItem(SESSION_CHARGE_KEY, String(sessionCharge));
window.localStorage.setItem(ELAPSED_KEY, String(elapsedSeconds));
window.localStorage.setItem(SCORE_KEY, String(score));
}, [
charge,
liveState,
liveEnergy,
sensitivity,
orbs,
focusedOrbId,
mode,
windowsCount,
transitions,
sessionCharge,
elapsedSeconds,
score,
]);

useEffect(() => {
const interval = window.setInterval(() => setTick(Date.now()), 60);
return () => window.clearInterval(interval);
}, []);

const unlockedSlots = useMemo(() => getUnlockedSlotIds(charge), [charge]);
const pattern = useMemo(() => detectPattern(orbs), [orbs]);

useEffect(() => {
if (liveState !== "LIVE") return;

const interval = window.setInterval(() => {
const nextEnergy = Math.max(
8,
Math.min(
100,
liveEnergy + (Math.random() * 16 - 6) * getEnergyMultiplier(sensitivity)
)
);

const prevEnergy = prevEnergyRef.current;
const delta = Math.abs(nextEnergy - prevEnergy);

setLiveEnergy(Number(nextEnergy.toFixed(1)));
prevEnergyRef.current = nextEnergy;

const gain = Math.max(
0,
Math.round((nextEnergy / 26) * getEnergyMultiplier(sensitivity))
);

if (gain > 0) {
setCharge((prev) => prev + gain);
setSessionCharge((prev) => prev + gain);
setScore((prev) => prev + gain);
}

if (delta > 10) setTransitions((prev) => prev + 1);
if (nextEnergy > 58 && prevEnergy <= 58) setWindowsCount((prev) => prev + 1);
}, 1400);

return () => window.clearInterval(interval);
}, [liveState, liveEnergy, sensitivity]);

useEffect(() => {
if (liveState !== "LIVE") return;

const timer = window.setInterval(() => {
setElapsedSeconds((prev) => prev + 1);
setScore((prev) => prev + 1);
}, 1000);

return () => window.clearInterval(timer);
}, [liveState]);

useEffect(() => {
if (liveState !== "LIVE") return;

const decayTimer = window.setInterval(() => {
setOrbs((prev) => {
if (prev.length === 0) return prev;
const distributed = computeLoadDistribution(prev, liveEnergy, elapsedSeconds);
const next = applyDecay(distributed, elapsedSeconds, liveEnergy, pattern);

if (next.length < prev.length) {
setMessage("A structure collapsed under pressure.");
const remainingIds = new Set(next.map((o) => o.id));
if (focusedOrbId && !remainingIds.has(focusedOrbId)) {
setFocusedOrbId(next[0]?.id ?? null);
}
}

return next;
});
}, 1800);

return () => window.clearInterval(decayTimer);
}, [liveState, liveEnergy, elapsedSeconds, pattern, focusedOrbId]);

const stage = useMemo(() => getStage(charge), [charge]);
const nextThreshold = useMemo(() => getNextThreshold(stage), [stage]);
const stageMin = useMemo(() => getStageMin(stage), [stage]);
const progress = useMemo(() => {
const span = nextThreshold - stageMin;
if (span <= 0) return 100;
return Math.max(0, Math.min(100, ((charge - stageMin) / span) * 100));
}, [charge, nextThreshold, stageMin]);

const focusedOrb = useMemo(
() => orbs.find((orb) => orb.id === focusedOrbId) ?? null,
[orbs, focusedOrbId]
);

const integrityAvg = useMemo(() => {
if (orbs.length === 0) return 0;
return orbs.reduce((sum, orb) => sum + orb.integrity, 0) / orbs.length;
}, [orbs]);

const stateRead = useMemo(
() => getStateRead(liveEnergy, transitions, integrityAvg),
[liveEnergy, transitions, integrityAvg]
);

function toggleLive() {
setLiveState((prev) => {
const next = prev === "LIVE" ? "OFF" : "LIVE";
setMessage(next === "LIVE" ? "Pyron is LIVE." : "Pyron is OFF.");
return next;
});
}

function resetSystem() {
const defaults = getDefaultOrbs();
setCharge(149);
setLiveState("OFF");
setLiveEnergy(18);
prevEnergyRef.current = 18;
setSensitivity("Medium");
setOrbs(defaults);
setFocusedOrbId(defaults[0]?.id ?? null);
setMode("ambient");
setWindowsCount(0);
setTransitions(0);
setSessionCharge(0);
setElapsedSeconds(0);
setScore(0);
setMessage("System reset.");
}

function runForm() {
if (charge < FORM_COST) {
setMessage("Need more bank to Form.");
return;
}

const nextSlot = getFirstEmptySlot(orbs, unlockedSlots);
if (!nextSlot) {
setMessage("No open slot. Scale or Transmit.");
return;
}

const nextOrb = makeOrb(nextSlot, "form");
setCharge((prev) => prev - FORM_COST);
setOrbs((prev) => [...prev, nextOrb]);
setFocusedOrbId(nextOrb.id);
setMode("ambient");
setMessage("New structure formed.");
}

function runScale() {
if (!focusedOrb) {
setMessage("Focus a structure to Scale.");
return;
}
if (charge < SCALE_COST) {
setMessage("Need more bank to Scale.");
return;
}

setCharge((prev) => prev - SCALE_COST);
setOrbs((prev) =>
prev.map((orb) =>
orb.id === focusedOrb.id
? {
...orb,
type: "scale",
level: orb.level + 1,
integrity: Math.min(100, orb.integrity + 18),
capacity: orb.capacity + 35,
baseSize: Math.min(76, orb.baseSize + 6),
}
: orb
)
);
setMessage("Focused structure scaled and reinforced.");
}

function runTransmit() {
if (!focusedOrb) {
setMessage("Focus a structure to Transmit.");
return;
}
if (charge < TRANSMIT_COST) {
setMessage("Need more bank to Transmit.");
return;
}

setCharge((prev) => prev - TRANSMIT_COST);
setOrbs((prev) =>
prev.map((orb) =>
orb.id === focusedOrb.id
? {
...orb,
type: "transmit",
transmitting: true,
integrity: Math.min(100, orb.integrity + 10),
}
: orb
)
);
setScore((prev) => prev + 40);
setMessage("Focused structure transmitted.");

window.setTimeout(() => {
setOrbs((prev) =>
prev.map((orb) =>
orb.id === focusedOrb.id ? { ...orb, transmitting: false } : orb
)
);
}, 1300);
}

const canForm = charge >= FORM_COST && !!getFirstEmptySlot(orbs, unlockedSlots);
const canScale = charge >= SCALE_COST && !!focusedOrb;
const canTransmit = charge >= TRANSMIT_COST && !!focusedOrb;

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-4 py-4">
<div className="mb-4 flex items-center justify-between">
<div className="text-3xl font-semibold tracking-tight">Pyron</div>

<div className="flex items-center gap-2">
<button
onClick={toggleLive}
className={`rounded-full border px-4 py-2 text-sm tracking-[0.2em] ${
liveState === "LIVE"
? "border-white/15 bg-white/[0.10] text-white"
: "border-white/10 bg-white/[0.04] text-white/70"
}`}
>
{liveState}
</button>

<button
onClick={resetSystem}
className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-white/70"
aria-label="Reset"
>
<RotateCcw className="h-4 w-4" />
</button>

<div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm tracking-[0.2em] text-white/60">
{stage}
</div>

<div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm">
{charge}
</div>
</div>
</div>

<div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#03050a]">
<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(101,255,237,0.10),rgba(0,0,0,0)_28%,rgba(0,0,0,0.96)_72%)]" />
<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),rgba(0,0,0,0)_34%)]" />

<div className="relative z-10 px-4 pt-4">
<div className="mb-3 flex items-center justify-between gap-3">
<button
onClick={() => setMode((m) => (m === "ambient" ? "build" : "ambient"))}
className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.22em] text-white/70"
>
{mode === "ambient" ? "Build" : "Hide Grid"}
</button>

<div className="flex items-center gap-2">
<SensitivityPill
active={sensitivity === "Low"}
onClick={() => setSensitivity("Low")}
label="Low"
/>
<SensitivityPill
active={sensitivity === "Medium"}
onClick={() => setSensitivity("Medium")}
label="Medium"
/>
<SensitivityPill
active={sensitivity === "High"}
onClick={() => setSensitivity("High")}
label="High"
/>
<SensitivityPill
active={sensitivity === "Raw"}
onClick={() => setSensitivity("Raw")}
label="Raw"
/>
</div>
</div>
</div>

<div className="relative z-10 mx-auto aspect-square max-w-[760px] overflow-hidden">
{[1, 2].map((ring) => {
const size = ring === 1 ? 304 : 452;
const opacity = ring === 1 ? 0.22 : 0.12;
return (
<motion.div
key={ring}
className="absolute left-1/2 top-1/2 rounded-full border border-cyan-200/15"
style={{
width: size,
height: size,
transform: "translate(-50%, -50%) scaleY(0.82)",
filter: `blur(${ring === 2 ? 0.6 : 0}px)`,
}}
animate={{
opacity:
liveState === "LIVE"
? [opacity * 0.7, opacity, opacity * 0.7]
: opacity * 0.5,
scale: liveState === "LIVE" ? [1, 1.01, 1] : 1,
}}
transition={{
duration: 5 + ring,
repeat: Infinity,
ease: "easeInOut",
}}
/>
);
})}

{SLOTS.filter((slot) => unlockedSlots.includes(slot.id)).map((slot) => {
const orb = orbs.find((o) => o.slotId === slot.id);
const focused = orb?.id === focusedOrbId;
const showSlot = mode === "build" || !!orb;

return (
<React.Fragment key={slot.id}>
{showSlot && !orb && (
<motion.button
className="absolute left-1/2 top-1/2 z-5 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/[0.03]"
style={{
marginLeft: slot.x,
marginTop: slot.y,
filter: "blur(0.2px)",
}}
animate={{
opacity: [0.16, 0.46, 0.16],
scale: [1, 1.18, 1],
}}
transition={{
duration: 2.4,
repeat: Infinity,
ease: "easeInOut",
}}
onClick={() => {
if (mode !== "build" || !canForm) return;
const nextOrb = makeOrb(slot.id, "form");
setCharge((prev) => prev - FORM_COST);
setOrbs((prev) => [...prev, nextOrb]);
setFocusedOrbId(nextOrb.id);
setMode("ambient");
setMessage("New structure formed.");
}}
/>
)}

{orb && (
<StarNode
orb={orb}
slot={slot}
focused={focused}
tick={tick}
onClick={() => {
setFocusedOrbId(orb.id);
setMode("ambient");
setMessage(`${getOrbLabel(orb.type)} structure focused.`);
}}
/>
)}
</React.Fragment>
);
})}

<motion.div
className="absolute left-1/2 top-1/2 z-20 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100/15 bg-[radial-gradient(circle_at_35%_30%,rgba(240,255,255,0.9),rgba(137,255,239,0.92)_28%,rgba(22,78,88,0.85)_66%,rgba(8,20,30,0.9)_100%)] shadow-[0_0_120px_rgba(89,255,233,0.20)]"
animate={{
y: liveState === "LIVE" ? [0, -10, 0, 7, 0] : [0, -2, 0],
x: liveState === "LIVE" ? [0, 5, 0, -5, 0] : [0, 1, 0],
scale:
liveState === "LIVE"
? [1, 1 + Math.min(0.05, liveEnergy / 2200), 1]
: 1,
opacity:
liveState === "LIVE"
? [0.92, Math.min(1, 0.88 + liveEnergy / 180), 0.92]
: 0.82,
}}
transition={{
duration: liveState === "LIVE" ? 7.5 : 5,
repeat: Infinity,
ease: "easeInOut",
}}
>
<motion.div
className="absolute inset-[-16px] rounded-full border border-cyan-100/12"
animate={{ scale: [1, 1.06, 1], opacity: [0.22, 0.08, 0.22] }}
transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
/>
<motion.div
className="absolute inset-[-34px] rounded-full border border-cyan-100/8"
animate={{ scale: [1, 1.08, 1], opacity: [0.12, 0.04, 0.12] }}
transition={{ duration: 5.4, repeat: Infinity, ease: "easeInOut" }}
/>

<div className="pt-12 text-center text-[10px] uppercase tracking-[0.3em] text-white/40">
Pyron
</div>
<div className="mt-3 text-center text-4xl font-semibold text-white">
{liveState}
</div>
<div className="mt-1 text-center text-lg text-white/75">
{Math.round(liveEnergy)} energy
</div>

<div className="mx-auto mt-4 h-2.5 w-32 overflow-hidden rounded-full bg-white/12">
<div
className="h-full rounded-full bg-white/80"
style={{ width: `${Math.max(0, Math.min(100, integrityAvg))}%` }}
/>
</div>

{pattern && (
<div className="mx-auto mt-4 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/80">
{pattern.name} +{pattern.bonus}
</div>
)}
</motion.div>

{focusedOrb && <FocusHalo orb={focusedOrb} tick={tick} />}

<ActionOrb
label="Form"
cost={FORM_COST}
x={0}
y={-232}
enabled={canForm}
onClick={runForm}
/>
<ActionOrb
label="Scale"
cost={SCALE_COST}
x={-208}
y={174}
enabled={canScale}
onClick={runScale}
/>
<ActionOrb
label="Transmit"
cost={TRANSMIT_COST}
x={208}
y={174}
enabled={canTransmit}
onClick={runTransmit}
/>

{focusedOrb?.transmitting && (
<motion.div
className="absolute left-1/2 top-1/2 z-15 rounded-full border border-cyan-100/20"
style={{
width: 240,
height: 240,
transform: "translate(-50%, -50%) scaleY(0.82)",
}}
animate={{ scale: [1, 3.4, 4.4], opacity: [0.78, 0.18, 0] }}
transition={{ duration: 1.1, ease: "easeOut" }}
/>
)}
</div>

<div className="relative z-10 border-t border-white/10 px-4 py-4">
<div className="grid gap-3 md:grid-cols-5">
<MiniStat label="Goal" value="Maintain structure" />
<MiniStat label="Form" value={stateRead.form} />
<MiniStat label="Signal" value={stateRead.signal} />
<MiniStat label="Energy" value={stateRead.energy} />
<MiniStat label="Time" value={formatTime(elapsedSeconds)} />
<MiniStat label="Windows" value={String(windowsCount)} />
<MiniStat label="Transitions" value={String(transitions)} />
<MiniStat label="Session Charge" value={`+${sessionCharge}`} />
<MiniStat label="Integrity" value={`${Math.round(integrityAvg)}%`} />
<MiniStat label="Score" value={String(score)} />
</div>

{focusedOrb && (
<div className="mt-4 grid gap-3 md:grid-cols-3">
<MiniStat label="Focus" value={getOrbLabel(focusedOrb.type)} />
<MiniStat
label="Load"
value={`${Math.round(focusedOrb.load)}/${focusedOrb.capacity}`}
/>
<MiniStat
label="Node Integrity"
value={`${Math.round(focusedOrb.integrity)}%`}
/>
</div>
)}

<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
<div className="text-sm text-white/68">{message}</div>

<div className="flex items-center gap-3 text-sm text-white/55">
<span>{sensitivity}</span>
<span>{orbs.length}/{unlockedSlots.length}</span>
<span>{stage}</span>
</div>
</div>

<div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
<div
className="h-full rounded-full bg-white/70"
style={{ width: `${progress}%` }}
/>
</div>
</div>
</div>
</div>
</div>
);
}

function SensitivityPill({
label,
active,
onClick,
}: {
label: string;
active: boolean;
onClick: () => void;
}) {
return (
<button
onClick={onClick}
className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] ${
active
? "border-white/15 bg-white/[0.10] text-white"
: "border-white/10 bg-white/[0.04] text-white/50"
}`}
>
{label}
</button>
);
}

function StarNode({
orb,
slot,
focused,
tick,
onClick,
}: {
orb: Orb;
slot: Slot;
focused: boolean;
tick: number;
onClick: () => void;
}) {
const Icon = getOrbIcon(orb.type);
const pos = slotRenderPosition(slot, orb, tick);
const visual = orbVisuals(orb);

return (
<>
<motion.div
className="absolute left-1/2 top-1/2 z-5 h-px origin-left bg-cyan-100/12"
style={{
width: Math.sqrt(pos.x * pos.x + pos.y * pos.y),
transform: `translate(0, 0) rotate(${Math.atan2(pos.y, pos.x)}rad)`,
filter: orb.depth < -0.25 ? "blur(0.4px)" : "none",
}}
animate={{
opacity: focused ? [0.16, 0.4, 0.16] : [0.05, 0.12, 0.05],
}}
transition={{
duration: focused ? 1.8 : 3.2,
repeat: Infinity,
ease: "easeInOut",
}}
/>

<motion.button
className={`absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-white ${
focused
? "border-white/22 bg-white/[0.15]"
: "border-white/12 bg-white/[0.07]"
}`}
style={{
width: visual.size,
height: visual.size,
marginLeft: pos.x,
marginTop: pos.y,
opacity: visual.opacity,
filter: `blur(${visual.blur}px) drop-shadow(0 0 ${visual.glow}px rgba(125,255,240,0.28))`,
boxShadow: `0 0 ${visual.glow}px rgba(125,255,240,0.18)`,
}}
animate={{
scale: focused ? [1, 1.06, 1] : [1, 1.02, 1],
opacity:
orb.integrity < 40
? [visual.opacity, visual.opacity * 0.6, visual.opacity]
: orb.transmitting
? [visual.opacity * 0.72, visual.opacity, visual.opacity * 0.72]
: visual.opacity,
}}
transition={{
duration: focused ? 1.8 : 3.8,
repeat: Infinity,
ease: "easeInOut",
}}
onClick={onClick}
>
<Icon className="h-4 w-4" />
</motion.button>
</>
);
}

function FocusHalo({ orb, tick }: { orb: Orb; tick: number }) {
const slot = findSlot(orb.slotId);
const pos = slotRenderPosition(slot, orb, tick);
const visual = orbVisuals(orb);

return (
<motion.div
className="absolute left-1/2 top-1/2 z-9 rounded-full border border-white/24"
style={{
width: visual.size + 18,
height: visual.size + 18,
marginLeft: pos.x,
marginTop: pos.y,
transform: "translate(-50%, -50%)",
}}
animate={{
scale: [1, 1.08, 1],
opacity: [0.22, 0.72, 0.22],
}}
transition={{
duration: 1.8,
repeat: Infinity,
ease: "easeInOut",
}}
/>
);
}

function ActionOrb({
label,
cost,
x,
y,
enabled,
onClick,
}: {
label: string;
cost: number;
x: number;
y: number;
enabled: boolean;
onClick: () => void;
}) {
return (
<motion.button
className={`absolute left-1/2 top-1/2 z-20 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border backdrop-blur-xl ${
enabled
? "border-white/14 bg-white/[0.06] text-white"
: "border-white/8 bg-white/[0.02] text-white/30"
}`}
style={{ marginLeft: x, marginTop: y }}
animate={{
scale: enabled ? [1, 1.03, 1] : 1,
opacity: enabled ? [0.82, 1, 0.82] : 0.45,
}}
transition={{
duration: 2.4,
repeat: Infinity,
ease: "easeInOut",
}}
onClick={onClick}
disabled={!enabled}
>
<span className="text-[11px] uppercase tracking-[0.18em]">{label}</span>
<span className="mt-1 text-xl font-semibold">{cost}</span>
</motion.button>
);
}

function MiniStat({ label, value }: { label: string; value: string }) {
return (
<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
{label}
</div>
<div className="mt-1 text-sm font-semibold text-white/85">{value}</div>
</div>
);
}