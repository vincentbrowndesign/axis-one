"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const CHARGE_KEY = "axis_charge_v1";
const NODES_KEY = "axis_pyron_nodes_v1";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type NodeType = "storage" | "amplifier" | "stabilizer" | "relay";
type FlashType = NodeType | null;

const NODE_COST: Record<NodeType, number> = {
storage: 40,
amplifier: 60,
stabilizer: 80,
relay: 100,
};

const NODE_META: Record<
NodeType,
{
name: string;
description: string;
color: string;
glow: string;
}
> = {
storage: {
name: "Storage",
description: "Expands holding capacity",
color: "#39f3d2",
glow: "rgba(57,243,210,.45)",
},
amplifier: {
name: "Amplifier",
description: "Strengthens output",
color: "#4bb8ff",
glow: "rgba(75,184,255,.45)",
},
stabilizer: {
name: "Stabilizer",
description: "Settles the system",
color: "#ffd15a",
glow: "rgba(255,209,90,.42)",
},
relay: {
name: "Relay",
description: "Extends the field",
color: "#ff7aa8",
glow: "rgba(255,122,168,.40)",
},
};

function getStage(charge: number): Stage {
if (charge < 50) return "Seed";
if (charge < 150) return "Core";
if (charge < 400) return "Pulse";
if (charge < 1000) return "Nova";
return "Titan";
}

function getSocketLimit(stage: Stage) {
if (stage === "Seed") return 0;
if (stage === "Core") return 2;
if (stage === "Pulse") return 4;
if (stage === "Nova") return 6;
return 8;
}

function getRingCount(stage: Stage) {
if (stage === "Seed") return 0;
if (stage === "Core") return 1;
if (stage === "Pulse") return 2;
if (stage === "Nova") return 3;
return 4;
}

function clamp(value: number, min: number, max: number) {
return Math.max(min, Math.min(max, value));
}

function getNodeCounts(nodes: NodeType[]) {
return nodes.reduce(
(acc, node) => {
acc[node] += 1;
return acc;
},
{
storage: 0,
amplifier: 0,
stabilizer: 0,
relay: 0,
} as Record<NodeType, number>
);
}

export default function PyronClient() {
const [charge, setCharge] = useState(0);
const [displayCharge, setDisplayCharge] = useState(0);
const [nodes, setNodes] = useState<NodeType[]>([]);
const [flashType, setFlashType] = useState<FlashType>(null);
const [impactKey, setImpactKey] = useState(0);
const [isLoaded, setIsLoaded] = useState(false);

const flashTimerRef = useRef<number | null>(null);

useEffect(() => {
const storedCharge = localStorage.getItem(CHARGE_KEY);
const storedNodes = localStorage.getItem(NODES_KEY);

if (storedCharge) {
const parsed = Number(storedCharge);
if (!Number.isNaN(parsed)) {
setCharge(parsed);
setDisplayCharge(parsed);
}
}

if (storedNodes) {
try {
const parsed = JSON.parse(storedNodes) as NodeType[];
if (Array.isArray(parsed)) {
setNodes(
parsed.filter((n) =>
["storage", "amplifier", "stabilizer", "relay"].includes(n)
) as NodeType[]
);
}
} catch {
// ignore bad localStorage payload
}
}

setIsLoaded(true);
}, []);

useEffect(() => {
if (!isLoaded) return;
localStorage.setItem(CHARGE_KEY, String(charge));
}, [charge, isLoaded]);

useEffect(() => {
if (!isLoaded) return;
localStorage.setItem(NODES_KEY, JSON.stringify(nodes));
}, [nodes, isLoaded]);

useEffect(() => {
let frame = 0;
const start = displayCharge;
const end = charge;

if (start === end) return;

const duration = 500;
const startTime = performance.now();

const tick = (now: number) => {
const t = clamp((now - startTime) / duration, 0, 1);
const eased = 1 - Math.pow(1 - t, 3);
setDisplayCharge(Math.round(start + (end - start) * eased));

if (t < 1) {
frame = requestAnimationFrame(tick);
}
};

frame = requestAnimationFrame(tick);
return () => cancelAnimationFrame(frame);
}, [charge]);

useEffect(() => {
return () => {
if (flashTimerRef.current) {
window.clearTimeout(flashTimerRef.current);
}
};
}, []);

const stage = getStage(charge);
const socketLimit = getSocketLimit(stage);
const baseRings = getRingCount(stage);
const nodeCounts = useMemo(() => getNodeCounts(nodes), [nodes]);

const totalRings = baseRings + Math.min(nodeCounts.storage, 3);
const canBuild = nodes.length < socketLimit;

const coreScale = 1 + Math.min(nodeCounts.amplifier * 0.04, 0.16);
const haloScale = 1 + Math.min(nodeCounts.storage * 0.12, 0.36);
const fieldScale = 1 + Math.min(nodeCounts.relay * 0.18, 0.54);
const stability = clamp(1 - nodeCounts.stabilizer * 0.18, 0.28, 1);

function triggerInstall(type: NodeType) {
setFlashType(type);
setImpactKey((prev) => prev + 1);

if (flashTimerRef.current) {
window.clearTimeout(flashTimerRef.current);
}

flashTimerRef.current = window.setTimeout(() => {
setFlashType(null);
}, 650);
}

function addNode(type: NodeType) {
const cost = NODE_COST[type];
if (charge < cost) return;
if (nodes.length >= socketLimit) return;

setNodes((prev) => [...prev, type]);
setCharge((prev) => prev - cost);
triggerInstall(type);
}

function resetPyron() {
setNodes([]);
setFlashType("relay");
setImpactKey((prev) => prev + 1);

if (flashTimerRef.current) {
window.clearTimeout(flashTimerRef.current);
}

flashTimerRef.current = window.setTimeout(() => {
setFlashType(null);
}, 500);
}

const sparkColor = flashType ? NODE_META[flashType].color : "#2ef0d0";
const sparkGlow = flashType ? NODE_META[flashType].glow : "rgba(46,240,208,.42)";

return (
<>
<style>{`
@keyframes pyronBreath {
0% { transform: scale(0.985); }
50% { transform: scale(1.035); }
100% { transform: scale(0.985); }
}

@keyframes pyronHalo {
0% { transform: scale(.94); opacity: .38; }
50% { transform: scale(1.06); opacity: .62; }
100% { transform: scale(.94); opacity: .38; }
}

@keyframes pyronShimmer {
0% { transform: rotate(0deg) scale(1); opacity: .22; }
50% { transform: rotate(180deg) scale(1.03); opacity: .32; }
100% { transform: rotate(360deg) scale(1); opacity: .22; }
}

@keyframes pyronRingDraw {
0% {
opacity: 0;
transform: scale(.78);
}
100% {
opacity: 1;
transform: scale(1);
}
}

@keyframes pyronImpact {
0% {
opacity: .8;
transform: translate(-50%, -50%) scale(.35);
}
100% {
opacity: 0;
transform: translate(-50%, -50%) scale(1.55);
}
}

@keyframes pyronOrbit {
0% { transform: rotate(0deg); }
100% { transform: rotate(360deg); }
}

@keyframes pyronCardPulse {
0% { box-shadow: 0 0 0 rgba(255,255,255,0); }
50% { box-shadow: 0 0 24px rgba(255,255,255,.08); }
100% { box-shadow: 0 0 0 rgba(255,255,255,0); }
}

@keyframes pyronNumberPop {
0% { transform: translateY(2px); opacity: .7; }
50% { transform: translateY(-1px); opacity: 1; }
100% { transform: translateY(0px); opacity: 1; }
}

@keyframes pyronInstallBeam {
0% {
opacity: 0;
transform: translateY(12px) scale(.92);
}
20% {
opacity: .95;
transform: translateY(0px) scale(1);
}
100% {
opacity: 0;
transform: translateY(-120px) scale(.5);
}
}

@keyframes pyronRelayField {
0% {
opacity: .12;
transform: translate(-50%, -50%) scale(.8);
}
50% {
opacity: .22;
transform: translate(-50%, -50%) scale(1.02);
}
100% {
opacity: .12;
transform: translate(-50%, -50%) scale(.8);
}
}
`}</style>

<div
style={{
border: "1px solid rgba(255,255,255,.08)",
borderRadius: 28,
padding: 24,
background: "#050505",
display: "grid",
gap: 28,
overflow: "hidden",
}}
>
<div style={{ textAlign: "center" }}>
<div
style={{
fontSize: 13,
color: "rgba(255,255,255,.5)",
}}
>
Pyron
</div>

<div
style={{
fontSize: 36,
fontWeight: 700,
marginTop: 6,
}}
>
{stage}
</div>

<div
style={{
color: "rgba(255,255,255,.6)",
marginTop: 6,
}}
>
Living energy grown from Axis charge
</div>
</div>

<div
style={{
display: "flex",
justifyContent: "space-around",
textAlign: "center",
}}
>
<Stat label="Stored Charge" value={displayCharge} animated />
<Stat label="Rings" value={totalRings} />
<Stat label="Nodes" value={`${nodes.length}/${socketLimit}`} />
</div>

<div
style={{
display: "flex",
justifyContent: "center",
padding: "12px 8px 8px",
}}
>
<div
style={{
position: "relative",
width: 320,
height: 320,
maxWidth: "100%",
}}
>
{nodeCounts.relay > 0 && (
<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 260 * fieldScale,
height: 260 * fieldScale,
borderRadius: "50%",
border: "1px solid rgba(255,122,168,.16)",
boxShadow: "0 0 44px rgba(255,122,168,.08)",
animation: `pyronRelayField ${4.8 - Math.min(nodeCounts.relay * 0.2, 0.8)}s ease-in-out infinite`,
pointerEvents: "none",
}}
/>
)}

<div
style={{
position: "absolute",
inset: 0,
display: "grid",
placeItems: "center",
}}
>
{[...Array(totalRings)].map((_, i) => {
const size = 145 + i * 34;
const ringOpacity = clamp(0.26 - i * 0.035, 0.09, 0.26);
const ringDuration =
10 + i * 1.4 - Math.min(nodeCounts.amplifier * 0.45, 1.4);
return (
<div
key={`ring-${i}-${totalRings}`}
style={{
position: "absolute",
width: size,
height: size,
borderRadius: "50%",
border: `1px solid rgba(46,240,208,${ringOpacity})`,
boxShadow: `0 0 ${18 + i * 6}px rgba(46,240,208,${ringOpacity * 0.45})`,
animation: `
pyronRingDraw .55s ease-out both,
pyronHalo ${ringDuration}s ease-in-out ${i * 0.14}s infinite
`,
transformOrigin: "center",
pointerEvents: "none",
}}
/>
);
})}

{nodes.length > 0 && (
<div
style={{
position: "absolute",
width: 228,
height: 228,
animation: `pyronOrbit ${10 * stability}s linear infinite`,
pointerEvents: "none",
}}
>
{nodes.map((node, i) => {
const angle = (360 / Math.max(nodes.length, 1)) * i;
return (
<div
key={`${node}-${i}`}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 14,
height: 14,
marginLeft: -7,
marginTop: -114,
borderRadius: "50%",
background: NODE_META[node].color,
boxShadow: `0 0 16px ${NODE_META[node].glow}`,
transform: `rotate(${angle}deg) translateY(-100px)`,
opacity: 0.95,
}}
/>
);
})}
</div>
)}

{impactKey > 0 && (
<div
key={impactKey}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 140,
height: 140,
borderRadius: "50%",
border: `1px solid ${sparkGlow}`,
boxShadow: `0 0 40px ${sparkGlow}`,
animation: "pyronImpact .7s ease-out forwards",
pointerEvents: "none",
}}
/>
)}

{flashType && (
<div
key={`beam-${impactKey}`}
style={{
position: "absolute",
bottom: 8,
left: "50%",
width: 10,
height: 90,
borderRadius: 999,
background: `linear-gradient(180deg, ${NODE_META[flashType].color}, transparent)`,
boxShadow: `0 0 18px ${NODE_META[flashType].glow}`,
animation: "pyronInstallBeam .65s ease-out forwards",
pointerEvents: "none",
}}
/>
)}

<div
style={{
position: "absolute",
width: 190 * haloScale,
height: 190 * haloScale,
borderRadius: "50%",
background: `radial-gradient(circle, ${sparkGlow} 0%, rgba(0,0,0,0) 72%)`,
filter: "blur(10px)",
animation: `pyronHalo ${4.6 - Math.min(nodeCounts.amplifier * 0.24, 1)}s ease-in-out infinite`,
opacity: 0.95,
pointerEvents: "none",
}}
/>

<div
style={{
position: "absolute",
width: 152,
height: 152,
borderRadius: "50%",
background:
"conic-gradient(from 0deg, rgba(46,240,208,.05), rgba(46,240,208,.18), rgba(75,184,255,.10), rgba(46,240,208,.05))",
filter: "blur(1px)",
animation: `pyronShimmer ${9 * stability}s linear infinite`,
opacity: 0.9,
pointerEvents: "none",
}}
/>

<div
style={{
width: 118 * coreScale,
height: 118 * coreScale,
borderRadius: "50%",
background: `radial-gradient(circle at 42% 38%, #86fff1 0%, ${sparkColor} 34%, #088b8d 68%, #031516 100%)`,
boxShadow: `0 0 80px ${sparkGlow}, inset 0 -10px 24px rgba(0,0,0,.25), inset 0 8px 18px rgba(255,255,255,.08)`,
animation: `pyronBreath ${3.8 - Math.min(nodeCounts.amplifier * 0.22, 0.9)}s ease-in-out infinite`,
}}
/>
</div>
</div>
</div>

<div
style={{
textAlign: "center",
color: "rgba(255,255,255,.62)",
marginTop: -4,
}}
>
Build the inner environment from charge.
</div>

<div style={{ display: "grid", gap: 14 }}>
<div
style={{
fontSize: 22,
fontWeight: 600,
}}
>
Nodes
</div>

<NodeButton
type="storage"
charge={charge}
canBuild={canBuild}
installedCount={nodeCounts.storage}
onClick={() => addNode("storage")}
/>

<NodeButton
type="amplifier"
charge={charge}
canBuild={canBuild}
installedCount={nodeCounts.amplifier}
onClick={() => addNode("amplifier")}
/>

<NodeButton
type="stabilizer"
charge={charge}
canBuild={canBuild}
installedCount={nodeCounts.stabilizer}
onClick={() => addNode("stabilizer")}
/>

<NodeButton
type="relay"
charge={charge}
canBuild={canBuild}
installedCount={nodeCounts.relay}
onClick={() => addNode("relay")}
/>
</div>

<button
onClick={resetPyron}
style={{
padding: 16,
borderRadius: 18,
border: "1px solid rgba(255,255,255,.1)",
background: "rgba(255,255,255,.05)",
color: "white",
fontWeight: 700,
fontSize: 16,
cursor: "pointer",
}}
>
Reset Pyron
</button>
</div>
</>
);
}

function Stat({
label,
value,
animated = false,
}: {
label: string;
value: React.ReactNode;
animated?: boolean;
}) {
return (
<div>
<div
style={{
color: "rgba(255,255,255,.5)",
fontSize: 12,
}}
>
{label}
</div>

<div
style={{
fontSize: 22,
fontWeight: 700,
marginTop: 4,
animation: animated ? "pyronNumberPop .45s ease" : undefined,
}}
>
{value}
</div>
</div>
);
}

function NodeButton({
type,
charge,
canBuild,
installedCount,
onClick,
}: {
type: NodeType;
charge: number;
canBuild: boolean;
installedCount: number;
onClick: () => void;
}) {
const meta = NODE_META[type];
const cost = NODE_COST[type];
const locked = charge < cost || !canBuild;

return (
<button
onClick={onClick}
disabled={locked}
style={{
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 16,
padding: 18,
borderRadius: 20,
border: "1px solid rgba(255,255,255,.08)",
background: locked ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.05)",
color: "white",
opacity: locked ? 0.46 : 1,
cursor: locked ? "not-allowed" : "pointer",
transition: "transform .14s ease, border-color .18s ease, opacity .18s ease",
animation: !locked && installedCount > 0 ? "pyronCardPulse 2.8s ease-in-out infinite" : undefined,
}}
>
<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
<div
style={{
width: 22,
height: 22,
borderRadius: "50%",
background: meta.color,
boxShadow: `0 0 20px ${meta.glow}`,
flexShrink: 0,
}}
/>

<div style={{ textAlign: "left" }}>
<div
style={{
fontSize: 16,
fontWeight: 700,
}}
>
{meta.name}
</div>

<div
style={{
fontSize: 13,
color: "rgba(255,255,255,.58)",
marginTop: 4,
}}
>
{meta.description}
</div>
</div>
</div>

<div
style={{
display: "grid",
gap: 4,
justifyItems: "end",
minWidth: 54,
}}
>
<div
style={{
fontSize: 22,
fontWeight: 800,
}}
>
{cost}
</div>

{installedCount > 0 && (
<div
style={{
fontSize: 12,
color: meta.color,
fontWeight: 700,
}}
>
+{installedCount}
</div>
)}
</div>
</button>
);
}