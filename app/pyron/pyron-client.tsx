"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CircleDot, Send, Sparkles, RotateCcw } from "lucide-react";

type LiveState = "OFF" | "LIVE";
type Sensitivity = "Low" | "Medium" | "High" | "Raw";
type OrbType = "form" | "scale" | "transmit";
type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type Mode = "ambient" | "place";

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
size: number;
transmitting: boolean;
integrity: number;
capacity: number;
load: number;
};

type Pattern = {
name: string;
bonus: number;
};

const CHARGE_KEY = "axis_pyron_charge_v6";
const LIVE_KEY = "axis_pyron_live_v6";
const ENERGY_KEY = "axis_pyron_energy_v6";
const SENSITIVITY_KEY = "axis_pyron_sensitivity_v6";
const ORBS_KEY = "axis_pyron_orbs_v6";
const FOCUS_KEY = "axis_pyron_focus_v6";
const MODE_KEY = "axis_pyron_mode_v6";
const WINDOWS_KEY = "axis_pyron_windows_v6";
const TRANSITIONS_KEY = "axis_pyron_transitions_v6";
const SESSION_CHARGE_KEY = "axis_pyron_session_charge_v6";
const ELAPSED_KEY = "axis_pyron_elapsed_v6";
const SCORE_KEY = "axis_pyron_score_v6";

const FORM_COST = 45;
const SCALE_COST = 60;
const TRANSMIT_COST = 100;

const SLOTS: Slot[] = [
{ id: "n", x: 0, y: -120, ring: 1 },
{ id: "ne", x: 104, y: -60, ring: 1 },
{ id: "se", x: 104, y: 60, ring: 1 },
{ id: "s", x: 0, y: 120, ring: 1 },
{ id: "sw", x: -104, y: 60, ring: 1 },
{ id: "nw", x: -104, y: -60, ring: 1 },

{ id: "n2", x: 0, y: -198, ring: 2 },
{ id: "e2", x: 172, y: 0, ring: 2 },
{ id: "s2", x: 0, y: 198, ring: 2 },
{ id: "w2", x: -172, y: 0, ring: 2 },
{ id: "ne2", x: 146, y: -112, ring: 2 },
{ id: "sw2", x: -146, y: 112, ring: 2 },
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

function getDefaultOrbs(): Orb[] {
return [
{
id: "orb-n",
slotId: "n",
type: "form",
level: 1,
size: 52,
transmitting: false,
integrity: 100,
capacity: 120,
load: 18,
},
{
id: "orb-sw",
slotId: "sw",
type: "scale",
level: 1,
size: 52,
transmitting: false,
integrity: 100,
capacity: 120,
load: 16,
},
{
id: "orb-se",
slotId: "se",
type: "transmit",
level: 1,
size: 52,
transmitting: false,
integrity: 100,
capacity: 120,
load: 20,
},
];
}

function safeParseOrbs(raw: string | null): Orb[] {
if (!raw) return getDefaultOrbs();
try {
const parsed = JSON.parse(raw) as Orb[];
if (!Array.isArray(parsed) || parsed.length === 0) return getDefaultOrbs();
return parsed;
} catch {
return getDefaultOrbs();
}
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
const next = orbs.map((orb) => {
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

return next;
}

function applyDecay(orbs: Orb[], elapsedSeconds: number, liveEnergy: number, pattern: Pattern | null) {
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

export default function PyronClient() {
const [charge, setCharge] = useState(149);
const [liveState, setLiveState] = useState<LiveState>("OFF");
const [liveEnergy, setLiveEnergy] = useState(18);
const [sensitivity, setSensitivity] = useState<Sensitivity>("Medium");
const [orbs, setOrbs] = useState<Orb[]>(getDefaultOrbs());
const [focusedOrbId, setFocusedOrbId] = useState<string | null>("orb-n");
const [mode, setMode] = useState<Mode>("ambient");
const [message, setMessage] = useState("Focus a structure and shape the field.");
const [windowsCount, setWindowsCount] = useState(0);
const [transitions, setTransitions] = useState(0);
const [sessionCharge, setSessionCharge] = useState(0);
const [elapsedSeconds, setElapsedSeconds] = useState(0);
const [score, setScore] = useState(0);

const prevEnergyRef = useRef(18);

useEffect(() => {
if (typeof window === "undefined") return;

const savedCharge = Number(window.localStorage.getItem(CHARGE_KEY) ?? 149);
const savedLive =
(window.localStorage.getItem(LIVE_KEY) as LiveState | null) ?? "OFF";
const savedEnergy = Number(window.localStorage.getItem(ENERGY_KEY) ?? 18);
const savedSensitivity =
(window.localStorage.getItem(SENSITIVITY_KEY) as Sensitivity | null) ??
"Medium";
const savedOrbs = safeParseOrbs(window.localStorage.getItem(ORBS_KEY));
const savedFocus = window.localStorage.getItem(FOCUS_KEY);
const savedMode =
(window.localStorage.getItem(MODE_KEY) as Mode | null) ?? "ambient";
const savedWindows = Number(window.localStorage.getItem(WINDOWS_KEY) ?? 0);
const savedTransitions = Number(
window.localStorage.getItem(TRANSITIONS_KEY) ?? 0
);
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
if (savedMode === "ambient" || savedMode === "place") setMode(savedMode);
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

if (delta > 10) {
setTransitions((prev) => prev + 1);
}

if (nextEnergy > 58 && prevEnergy <= 58) {
setWindowsCount((prev) => prev + 1);
}
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
setMessage("A structure collapsed under load.");
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
setCharge(149);
setLiveState("OFF");
setLiveEnergy(18);
prevEnergyRef.current = 18;
setSensitivity("Medium");
setOrbs(getDefaultOrbs());
setFocusedOrbId("orb-n");
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

const nextOrb: Orb = {
id: `orb-${nextSlot}-${Date.now()}`,
slotId: nextSlot,
type: "form",
level: 1,
size: 52,
transmitting: false,
integrity: 100,
capacity: 120,
load: 0,
};

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
size: Math.min(92, orb.size + 10),
integrity: Math.min(100, orb.integrity + 18),
capacity: orb.capacity + 35,
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

<div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03]">
<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.10),rgba(255,255,255,0.02)_30%,rgba(0,0,0,0.96)_72%)]" />

<div className="relative z-10 px-4 pt-4">
<div className="mb-3 flex items-center justify-between gap-3">
<div className="flex items-center gap-2">
<button
onClick={() => setMode((m) => (m === "ambient" ? "place" : "ambient"))}
className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.22em] text-white/70"
>
{mode === "ambient" ? "Build" : "Hide Grid"}
</button>
</div>

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
const size = ring === 1 ? 300 : 450;
const show =
mode === "place" ||
SLOTS.some(
(slot) =>
slot.ring === ring &&
unlockedSlots.includes(slot.id) &&
orbs.some((o) => o.slotId === slot.id)
);

return (
<motion.div
key={ring}
className="absolute left-1/2 top-1/2 rounded-full border border-white/10"
style={{
width: size,
height: size,
transform: "translate(-50%, -50%)",
}}
animate={{
opacity:
liveState === "LIVE" && show
? [0.06, 0.16, 0.06]
: show
? 0.08
: 0.02,
scale: liveState === "LIVE" ? [1, 1.01, 1] : 1,
}}
transition={{
duration: 4.5 + ring,
repeat: Infinity,
ease: "easeInOut",
}}
/>
);
})}

{SLOTS.filter((slot) => unlockedSlots.includes(slot.id)).map((slot) => {
const orb = orbs.find((o) => o.slotId === slot.id);
const focused = orb?.id === focusedOrbId;
const showSlot = mode === "place" || !!orb;

return (
<React.Fragment key={slot.id}>
{showSlot && (
<motion.div
className="absolute left-1/2 top-1/2 z-5 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/12"
style={{
marginLeft: slot.x,
marginTop: slot.y,
background: orb ? "transparent" : "rgba(255,255,255,0.03)",
}}
animate={{
opacity: mode === "place" && !orb ? [0.18, 0.5, 0.18] : 0.14,
scale: mode === "place" && !orb ? [1, 1.18, 1] : 1,
}}
transition={{
duration: 2.4,
repeat: Infinity,
ease: "easeInOut",
}}
/>
)}

{orb && (
<>
<motion.div
className="absolute left-1/2 top-1/2 z-5 h-px origin-left bg-white/15"
style={{
width: Math.sqrt(slot.x * slot.x + slot.y * slot.y),
transform: `translate(0, 0) rotate(${Math.atan2(
slot.y,
slot.x
)}rad)`,
}}
animate={{
opacity: focused ? [0.14, 0.48, 0.14] : [0.06, 0.14, 0.06],
}}
transition={{
duration: focused ? 1.8 : 3.2,
repeat: Infinity,
ease: "easeInOut",
}}
/>

<OrbNode
orb={orb}
slot={slot}
focused={focused}
onClick={() => {
setFocusedOrbId(orb.id);
setMessage(`${getOrbLabel(orb.type)} structure focused.`);
setMode("ambient");
}}
/>
</>
)}
</React.Fragment>
);
})}

<motion.div
className="absolute left-1/2 top-1/2 z-20 h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-white/[0.08] text-center shadow-[0_0_120px_rgba(255,255,255,0.12)] backdrop-blur-xl"
animate={{
y: liveState === "LIVE" ? [0, -10, 0, 7, 0] : [0, -2, 0],
x: liveState === "LIVE" ? [0, 5, 0, -5, 0] : [0, 1, 0],
scale:
liveState === "LIVE"
? [1, 1 + Math.min(0.05, liveEnergy / 2200), 1]
: 1,
opacity:
liveState === "LIVE"
? [0.9, Math.min(1, 0.86 + liveEnergy / 180), 0.9]
: 0.8,
}}
transition={{
duration: liveState === "LIVE" ? 7.5 : 5,
repeat: Infinity,
ease: "easeInOut",
}}
>
<div className="pt-11 text-[10px] uppercase tracking-[0.3em] text-white/40">
Pyron
</div>
<div className="mt-3 text-3xl font-semibold">{liveState}</div>
<div className="mt-1 text-base text-white/65">
{Math.round(liveEnergy)} energy
</div>

<div className="mx-auto mt-3 h-2 w-28 overflow-hidden rounded-full bg-white/10">
<div
className="h-full bg-white/70"
style={{ width: `${Math.max(0, Math.min(100, integrityAvg))}%` }}
/>
</div>

{pattern && (
<div className="mx-auto mt-4 inline-flex rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/70">
{pattern.name} +{pattern.bonus}
</div>
)}
</motion.div>

{focusedOrb && <FocusHalo orb={focusedOrb} />}

<ActionOrb
label="Form"
cost={FORM_COST}
x={0}
y={-226}
enabled={canForm}
onClick={runForm}
/>
<ActionOrb
label="Scale"
cost={SCALE_COST}
x={-198}
y={164}
enabled={canScale}
onClick={runScale}
/>
<ActionOrb
label="Transmit"
cost={TRANSMIT_COST}
x={198}
y={164}
enabled={canTransmit}
onClick={runTransmit}
/>

{focusedOrb?.transmitting && (
<motion.div
className="absolute left-1/2 top-1/2 z-15 rounded-full border border-white/20"
style={{
width: 220,
height: 220,
transform: "translate(-50%, -50%)",
}}
animate={{ scale: [1, 3.2, 4.2], opacity: [0.75, 0.18, 0] }}
transition={{ duration: 1.1, ease: "easeOut" }}
/>
)}
</div>

<div className="relative z-10 border-t border-white/10 px-4 py-4">
<div className="grid gap-3 md:grid-cols-5">
<MiniStat label="Form" value={stateRead.form} />
<MiniStat label="Signal" value={stateRead.signal} />
<MiniStat label="Energy" value={stateRead.energy} />
<MiniStat label="Time" value={formatTime(elapsedSeconds)} />
<MiniStat label="Score" value={String(score)} />
<MiniStat label="Transitions" value={String(transitions)} />
<MiniStat label="Windows" value={String(windowsCount)} />
<MiniStat label="Session Charge" value={`+${sessionCharge}`} />
<MiniStat label="Integrity" value={`${Math.round(integrityAvg)}`} />
<MiniStat label="Bank" value={`${charge}/${nextThreshold}`} />
</div>

{focusedOrb && (
<div className="mt-4 grid gap-3 md:grid-cols-3">
<MiniStat label="Focus" value={getOrbLabel(focusedOrb.type)} />
<MiniStat label="Load" value={`${Math.round(focusedOrb.load)}/${focusedOrb.capacity}`} />
<MiniStat label="Integrity" value={`${Math.round(focusedOrb.integrity)}%`} />
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
className="h-full bg-white/65"
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

function OrbNode({
orb,
slot,
focused,
onClick,
}: {
orb: Orb;
slot: Slot;
focused: boolean;
onClick: () => void;
}) {
const Icon = getOrbIcon(orb.type);

const integrityOpacity =
orb.integrity > 70 ? 1 : orb.integrity > 40 ? 0.78 : 0.5;

return (
<motion.button
className={`absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-white backdrop-blur-xl ${
focused
? "border-white/18 bg-white/[0.14] shadow-[0_0_50px_rgba(255,255,255,0.14)]"
: "border-white/12 bg-white/[0.07]"
}`}
style={{
width: orb.size,
height: orb.size,
marginLeft: slot.x,
marginTop: slot.y,
opacity: integrityOpacity,
}}
animate={{
scale: focused ? [1, 1.05, 1] : [1, 1.015, 1],
opacity:
orb.integrity < 40
? [integrityOpacity, integrityOpacity * 0.65, integrityOpacity]
: orb.transmitting
? [integrityOpacity * 0.75, integrityOpacity, integrityOpacity * 0.75]
: integrityOpacity,
}}
transition={{
duration: focused ? 1.8 : 3.6,
repeat: Infinity,
ease: "easeInOut",
}}
onClick={onClick}
>
<Icon className="h-4 w-4" />
</motion.button>
);
}

function FocusHalo({ orb }: { orb: Orb }) {
const slot = findSlot(orb.slotId);

return (
<motion.div
className="absolute left-1/2 top-1/2 z-9 rounded-full border border-white/22"
style={{
width: orb.size + 18,
height: orb.size + 18,
marginLeft: slot.x - (orb.size + 18) / 2,
marginTop: slot.y - (orb.size + 18) / 2,
}}
animate={{
scale: [1, 1.08, 1],
opacity: [0.22, 0.7, 0.22],
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