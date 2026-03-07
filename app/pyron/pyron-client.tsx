"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
Activity,
CircleDot,
Cpu,
Orbit,
Radio,
Send,
Sparkles,
Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type LiveState = "OFF" | "LIVE";
type OrbType = "form" | "scale" | "transmit";
type SensitivityLabel = "Low" | "Medium" | "High" | "Raw";

type Orb = {
id: string;
type: OrbType;
x: number;
y: number;
ring: number;
size: number;
level: number;
transmitting: boolean;
};

type GraphPattern = {
name: string;
description: string;
bonus: number;
};

const CHARGE_KEY = "axis_charge_v2";
const CYCLE_KEY = "axis_cycle_v2";
const LIVE_KEY = "axis_live_v2";
const SENSITIVITY_KEY = "axis_sensitivity_v2";
const ENERGY_KEY = "axis_live_energy_v2";
const ORBS_KEY = "axis_pyron_orbs_v2";
const FOCUSED_ORB_KEY = "axis_focused_orb_v2";

const FORM_COST = 45;
const SCALE_COST = 60;
const TRANSMIT_COST = 100;

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

function getCapacity(cycle: number): number {
if (cycle <= 1) return 2;
if (cycle === 2) return 4;
if (cycle === 3) return 6;
if (cycle === 4) return 8;
return 12;
}

function getSensitivityLabel(value: number): SensitivityLabel {
if (value <= 25) return "Low";
if (value <= 50) return "Medium";
if (value <= 75) return "High";
return "Raw";
}

function getEnergyGainMultiplier(value: number): number {
if (value <= 25) return 0.35;
if (value <= 50) return 0.7;
if (value <= 75) return 1;
return 1.35;
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

function getOrbClass(type: OrbType, focused: boolean, transmitting: boolean) {
const base =
"border-white/15 text-white backdrop-blur-xl transition duration-300";
const focusedClass = focused
? "bg-white/16 shadow-[0_0_50px_rgba(255,255,255,0.24)]"
: "bg-white/8";

const transmitClass = transmitting
? "shadow-[0_0_60px_rgba(255,255,255,0.24)]"
: "";

if (type === "form") return `${base} ${focusedClass} ${transmitClass}`;
if (type === "scale") return `${base} ${focusedClass} ${transmitClass}`;
return `${base} ${focusedClass} ${transmitClass}`;
}

function defaultOrbs(): Orb[] {
return [
{
id: "orb-1",
type: "form",
x: 0,
y: -118,
ring: 1,
size: 58,
level: 1,
transmitting: false,
},
{
id: "orb-2",
type: "scale",
x: 102,
y: 58,
ring: 1,
size: 58,
level: 1,
transmitting: false,
},
{
id: "orb-3",
type: "transmit",
x: -102,
y: 58,
ring: 1,
size: 58,
level: 1,
transmitting: false,
},
];
}

function safeParseOrbs(raw: string | null): Orb[] {
if (!raw) return defaultOrbs();
try {
const parsed = JSON.parse(raw) as Orb[];
if (!Array.isArray(parsed) || parsed.length === 0) return defaultOrbs();
return parsed;
} catch {
return defaultOrbs();
}
}

function computeGraphPattern(orbs: Orb[]): GraphPattern | null {
if (orbs.length < 3) return null;

const levels = orbs.map((o) => o.level);
const maxLevel = Math.max(...levels);

if (orbs.length >= 3 && orbs.length <= 4) {
return {
name: "Triangle",
description: "Three-point structure creates a stable geometry.",
bonus: 12,
};
}

if (orbs.length >= 5 && maxLevel >= 2) {
return {
name: "Hub",
description: "Scaled center influence improves field coherence.",
bonus: 20,
};
}

if (orbs.some((o) => o.transmitting) && orbs.length >= 4) {
return {
name: "Chain",
description: "Transmission path increases network output.",
bonus: 18,
};
}

return null;
}

function computeFieldState(
charge: number,
cycle: number,
liveEnergy: number,
orbCount: number,
focusedOrb: Orb | undefined
) {
const coherence = Math.min(
100,
Math.round(38 + cycle * 8 + orbCount * 4 + liveEnergy * 0.22)
);
const instability = Math.max(
6,
Math.round(44 - cycle * 4 + (focusedOrb ? 0 : 6) + liveEnergy * 0.08)
);
const resonance = Math.min(
100,
Math.round(30 + cycle * 10 + charge * 0.03 + liveEnergy * 0.25)
);

return { coherence, instability, resonance };
}

function positionForNewOrb(index: number): { x: number; y: number; ring: number } {
const ringIndex = Math.floor(index / 4) + 1;
const slot = index % 4;
const radius = 118 + (ringIndex - 1) * 78;
const angles = [-90, 0, 90, 180];
const angle = (angles[slot] * Math.PI) / 180;
return {
x: Math.cos(angle) * radius,
y: Math.sin(angle) * radius,
ring: ringIndex,
};
}

function makeNewOrb(index: number): Orb {
const typeCycle: OrbType[] = ["form", "scale", "transmit"];
const pos = positionForNewOrb(index);

return {
id: `orb-${Date.now()}-${index}`,
type: typeCycle[index % typeCycle.length],
x: pos.x,
y: pos.y,
ring: pos.ring,
size: 54,
level: 1,
transmitting: false,
};
}

export default function PyronClient() {
const [charge, setCharge] = useState<number>(149);
const [cycle, setCycle] = useState<number>(2);
const [liveState, setLiveState] = useState<LiveState>("OFF");
const [sensitivity, setSensitivity] = useState<number>(50);
const [liveEnergy, setLiveEnergy] = useState<number>(18);
const [orbs, setOrbs] = useState<Orb[]>(defaultOrbs());
const [focusedOrbId, setFocusedOrbId] = useState<string | null>("orb-1");
const [message, setMessage] = useState<string>("Focus a structure and shape the field.");

useEffect(() => {
if (typeof window === "undefined") return;

const savedCharge = Number(window.localStorage.getItem(CHARGE_KEY) ?? 149);
const savedCycle = Number(window.localStorage.getItem(CYCLE_KEY) ?? 2);
const savedLive = (window.localStorage.getItem(LIVE_KEY) as LiveState | null) ?? "OFF";
const savedSensitivity = Number(window.localStorage.getItem(SENSITIVITY_KEY) ?? 50);
const savedEnergy = Number(window.localStorage.getItem(ENERGY_KEY) ?? 18);
const savedOrbs = safeParseOrbs(window.localStorage.getItem(ORBS_KEY));
const savedFocused = window.localStorage.getItem(FOCUSED_ORB_KEY);

if (!Number.isNaN(savedCharge)) setCharge(savedCharge);
if (!Number.isNaN(savedCycle) && savedCycle > 0) setCycle(savedCycle);
if (savedLive === "OFF" || savedLive === "LIVE") setLiveState(savedLive);
if (!Number.isNaN(savedSensitivity)) setSensitivity(savedSensitivity);
if (!Number.isNaN(savedEnergy)) setLiveEnergy(savedEnergy);
setOrbs(savedOrbs);
setFocusedOrbId(savedFocused ?? savedOrbs[0]?.id ?? null);
}, []);

useEffect(() => {
if (typeof window === "undefined") return;
window.localStorage.setItem(CHARGE_KEY, String(charge));
window.localStorage.setItem(CYCLE_KEY, String(cycle));
window.localStorage.setItem(LIVE_KEY, liveState);
window.localStorage.setItem(SENSITIVITY_KEY, String(sensitivity));
window.localStorage.setItem(ENERGY_KEY, String(liveEnergy));
window.localStorage.setItem(ORBS_KEY, JSON.stringify(orbs));
if (focusedOrbId) {
window.localStorage.setItem(FOCUSED_ORB_KEY, focusedOrbId);
}
}, [charge, cycle, liveState, sensitivity, liveEnergy, orbs, focusedOrbId]);

useEffect(() => {
if (liveState !== "LIVE") return;

const interval = window.setInterval(() => {
const nextEnergy = Math.max(
8,
Math.min(
100,
liveEnergy +
(Math.random() * 16 - 6) * getEnergyGainMultiplier(sensitivity)
)
);

setLiveEnergy(Number(nextEnergy.toFixed(1)));

const gain = Math.max(
0,
Math.round((nextEnergy / 22) * getEnergyGainMultiplier(sensitivity))
);

if (gain > 0) {
setCharge((prev) => {
const updated = prev + gain;
const prevStage = getStage(prev);
const nextStage = getStage(updated);

if (prevStage !== nextStage && nextStage !== "Titan") {
setCycle((c) => c + 1);
}

return updated;
});
}
}, 1400);

return () => window.clearInterval(interval);
}, [liveState, sensitivity, liveEnergy]);

const stage = useMemo(() => getStage(charge), [charge]);
const nextThreshold = useMemo(() => getNextThreshold(stage), [stage]);
const stageMin = useMemo(() => getStageMin(stage), [stage]);
const capacity = useMemo(() => getCapacity(cycle), [cycle]);
const focusedOrb = useMemo(
() => orbs.find((orb) => orb.id === focusedOrbId),
[orbs, focusedOrbId]
);
const pattern = useMemo(() => computeGraphPattern(orbs), [orbs]);

const progress = useMemo(() => {
const span = nextThreshold - stageMin;
if (span <= 0) return 100;
return Math.max(0, Math.min(100, ((charge - stageMin) / span) * 100));
}, [charge, nextThreshold, stageMin]);

const field = useMemo(
() => computeFieldState(charge, cycle, liveEnergy, orbs.length, focusedOrb),
[charge, cycle, liveEnergy, orbs.length, focusedOrb]
);

const sensitivityLabel = useMemo(
() => getSensitivityLabel(sensitivity),
[sensitivity]
);

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

if (orbs.length >= capacity) {
setMessage("Capacity reached. Scale or Transmit instead.");
return;
}

const nextOrb = makeNewOrb(orbs.length);
setCharge((prev) => prev - FORM_COST);
setOrbs((prev) => [...prev, nextOrb]);
setFocusedOrbId(nextOrb.id);
setMessage("New structure formed.");
}

function runScale() {
if (!focusedOrb) {
setMessage("Focus an orb to Scale.");
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
size: Math.min(96, orb.size + 10),
level: orb.level + 1,
x: orb.x * 1.08,
y: orb.y * 1.08,
}
: orb
)
);
setMessage("Focused structure scaled.");
}

function runTransmit() {
if (!focusedOrb) {
setMessage("Focus an orb to Transmit.");
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
? { ...orb, transmitting: true, type: "transmit" }
: orb
)
);
setMessage("Focused structure transmitted to the grid.");

window.setTimeout(() => {
setOrbs((prev) =>
prev.map((orb) =>
orb.id === focusedOrb.id ? { ...orb, transmitting: false } : orb
)
);
}, 1500);
}

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
<div className="mb-6 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
<Card className="border-white/10 bg-white/5 backdrop-blur-xl">
<CardHeader className="pb-3">
<div className="flex items-center justify-between gap-4">
<div>
<Badge
variant="secondary"
className="mb-3 border-white/10 bg-white/10 text-white"
>
Pyron Graph Engine
</Badge>
<CardTitle className="text-2xl md:text-3xl">
Pyron Live Structure Field
</CardTitle>
<p className="mt-2 max-w-2xl text-sm text-white/70">
Live body signal powers structures. Focus lets you shape them.
Form creates. Scale expands. Transmit sends them into the grid.
</p>
</div>

<div className="text-right">
<div className="text-xs uppercase tracking-[0.28em] text-white/45">
State
</div>
<div className="mt-1 flex items-center justify-end gap-2 text-lg font-semibold">
<span
className={`inline-block h-2.5 w-2.5 rounded-full ${
liveState === "LIVE" ? "bg-white" : "bg-white/35"
}`}
/>
{liveState}
</div>
</div>
</div>
</CardHeader>

<CardContent>
<div className="grid gap-4 md:grid-cols-4">
<MetricCard
label="Axis"
value="Measure"
sub={`${Math.round(liveEnergy)} live energy`}
icon={Activity}
/>
<MetricCard
label="Cycle Bank"
value={`Cycle ${cycle}`}
sub={`${stage} state`}
icon={Orbit}
/>
<MetricCard
label="Pyron"
value={`${orbs.length}/${capacity}`}
sub="active structures"
icon={Cpu}
/>
<MetricCard
label="Network"
value={pattern?.name ?? "Open"}
sub="graph pattern"
icon={Radio}
/>
</div>
</CardContent>
</Card>

<Card className="border-white/10 bg-white/5 backdrop-blur-xl">
<CardHeader className="pb-2">
<CardTitle className="text-lg">Live Controls</CardTitle>
</CardHeader>

<CardContent className="space-y-5">
<div className="grid gap-3 sm:grid-cols-2">
<Button className="rounded-2xl" onClick={toggleLive}>
{liveState === "LIVE" ? "Set OFF" : "Start LIVE"}
</Button>
<Button
className="rounded-2xl border-white/15 bg-white/10 hover:bg-white/15"
onClick={() => {
setCharge(149);
setCycle(2);
setLiveEnergy(18);
setOrbs(defaultOrbs());
setFocusedOrbId("orb-1");
setLiveState("OFF");
setMessage("System reset.");
}}
>
Reset System
</Button>
</div>

<div>
<div className="mb-2 flex items-center justify-between text-sm text-white/70">
<span>Sensitivity</span>
<span>{sensitivityLabel}</span>
</div>
<input
type="range"
min={0}
max={100}
step={1}
value={sensitivity}
onChange={(e) => setSensitivity(Number(e.target.value))}
className="w-full accent-white"
/>
</div>

<div className="grid gap-3">
<FieldBar label="Coherence" value={field.coherence} />
<FieldBar label="Instability" value={field.instability} />
<FieldBar label="Resonance" value={field.resonance} />
</div>
</CardContent>
</Card>
</div>

<div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
<Card className="overflow-hidden border-white/10 bg-white/5 backdrop-blur-xl">
<CardHeader className="pb-3">
<div className="flex items-center justify-between gap-4">
<div>
<CardTitle className="text-xl">Pyron Core</CardTitle>
<p className="mt-2 text-sm text-white/65">
Focus a structure, then shape it with your bank.
</p>
</div>

<div className="text-right">
<div className="text-xs uppercase tracking-[0.24em] text-white/45">
Bank
</div>
<div className="mt-1 text-xl font-semibold">{charge}</div>
<div className="text-sm text-white/55">Next {nextThreshold}</div>
</div>
</div>
</CardHeader>

<CardContent>
<div className="relative mx-auto aspect-square max-w-[720px] overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.14),rgba(255,255,255,0.03)_28%,rgba(0,0,0,0.9)_72%)]">
{[1, 2, 3].map((ring) => {
const size = 250 + (ring - 1) * 150;
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
opacity: liveState === "LIVE" ? [0.16, 0.28, 0.16] : 0.1,
scale: liveState === "LIVE" ? [1, 1.01, 1] : 1,
}}
transition={{
duration: 3.5 + ring,
repeat: Infinity,
ease: "easeInOut",
}}
/>
);
})}

{orbs.map((orb) => {
const focused = orb.id === focusedOrbId;
const Icon = getOrbIcon(orb.type);

return (
<React.Fragment key={orb.id}>
<motion.div
className="absolute left-1/2 top-1/2 z-0 h-px bg-white/20"
style={{
width: Math.sqrt(orb.x * orb.x + orb.y * orb.y),
transformOrigin: "0 0",
transform: `translate(0, 0) rotate(${Math.atan2(
orb.y,
orb.x
)}rad)`,
marginLeft: 0,
marginTop: 0,
}}
animate={{
opacity: focused ? [0.2, 0.7, 0.2] : [0.12, 0.25, 0.12],
}}
transition={{
duration: focused ? 1.6 : 3,
repeat: Infinity,
ease: "easeInOut",
}}
/>

<motion.button
className={`absolute left-1/2 top-1/2 z-10 flex items-center justify-center rounded-full border ${getOrbClass(
orb.type,
focused,
orb.transmitting
)}`}
style={{
width: orb.size,
height: orb.size,
marginLeft: orb.x - orb.size / 2,
marginTop: orb.y - orb.size / 2,
}}
animate={{
scale: focused
? [1, 1.06, 1]
: liveState === "LIVE"
? [1, 1.02, 1]
: 1,
opacity: orb.transmitting ? [0.8, 1, 0.8] : 1,
}}
transition={{
duration: focused ? 1.8 : 3.8,
repeat: Infinity,
ease: "easeInOut",
}}
onClick={() => {
setFocusedOrbId(orb.id);
setMessage(`${getOrbLabel(orb.type)} structure focused.`);
}}
>
<div className="flex flex-col items-center justify-center">
<Icon className="h-4 w-4" />
<span className="mt-1 text-[9px] uppercase tracking-[0.16em]">
{getOrbLabel(orb.type)}
</span>
</div>
</motion.button>
</React.Fragment>
);
})}

<motion.div
className="absolute left-1/2 top-1/2 z-20 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-white/10 text-center shadow-[0_0_90px_rgba(255,255,255,0.18)] backdrop-blur-xl"
animate={{
scale: liveState === "LIVE" ? [1, 1.05, 1] : 1,
opacity: liveState === "LIVE" ? [0.95, 1, 0.95] : 0.82,
}}
transition={{
duration: 3.2,
repeat: Infinity,
ease: "easeInOut",
}}
>
<div className="pt-5 text-[10px] uppercase tracking-[0.28em] text-white/55">
Pyron Core
</div>
<div className="mt-2 text-2xl font-semibold">{liveState}</div>
<div className="text-sm text-white/70">Cycle {cycle}</div>
<div className="mt-2 text-xs text-white/55">Bank {charge}</div>
</motion.div>

{focusedOrb && (
<motion.div
className="absolute left-1/2 top-1/2 z-15 rounded-full border border-white/30"
style={{
width: focusedOrb.size + 16,
height: focusedOrb.size + 16,
marginLeft: focusedOrb.x - (focusedOrb.size + 16) / 2,
marginTop: focusedOrb.y - (focusedOrb.size + 16) / 2,
}}
animate={{
scale: [1, 1.08, 1],
opacity: [0.3, 0.8, 0.3],
}}
transition={{
duration: 1.8,
repeat: Infinity,
ease: "easeInOut",
}}
/>
)}

{focusedOrb && (
<>
<ActionNode
label="Form"
cost={FORM_COST}
x={0}
y={-190}
enabled={charge >= FORM_COST && orbs.length < capacity}
onClick={runForm}
/>
<ActionNode
label="Scale"
cost={SCALE_COST}
x={-175}
y={140}
enabled={charge >= SCALE_COST}
onClick={runScale}
/>
<ActionNode
label="Transmit"
cost={TRANSMIT_COST}
x={175}
y={140}
enabled={charge >= TRANSMIT_COST}
onClick={runTransmit}
/>
</>
)}

{focusedOrb?.transmitting && (
<motion.div
className="absolute left-1/2 top-1/2 rounded-full border border-white/25"
style={{
width: 180,
height: 180,
transform: "translate(-50%, -50%)",
}}
animate={{ scale: [1, 3, 4], opacity: [0.75, 0.25, 0] }}
transition={{ duration: 1.2, repeat: 0, ease: "easeOut" }}
/>
)}

<div className="absolute bottom-4 left-4 right-4 grid gap-3 md:grid-cols-4">
<GlassStat title="Focus" value={focusedOrb ? getOrbLabel(focusedOrb.type) : "None"} />
<GlassStat title="Capacity" value={`${orbs.length}/${capacity}`} />
<GlassStat title="Sensitivity" value={sensitivityLabel} />
<GlassStat title="Pattern" value={pattern?.name ?? "None"} />
</div>
</div>
</CardContent>
</Card>

<div className="grid gap-4">
<Card className="border-white/10 bg-white/5 backdrop-blur-xl">
<CardHeader className="pb-2">
<CardTitle className="text-lg">Cycle Bank</CardTitle>
</CardHeader>

<CardContent className="space-y-4">
<div>
<div className="mb-2 flex items-center justify-between text-sm text-white/70">
<span>{stage}</span>
<span>
{charge} / {nextThreshold}
</span>
</div>
<Progress value={progress} className="h-2 bg-white/10" />
</div>

<div className="grid grid-cols-5 gap-2 text-center text-xs">
{(["Seed", "Core", "Pulse", "Nova", "Titan"] as Stage[]).map((s) => (
<div
key={s}
className={`rounded-xl border px-2 py-3 ${
stage === s
? "border-white/20 bg-white/10 text-white"
: "border-white/10 bg-white/[0.03] text-white/55"
}`}
>
{s}
</div>
))}
</div>

<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/75">
{message}
</div>
</CardContent>
</Card>

<Card className="border-white/10 bg-white/5 backdrop-blur-xl">
<CardHeader className="pb-2">
<CardTitle className="text-lg">Focused Structure</CardTitle>
</CardHeader>

<CardContent className="space-y-4">
{focusedOrb ? (
<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
<div className="flex items-center gap-3">
<div className="rounded-2xl border border-white/10 bg-white/10 p-3">
{(() => {
const Icon = getOrbIcon(focusedOrb.type);
return <Icon className="h-5 w-5" />;
})()}
</div>

<div>
<div className="text-lg font-semibold">
{getOrbLabel(focusedOrb.type)}
</div>
<div className="text-sm text-white/60">
Level {focusedOrb.level} · Ring {focusedOrb.ring}
</div>
</div>
</div>

<div className="mt-4 grid gap-3">
<FieldBar
label="Mass"
value={Math.min(100, focusedOrb.size)}
/>
<FieldBar
label="Signal"
value={focusedOrb.transmitting ? 100 : 35 + focusedOrb.level * 12}
/>
</div>
</div>
) : (
<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/65">
No structure focused.
</div>
)}
</CardContent>
</Card>

<Card className="border-white/10 bg-white/5 backdrop-blur-xl">
<CardHeader className="pb-2">
<CardTitle className="text-lg">Graph Logic</CardTitle>
</CardHeader>

<CardContent className="space-y-4">
<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
<div className="text-sm text-white/55">Detected Pattern</div>
<div className="mt-1 text-lg font-semibold">
{pattern?.name ?? "None"}
</div>
<div className="mt-2 text-sm leading-6 text-white/65">
{pattern?.description ??
"Build more structures and scale them to unlock graph bonuses."}
</div>
<div className="mt-3 text-sm text-white/80">
Bonus: {pattern ? `+${pattern.bonus}` : "0"}
</div>
</div>

<div className="grid gap-3 sm:grid-cols-3">
<MiniRule title="Triangle" body="3-point stability geometry" />
<MiniRule title="Hub" body="scaled center influence" />
<MiniRule title="Chain" body="transmission path bonus" />
</div>
</CardContent>
</Card>
</div>
</div>
</div>
</div>
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
className={`absolute left-1/2 top-1/2 z-20 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border text-center backdrop-blur-xl ${
enabled
? "border-white/20 bg-white/10 text-white"
: "border-white/10 bg-white/[0.03] text-white/35"
}`}
style={{ marginLeft: x, marginTop: y }}
animate={{
scale: enabled ? [1, 1.04, 1] : 1,
opacity: enabled ? [0.9, 1, 0.9] : 0.65,
}}
transition={{
duration: 2.4,
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

function MetricCard({
label,
value,
sub,
icon: Icon,
}: {
label: string;
value: string;
sub: string;
icon: React.ComponentType<{ className?: string }>;
}) {
return (
<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
<div className="flex items-center justify-between gap-3">
<div>
<div className="text-xs uppercase tracking-[0.24em] text-white/45">
{label}
</div>
<div className="mt-2 text-lg font-semibold">{value}</div>
<div className="mt-1 text-sm text-white/55">{sub}</div>
</div>

<div className="rounded-2xl border border-white/10 bg-white/10 p-3">
<Icon className="h-5 w-5" />
</div>
</div>
</div>
);
}

function FieldBar({ label, value }: { label: string; value: number }) {
return (
<div>
<div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-white/45">
<span>{label}</span>
<span>{Math.round(value)}</span>
</div>
<Progress value={value} className="h-2 bg-white/10" />
</div>
);
}

function GlassStat({ title, value }: { title: string; value: string }) {
return (
<div className="rounded-2xl border border-white/10 bg-black/25 p-3 backdrop-blur-xl">
<div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
{title}
</div>
<div className="mt-1 text-sm font-semibold text-white/90">{value}</div>
</div>
);
}

function MiniRule({ title, body }: { title: string; body: string }) {
return (
<div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
<div className="text-sm font-semibold">{title}</div>
<div className="mt-2 text-sm leading-6 text-white/65">{body}</div>
</div>
);
}