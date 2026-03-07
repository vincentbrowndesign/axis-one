"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
CircleDot,
Cpu,
Orbit,
Send,
Sparkles,
ChevronUp,
ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type LiveState = "OFF" | "LIVE";
type SlotId =
| "n"
| "ne"
| "e"
| "se"
| "s"
| "sw"
| "w"
| "nw"
| "n2"
| "e2"
| "s2"
| "w2";
type OrbType = "form" | "scale" | "transmit";
type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";

type Orb = {
id: string;
slotId: SlotId;
type: OrbType;
level: number;
size: number;
transmitting: boolean;
};

type Slot = {
id: SlotId;
x: number;
y: number;
ring: 1 | 2;
};

type Pattern = {
name: string;
bonus: number;
};

const CHARGE_KEY = "axis_pyron_charge_v3";
const LIVE_KEY = "axis_pyron_live_v3";
const ENERGY_KEY = "axis_pyron_energy_v3";
const SENSITIVITY_KEY = "axis_pyron_sensitivity_v3";
const ORBS_KEY = "axis_pyron_orbs_v3";
const FOCUS_KEY = "axis_pyron_focus_v3";
const DRAWER_KEY = "axis_pyron_drawer_v3";

const FORM_COST = 45;
const SCALE_COST = 60;
const TRANSMIT_COST = 100;

const SLOTS: Slot[] = [
{ id: "n", x: 0, y: -108, ring: 1 },
{ id: "ne", x: 76, y: -76, ring: 1 },
{ id: "e", x: 108, y: 0, ring: 1 },
{ id: "se", x: 76, y: 76, ring: 1 },
{ id: "s", x: 0, y: 108, ring: 1 },
{ id: "sw", x: -76, y: 76, ring: 1 },
{ id: "w", x: -108, y: 0, ring: 1 },
{ id: "nw", x: -76, y: -76, ring: 1 },
{ id: "n2", x: 0, y: -180, ring: 2 },
{ id: "e2", x: 180, y: 0, ring: 2 },
{ id: "s2", x: 0, y: 180, ring: 2 },
{ id: "w2", x: -180, y: 0, ring: 2 },
];

const SLOT_ORDER: SlotId[] = [
"n",
"ne",
"e",
"se",
"s",
"sw",
"w",
"nw",
"n2",
"e2",
"s2",
"w2",
];

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

function getSensitivityLabel(value: number) {
if (value <= 25) return "Low";
if (value <= 50) return "Medium";
if (value <= 75) return "High";
return "Raw";
}

function getEnergyMultiplier(value: number) {
if (value <= 25) return 0.35;
if (value <= 50) return 0.7;
if (value <= 75) return 1;
return 1.35;
}

function getUnlockedSlotIds(charge: number): SlotId[] {
if (charge < 50) return ["n", "e", "w"];
if (charge < 150) return ["n", "ne", "e", "s", "sw", "w"];
if (charge < 400) return ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
return SLOT_ORDER;
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
size: 48,
transmitting: false,
},
{
id: "orb-e",
slotId: "e",
type: "scale",
level: 1,
size: 48,
transmitting: false,
},
{
id: "orb-w",
slotId: "w",
type: "transmit",
level: 1,
size: 48,
transmitting: false,
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

function getFirstEmptySlot(orbs: Orb[], unlocked: SlotId[]): SlotId | null {
const used = new Set(orbs.map((o) => o.slotId));
for (const slotId of SLOT_ORDER) {
if (unlocked.includes(slotId) && !used.has(slotId)) return slotId;
}
return null;
}

function findSlot(slotId: SlotId) {
return SLOTS.find((s) => s.id === slotId)!;
}

function hasOrb(orbs: Orb[], slotId: SlotId) {
return orbs.some((o) => o.slotId === slotId);
}

function detectPattern(orbs: Orb[]): Pattern | null {
const occupied = new Set(orbs.map((o) => o.slotId));

const triangleSets: SlotId[][] = [
["n", "e", "w"],
["n", "se", "sw"],
["s", "ne", "nw"],
["e", "nw", "sw"],
["w", "ne", "se"],
];

for (const set of triangleSets) {
if (set.every((id) => occupied.has(id))) {
return { name: "Triangle", bonus: 12 };
}
}

const chainSets: SlotId[][] = [
["n2", "n", "s", "s2"],
["w2", "w", "e", "e2"],
["nw", "n", "ne", "e"],
["sw", "s", "se", "e"],
];

for (const set of chainSets) {
if (set.every((id) => occupied.has(id))) {
return { name: "Chain", bonus: 18 };
}
}

const hubCount = ["n", "e", "s", "w"].filter((id) =>
occupied.has(id as SlotId)
).length;

if (hubCount >= 3) {
return { name: "Hub", bonus: 20 };
}

return null;
}

function createAxisLinePath(width: number, height: number, energy: number, live: boolean) {
const points = 28;
const amp = live ? 10 + energy * 0.45 : 4;
const centerY = height / 2;
const step = width / (points - 1);

let d = `M 0 ${centerY}`;

for (let i = 1; i < points; i++) {
const x = i * step;
const y =
centerY +
Math.sin(i * 0.62) * amp * 0.7 +
Math.cos(i * 0.25) * amp * 0.35 +
Math.sin(i * 1.1) * amp * 0.18;
d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
}

return d;
}

export default function PyronClient() {
const [charge, setCharge] = useState(149);
const [liveState, setLiveState] = useState<LiveState>("OFF");
const [liveEnergy, setLiveEnergy] = useState(18);
const [sensitivity, setSensitivity] = useState(50);
const [orbs, setOrbs] = useState<Orb[]>(getDefaultOrbs());
const [focusedOrbId, setFocusedOrbId] = useState<string | null>("orb-n");
const [drawerOpen, setDrawerOpen] = useState(false);
const [message, setMessage] = useState("Focus a structure and shape the field.");

useEffect(() => {
if (typeof window === "undefined") return;

const savedCharge = Number(window.localStorage.getItem(CHARGE_KEY) ?? 149);
const savedLive = (window.localStorage.getItem(LIVE_KEY) as LiveState | null) ?? "OFF";
const savedEnergy = Number(window.localStorage.getItem(ENERGY_KEY) ?? 18);
const savedSensitivity = Number(window.localStorage.getItem(SENSITIVITY_KEY) ?? 50);
const savedOrbs = safeParseOrbs(window.localStorage.getItem(ORBS_KEY));
const savedFocus = window.localStorage.getItem(FOCUS_KEY);
const savedDrawer = window.localStorage.getItem(DRAWER_KEY) === "1";

if (!Number.isNaN(savedCharge)) setCharge(savedCharge);
if (savedLive === "LIVE" || savedLive === "OFF") setLiveState(savedLive);
if (!Number.isNaN(savedEnergy)) setLiveEnergy(savedEnergy);
if (!Number.isNaN(savedSensitivity)) setSensitivity(savedSensitivity);
setOrbs(savedOrbs);
setFocusedOrbId(savedFocus ?? savedOrbs[0]?.id ?? null);
setDrawerOpen(savedDrawer);
}, []);

useEffect(() => {
if (typeof window === "undefined") return;
window.localStorage.setItem(CHARGE_KEY, String(charge));
window.localStorage.setItem(LIVE_KEY, liveState);
window.localStorage.setItem(ENERGY_KEY, String(liveEnergy));
window.localStorage.setItem(SENSITIVITY_KEY, String(sensitivity));
window.localStorage.setItem(ORBS_KEY, JSON.stringify(orbs));
if (focusedOrbId) window.localStorage.setItem(FOCUS_KEY, focusedOrbId);
window.localStorage.setItem(DRAWER_KEY, drawerOpen ? "1" : "0");
}, [charge, liveState, liveEnergy, sensitivity, orbs, focusedOrbId, drawerOpen]);

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

setLiveEnergy(Number(nextEnergy.toFixed(1)));

const gain = Math.max(
0,
Math.round((nextEnergy / 25) * getEnergyMultiplier(sensitivity))
);

if (gain > 0) {
setCharge((prev) => prev + gain);
}
}, 1400);

return () => window.clearInterval(interval);
}, [liveState, liveEnergy, sensitivity]);

const stage = useMemo(() => getStage(charge), [charge]);
const nextThreshold = useMemo(() => getNextThreshold(stage), [stage]);
const stageMin = useMemo(() => getStageMin(stage), [stage]);
const progress = useMemo(() => {
const span = nextThreshold - stageMin;
if (span <= 0) return 100;
return Math.max(0, Math.min(100, ((charge - stageMin) / span) * 100));
}, [charge, nextThreshold, stageMin]);

const unlockedSlots = useMemo(() => getUnlockedSlotIds(charge), [charge]);
const focusedOrb = useMemo(
() => orbs.find((orb) => orb.id === focusedOrbId) ?? null,
[orbs, focusedOrbId]
);
const pattern = useMemo(() => detectPattern(orbs), [orbs]);

function toggleLive() {
setLiveState((prev) => {
const next = prev === "LIVE" ? "OFF" : "LIVE";
setMessage(next === "LIVE" ? "Pyron is LIVE." : "Pyron is OFF.");
return next;
});
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
size: 48,
transmitting: false,
};

setCharge((prev) => prev - FORM_COST);
setOrbs((prev) => [...prev, nextOrb]);
setFocusedOrbId(nextOrb.id);
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
size: Math.min(84, orb.size + 10),
}
: orb
)
);
setMessage("Focused structure scaled.");
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
? { ...orb, type: "transmit", transmitting: true }
: orb
)
);
setMessage("Focused structure transmitted.");

window.setTimeout(() => {
setOrbs((prev) =>
prev.map((orb) =>
orb.id === focusedOrb.id ? { ...orb, transmitting: false } : orb
)
);
}, 1300);
}

const axisPath = useMemo(
() => createAxisLinePath(700, 260, liveEnergy, liveState === "LIVE"),
[liveEnergy, liveState]
);

const sensitivityLabel = getSensitivityLabel(sensitivity);

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-6xl px-4 py-4">
<div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03]">
<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_28%,rgba(0,0,0,0.96)_72%)]" />

<div className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6">
<div className="flex items-center gap-3">
<button
onClick={toggleLive}
className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-white/80"
>
{liveState}
</button>

<div className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-white/65">
{stage}
</div>
</div>

<div className="text-right">
<div className="text-[10px] uppercase tracking-[0.24em] text-white/45">
Bank
</div>
<div className="text-xl font-semibold">{charge}</div>
</div>
</div>

<div className="relative z-10 px-2 pb-2 sm:px-4 sm:pb-4">
<div className="relative mx-auto aspect-square max-w-[760px] overflow-hidden rounded-[1.75rem]">
<svg
viewBox="0 0 700 260"
className="absolute left-1/2 top-1/2 z-0 h-[52%] w-[92%] -translate-x-1/2 -translate-y-1/2 opacity-30 blur-[0.2px]"
aria-hidden="true"
>
<path
d={axisPath}
fill="none"
stroke="rgba(255,255,255,0.22)"
strokeWidth="2.2"
strokeLinecap="round"
strokeLinejoin="round"
/>
<path
d={axisPath}
fill="none"
stroke="rgba(255,255,255,0.08)"
strokeWidth="10"
strokeLinecap="round"
strokeLinejoin="round"
/>
</svg>

{[1, 2].map((ring) => {
const size = ring === 1 ? 280 : 420;
const unlocked =
ring === 1 ? unlockedSlots.some((id) => findSlot(id).ring === 1) : unlockedSlots.some((id) => findSlot(id).ring === 2);

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
liveState === "LIVE" && unlocked
? [0.1, 0.22, 0.1]
: 0.08,
scale: liveState === "LIVE" ? [1, 1.01, 1] : 1,
}}
transition={{
duration: 4 + ring,
repeat: Infinity,
ease: "easeInOut",
}}
/>
);
})}

{SLOTS.filter((slot) => unlockedSlots.includes(slot.id)).map((slot) => {
const orb = orbs.find((o) => o.slotId === slot.id);
const focused = orb?.id === focusedOrbId;

return (
<React.Fragment key={slot.id}>
{!orb && (
<div
className="absolute left-1/2 top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-white/[0.05]"
style={{
marginLeft: slot.x,
marginTop: slot.y,
}}
/>
)}

{orb && (
<>
<motion.div
className="absolute left-1/2 top-1/2 z-5 h-px origin-left bg-white/18"
style={{
width: Math.sqrt(slot.x * slot.x + slot.y * slot.y),
transform: `translate(0, 0) rotate(${Math.atan2(
slot.y,
slot.x
)}rad)`,
}}
animate={{
opacity: focused ? [0.16, 0.55, 0.16] : [0.08, 0.18, 0.08],
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
}}
/>
</>
)}
</React.Fragment>
);
})}

<motion.div
className="absolute left-1/2 top-1/2 z-20 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-white/[0.09] text-center shadow-[0_0_90px_rgba(255,255,255,0.12)] backdrop-blur-xl"
animate={{
scale: liveState === "LIVE" ? [1, 1.04, 1] : 1,
opacity: liveState === "LIVE" ? [0.92, 1, 0.92] : 0.8,
}}
transition={{
duration: 3,
repeat: Infinity,
ease: "easeInOut",
}}
>
<div className="pt-8 text-[10px] uppercase tracking-[0.3em] text-white/45">
Pyron
</div>
<div className="mt-3 text-2xl font-semibold">{liveState}</div>
<div className="mt-1 text-sm text-white/55">{Math.round(liveEnergy)} energy</div>

{pattern && (
<div className="mx-auto mt-4 inline-flex rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/70">
{pattern.name} +{pattern.bonus}
</div>
)}
</motion.div>

{focusedOrb && (
<>
<FocusHalo orb={focusedOrb} />
<ActionNode
label="Form"
cost={FORM_COST}
x={0}
y={-188}
enabled={charge >= FORM_COST && !!getFirstEmptySlot(orbs, unlockedSlots)}
onClick={runForm}
/>
<ActionNode
label="Scale"
cost={SCALE_COST}
x={-170}
y={145}
enabled={charge >= SCALE_COST}
onClick={runScale}
/>
<ActionNode
label="Transmit"
cost={TRANSMIT_COST}
x={170}
y={145}
enabled={charge >= TRANSMIT_COST}
onClick={runTransmit}
/>
</>
)}

{focusedOrb?.transmitting && (
<motion.div
className="absolute left-1/2 top-1/2 z-15 rounded-full border border-white/20"
style={{
width: 180,
height: 180,
transform: "translate(-50%, -50%)",
}}
animate={{ scale: [1, 3.4, 4.2], opacity: [0.7, 0.18, 0] }}
transition={{ duration: 1.1, ease: "easeOut" }}
/>
)}
</div>
</div>

<div className="relative z-10 border-t border-white/10 bg-black/20 px-4 py-3 sm:px-6">
<button
onClick={() => setDrawerOpen((v) => !v)}
className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left"
>
<div>
<div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
System
</div>
<div className="mt-1 text-sm text-white/72">{message}</div>
</div>
{drawerOpen ? (
<ChevronDown className="h-4 w-4 text-white/55" />
) : (
<ChevronUp className="h-4 w-4 text-white/55" />
)}
</button>

{drawerOpen && (
<div className="mt-3 grid gap-3 md:grid-cols-4">
<DrawerCard
title="Sensitivity"
value={sensitivityLabel}
body={
<input
type="range"
min={0}
max={100}
step={1}
value={sensitivity}
onChange={(e) => setSensitivity(Number(e.target.value))}
className="mt-2 w-full accent-white"
/>
}
/>

<DrawerCard
title="Focus"
value={focusedOrb ? getOrbLabel(focusedOrb.type) : "None"}
body={
focusedOrb ? (
<div className="mt-2 text-xs text-white/55">
Level {focusedOrb.level} · Slot {focusedOrb.slotId.toUpperCase()}
</div>
) : (
<div className="mt-2 text-xs text-white/55">No focused structure</div>
)
}
/>

<DrawerCard
title="Slots"
value={`${orbs.length}/${unlockedSlots.length}`}
body={
<div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
<div
className="h-full bg-white/70"
style={{
width: `${(orbs.length / Math.max(unlockedSlots.length, 1)) * 100}%`,
}}
/>
</div>
}
/>

<DrawerCard
title="Stage"
value={stage}
body={
<div className="mt-2">
<div className="mb-1 flex items-center justify-between text-[11px] text-white/50">
<span>{charge}</span>
<span>{nextThreshold}</span>
</div>
<div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
<div
className="h-full bg-white/70"
style={{ width: `${progress}%` }}
/>
</div>
</div>
}
/>
</div>
)}
</div>
</div>
</div>
</div>
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

return (
<motion.button
className={`absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-white backdrop-blur-xl ${
focused
? "border-white/20 bg-white/[0.14] shadow-[0_0_50px_rgba(255,255,255,0.16)]"
: "border-white/12 bg-white/[0.07]"
}`}
style={{
width: orb.size,
height: orb.size,
marginLeft: slot.x,
marginTop: slot.y,
}}
animate={{
scale: focused ? [1, 1.06, 1] : [1, 1.015, 1],
opacity: orb.transmitting ? [0.75, 1, 0.75] : 1,
}}
transition={{
duration: focused ? 1.8 : 3.6,
repeat: Infinity,
ease: "easeInOut",
}}
onClick={onClick}
>
<div className="flex flex-col items-center justify-center">
<Icon className="h-4 w-4" />
</div>
</motion.button>
);
}

function FocusHalo({ orb }: { orb: Orb }) {
const slot = findSlot(orb.slotId);

return (
<motion.div
className="absolute left-1/2 top-1/2 z-9 rounded-full border border-white/25"
style={{
width: orb.size + 16,
height: orb.size + 16,
marginLeft: slot.x - (orb.size + 16) / 2,
marginTop: slot.y - (orb.size + 16) / 2,
}}
animate={{
scale: [1, 1.08, 1],
opacity: [0.28, 0.82, 0.28],
}}
transition={{
duration: 1.8,
repeat: Infinity,
ease: "easeInOut",
}}
/>
);
}

function ActionNode({
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
className={`absolute left-1/2 top-1/2 z-20 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border backdrop-blur-xl ${
enabled
? "border-white/18 bg-white/[0.08] text-white"
: "border-white/10 bg-white/[0.03] text-white/35"
}`}
style={{ marginLeft: x, marginTop: y }}
animate={{
scale: enabled ? [1, 1.035, 1] : 1,
opacity: enabled ? [0.86, 1, 0.86] : 0.62,
}}
transition={{
duration: 2.2,
repeat: Infinity,
ease: "easeInOut",
}}
onClick={onClick}
disabled={!enabled}
>
<span className="text-[10px] uppercase tracking-[0.18em]">{label}</span>
<span className="mt-1 text-sm font-semibold">{cost}</span>
</motion.button>
);
}

function DrawerCard({
title,
value,
body,
}: {
title: string;
value: string;
body: React.ReactNode;
}) {
return (
<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
{title}
</div>
<div className="mt-1 text-base font-semibold text-white/90">{value}</div>
{body}
</div>
);
}