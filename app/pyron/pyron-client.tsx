"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "axis_pyron_state_v3";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type NodeType = "storage" | "amplifier" | "stabilizer" | "relay";

type NodeItem = {
id: string;
type: NodeType;
socketIndex: number;
};

type SavedState = {
charge: number;
hold: number;
surge: number;
nodes: NodeItem[];
};

function clamp(value: number, min: number, max: number) {
return Math.max(min, Math.min(max, value));
}

function getStage(charge: number): Stage {
if (charge < 50) return "Seed";
if (charge < 150) return "Core";
if (charge < 400) return "Pulse";
if (charge < 1000) return "Nova";
return "Titan";
}

function getNextStageTarget(stage: Stage) {
if (stage === "Seed") return 50;
if (stage === "Core") return 150;
if (stage === "Pulse") return 400;
if (stage === "Nova") return 1000;
return 1000;
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

function getSocketPositions(count: number) {
if (count <= 0) return [];
const radius = 148;
const startAngle = -90;

return Array.from({ length: count }, (_, i) => {
const angle = ((360 / count) * i + startAngle) * (Math.PI / 180);
return {
x: Math.cos(angle) * radius,
y: Math.sin(angle) * radius,
};
});
}

function nodeLabel(type: NodeType) {
if (type === "storage") return "Storage";
if (type === "amplifier") return "Amplifier";
if (type === "stabilizer") return "Stabilizer";
return "Relay";
}

function nodeShort(type: NodeType) {
if (type === "storage") return "S";
if (type === "amplifier") return "A";
if (type === "stabilizer") return "Z";
return "R";
}

export default function PyronClient() {
const [ready, setReady] = useState(false);
const [charge, setCharge] = useState(0);
const [hold, setHold] = useState(68);
const [surge, setSurge] = useState(0);
const [surgeActive, setSurgeActive] = useState(false);
const [nodes, setNodes] = useState<NodeItem[]>([]);
const [pulseOn, setPulseOn] = useState(false);
const [strikeOn, setStrikeOn] = useState(false);
const [tuned, setTuned] = useState(false);
const [flash, setFlash] = useState(false);
const [status, setStatus] = useState("Awaiting signal");
const [notice, setNotice] = useState("Core tap tunes Strike");
const [lastFeedAt, setLastFeedAt] = useState<number | null>(null);

const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const strikeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const tunedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
try {
const raw = window.localStorage.getItem(STORAGE_KEY);
if (raw) {
const parsed = JSON.parse(raw) as SavedState;
setCharge(clamp(parsed.charge ?? 0, 0, 3000));
setHold(clamp(parsed.hold ?? 68, 0, 100));
setSurge(clamp(parsed.surge ?? 0, 0, 100));
setNodes(Array.isArray(parsed.nodes) ? parsed.nodes : []);
}
} catch {
window.localStorage.removeItem(STORAGE_KEY);
} finally {
setReady(true);
}
}, []);

useEffect(() => {
if (!ready) return;
const state: SavedState = { charge, hold, surge, nodes };
window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}, [ready, charge, hold, surge, nodes]);

const stage = useMemo(() => getStage(charge), [charge]);
const nextStageTarget = useMemo(() => getNextStageTarget(stage), [stage]);
const socketLimit = useMemo(() => getSocketLimit(stage), [stage]);
const ringCount = useMemo(() => getRingCount(stage), [stage]);
const sockets = useMemo(() => getSocketPositions(socketLimit), [socketLimit]);

const counts = useMemo(() => {
const storage = nodes.filter((n) => n.type === "storage").length;
const amplifier = nodes.filter((n) => n.type === "amplifier").length;
const stabilizer = nodes.filter((n) => n.type === "stabilizer").length;
const relay = nodes.filter((n) => n.type === "relay").length;
return { storage, amplifier, stabilizer, relay };
}, [nodes]);

const maxCharge = 1000 + counts.storage * 140;
const feedMultiplier = 1 + counts.amplifier * 0.25 + (surgeActive ? 0.35 : 0);
const holdSupport = counts.stabilizer * 0.3;
const surgeAssist = counts.relay * 2;

const progress = stage === "Titan"
? 100
: clamp((charge / nextStageTarget) * 100, 0, 100);

function pulseFlash(text: string) {
setStatus(text);
setFlash(true);
if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
flashTimeoutRef.current = setTimeout(() => setFlash(false), 180);

if (typeof navigator !== "undefined" && "vibrate" in navigator) {
navigator.vibrate(15);
}
}

useEffect(() => {
const intervalMs = surgeActive ? 1050 : 1450;

const interval = setInterval(() => {
setPulseOn(true);

if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
pulseTimeoutRef.current = setTimeout(() => setPulseOn(false), 220);

const strikeChanceBase = tuned ? 0.9 : 0.35;
const strikeChance = clamp(strikeChanceBase + hold / 200, 0, 0.96);

if (Math.random() < strikeChance) {
setStrikeOn(true);
setNotice("Strike window open");

if (strikeTimeoutRef.current) clearTimeout(strikeTimeoutRef.current);
strikeTimeoutRef.current = setTimeout(() => {
setStrikeOn(false);
setNotice("Core tap tunes Strike");
}, surgeActive ? 320 : 240);
}
}, intervalMs);

return () => clearInterval(interval);
}, [hold, tuned, surgeActive]);

useEffect(() => {
const decay = setInterval(() => {
setCharge((c) => Math.max(0, c - Math.max(1, 2 - holdSupport)));
setSurge((s) => Math.max(0, s - (surgeActive ? 2.4 : 0.7)));
setHold((h) => clamp(h - (surgeActive ? 1.2 : 0.55) + holdSupport * 0.25, 0, 100));
}, 2500);

return () => clearInterval(decay);
}, [surgeActive, holdSupport]);

useEffect(() => {
if (surge >= 100 && !surgeActive) {
setSurgeActive(true);
pulseFlash("Surge active");
setNotice("Feed signal while Surge is active");
}
}, [surge, surgeActive]);

useEffect(() => {
if (surgeActive && (surge <= 12 || hold <= 8)) {
setSurgeActive(false);
setSurge((s) => clamp(s, 0, 30));
setNotice("Core tap tunes Strike");
pulseFlash(hold <= 8 ? "Surge lost" : "Surge ended");
}
}, [surgeActive, surge, hold]);

function handleCoreTap() {
setTuned(true);
setHold((h) => clamp(h + (strikeOn ? 7 : 3), 0, 100));
setSurge((s) => clamp(s + (strikeOn ? 6 : 2), 0, 100));
pulseFlash(strikeOn ? "Core tuned on Strike" : "Core tuned");

if (tunedTimeoutRef.current) clearTimeout(tunedTimeoutRef.current);
tunedTimeoutRef.current = setTimeout(() => {
setTuned(false);
}, 1400);
}

function feedSignal(base = 16) {
const withinRhythm = lastFeedAt && Date.now() - lastFeedAt < 1800;
const strikeBonus = strikeOn ? 1.8 : 1;
const tunedBonus = tuned ? 1.25 : 1;
const rhythmBonus = withinRhythm ? 1.15 : 1;
const total = Math.round(base * feedMultiplier * strikeBonus * tunedBonus * rhythmBonus);

setCharge((c) => clamp(c + total, 0, maxCharge));
setSurge((s) => clamp(s + 12 + surgeAssist + (strikeOn ? 8 : 0), 0, 100));
setHold((h) => clamp(h + (strikeOn ? 5 : 2), 0, 100));
setLastFeedAt(Date.now());

if (strikeOn) {
pulseFlash(`Signal converted with Strike +${total}`);
} else if (tuned) {
pulseFlash(`Signal converted +${total}`);
} else {
pulseFlash(`Signal fed +${total}`);
}
}

function nextOpenSocketIndex() {
for (let i = 0; i < socketLimit; i += 1) {
const taken = nodes.some((n) => n.socketIndex === i);
if (!taken) return i;
}
return -1;
}

function addNode(type: NodeType) {
if (socketLimit === 0) {
pulseFlash("No sockets unlocked");
setNotice("Build Charge to unlock sockets");
return;
}

if (nodes.length >= socketLimit) {
pulseFlash("All sockets filled");
setNotice("Advance stage to unlock more sockets");
return;
}

const cost = type === "storage" ? 40 : type === "amplifier" ? 60 : type === "stabilizer" ? 80 : 100;

if (charge < cost) {
pulseFlash("Not enough Charge");
setNotice(`${cost} Charge needed for ${nodeLabel(type)}`);
return;
}

const socketIndex = nextOpenSocketIndex();
if (socketIndex === -1) return;

const item: NodeItem = {
id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
type,
socketIndex,
};

setCharge((c) => Math.max(0, c - cost));
setNodes((prev) => [...prev, item]);

if (type === "storage") {
setHold((h) => clamp(h + 4, 0, 100));
setSurge((s) => clamp(s + 4, 0, 100));
}

if (type === "amplifier") {
setHold((h) => clamp(h - 3, 0, 100));
setSurge((s) => clamp(s + 8, 0, 100));
}

if (type === "stabilizer") {
setHold((h) => clamp(h + 10, 0, 100));
setSurge((s) => clamp(s + 3, 0, 100));
}

if (type === "relay") {
setHold((h) => clamp(h + 2, 0, 100));
setSurge((s) => clamp(s + 10, 0, 100));
}

pulseFlash(`${nodeLabel(type)} added`);
setNotice("Feed more signal");
}

function resetSystem() {
setCharge(0);
setHold(68);
setSurge(0);
setSurgeActive(false);
setNodes([]);
setPulseOn(false);
setStrikeOn(false);
setTuned(false);
setStatus("System reset");
setNotice("Core tap tunes Strike");
setLastFeedAt(null);
window.localStorage.removeItem(STORAGE_KEY);
}

const shellGlow = surgeActive ? 0.9 : 0.48;
const coreScale = pulseOn ? 1.06 : tuned ? 1.03 : 1;
const ringScale = pulseOn ? 1.025 : 1;

return (
<div
style={{
minHeight: "100dvh",
background:
"radial-gradient(circle at center, rgba(15,22,40,1) 0%, rgba(5,8,16,1) 58%, rgba(0,0,0,1) 100%)",
color: "white",
padding: "16px 14px 40px",
fontFamily:
"ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
}}
>
<div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 18 }}>
<div
style={{
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 12,
}}
>
<StatCard label="Charge" value={Math.round(charge)} sub={`${stage} stage`} />
<StatCard
label="Surge"
value={`${Math.round(surge)}%`}
sub={surgeActive ? "Active" : surge >= 80 ? "Building high" : "Building"}
/>
<StatCard
label="Hold"
value={`${Math.round(hold)}%`}
sub={hold > 55 ? "Tuned" : hold > 25 ? "Shifting" : "Low"}
/>
<StatCard
label="Sockets"
value={`${nodes.length} / ${socketLimit}`}
sub={socketLimit === 0 ? "Locked" : "Open system"}
/>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 24,
padding: 16,
background: "rgba(255,255,255,0.04)",
backdropFilter: "blur(14px)",
}}
>
<div
style={{
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 12,
flexWrap: "wrap",
marginBottom: 10,
}}
>
<div>
<div style={{ fontSize: 13, opacity: 0.72 }}>Pyron Core</div>
<div style={{ fontSize: 22, fontWeight: 800 }}>{stage}</div>
</div>

<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
<Badge active={pulseOn}>Pulse</Badge>
<Badge active={strikeOn}>Strike</Badge>
<Badge active={surgeActive}>Surge</Badge>
</div>
</div>

<div style={{ marginBottom: 14 }}>
<div
style={{
height: 10,
borderRadius: 999,
background: "rgba(255,255,255,0.08)",
overflow: "hidden",
}}
>
<div
style={{
width: `${progress}%`,
height: "100%",
borderRadius: 999,
background:
"linear-gradient(90deg, rgba(94,234,212,1) 0%, rgba(59,130,246,1) 100%)",
transition: "width 180ms ease",
}}
/>
</div>
<div style={{ fontSize: 12, opacity: 0.72, marginTop: 6 }}>
{stage === "Titan" ? "Titan reached" : `Next stage target: ${nextStageTarget}`}
</div>
</div>

<div
style={{
position: "relative",
width: "100%",
minHeight: 420,
display: "grid",
placeItems: "center",
overflow: "hidden",
}}
>
{[...Array(ringCount)].map((_, i) => (
<div
key={i}
style={{
position: "absolute",
width: 170 + i * 56,
height: 170 + i * 56,
borderRadius: "50%",
border: `1px solid rgba(120,180,255,${0.16 + i * 0.08})`,
boxShadow: pulseOn ? "0 0 24px rgba(90,140,255,0.12)" : "none",
transform: `scale(${ringScale})`,
transition: "transform 180ms ease, box-shadow 180ms ease",
}}
/>
))}

{sockets.map((pos, i) => {
const node = nodes.find((n) => n.socketIndex === i);
return (
<div
key={`socket-${i}`}
style={{
position: "absolute",
left: "50%",
top: "50%",
transform: `translate(${pos.x}px, ${pos.y}px)`,
width: 42,
height: 42,
marginLeft: -21,
marginTop: -21,
borderRadius: "50%",
display: "grid",
placeItems: "center",
border: node
? "1px solid rgba(255,255,255,0.42)"
: "1px dashed rgba(255,255,255,0.22)",
background: node
? "rgba(255,255,255,0.08)"
: "rgba(255,255,255,0.03)",
fontSize: 13,
fontWeight: 700,
color: "rgba(255,255,255,0.88)",
}}
title={node ? nodeLabel(node.type) : "Open socket"}
>
{node ? nodeShort(node.type) : ""}
</div>
);
})}

<button
onClick={handleCoreTap}
style={{
width: 148,
height: 148,
borderRadius: "50%",
border: strikeOn
? "1px solid rgba(255,255,255,0.62)"
: tuned
? "1px solid rgba(255,255,255,0.38)"
: "1px solid rgba(255,255,255,0.16)",
background: flash
? "radial-gradient(circle at center, rgba(96,165,250,0.96) 0%, rgba(37,99,235,0.48) 58%, rgba(15,23,42,0.25) 100%)"
: "radial-gradient(circle at center, rgba(59,130,246,0.84) 0%, rgba(37,99,235,0.32) 58%, rgba(15,23,42,0.18) 100%)",
boxShadow: `0 0 52px rgba(59,130,246,${shellGlow}), inset 0 0 40px rgba(255,255,255,0.06)`,
transform: `scale(${coreScale})`,
transition: "all 180ms ease",
color: "white",
cursor: "pointer",
}}
>
<div style={{ fontSize: 14, opacity: 0.78 }}>PYRON</div>
<div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
{strikeOn ? "TUNE" : "CORE"}
</div>
</button>
</div>

<div
style={{
display: "flex",
justifyContent: "space-between",
gap: 12,
flexWrap: "wrap",
marginTop: 8,
fontSize: 13,
opacity: 0.82,
}}
>
<div>{status}</div>
<div>{notice}</div>
</div>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 24,
padding: 16,
background: "rgba(255,255,255,0.04)",
}}
>
<div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Nodes</div>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 12,
}}
>
<NodeButton
label="Storage"
hint="40 Charge"
disabled={nodes.length >= socketLimit}
onClick={() => addNode("storage")}
/>
<NodeButton
label="Amplifier"
hint="60 Charge"
disabled={nodes.length >= socketLimit}
onClick={() => addNode("amplifier")}
/>
<NodeButton
label="Stabilizer"
hint="80 Charge"
disabled={nodes.length >= socketLimit}
onClick={() => addNode("stabilizer")}
/>
<NodeButton
label="Relay"
hint="100 Charge"
disabled={nodes.length >= socketLimit}
onClick={() => addNode("relay")}
/>
</div>

<div
style={{
marginTop: 14,
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 10,
fontSize: 13,
opacity: 0.82,
}}
>
<div>Storage: {counts.storage}</div>
<div>Amplifier: {counts.amplifier}</div>
<div>Stabilizer: {counts.stabilizer}</div>
<div>Relay: {counts.relay}</div>
</div>

<div
style={{
display: "flex",
gap: 10,
flexWrap: "wrap",
marginTop: 16,
}}
>
<button
onClick={() => feedSignal(16)}
style={{
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.18)",
background: "rgba(59,130,246,0.18)",
color: "white",
padding: "10px 14px",
cursor: "pointer",
fontWeight: 700,
}}
>
Feed Signal
</button>

<button
onClick={resetSystem}
style={{
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.18)",
background: "rgba(255,255,255,0.06)",
color: "white",
padding: "10px 14px",
cursor: "pointer",
}}
>
Reset
</button>
</div>

<div style={{ marginTop: 12, fontSize: 12, opacity: 0.62 }}>
Core tap tunes timing. Feed Signal is a temporary test input until Axis Measure drives Charge.
</div>
</div>
</div>
</div>
);
}

function StatCard({
label,
value,
sub,
}: {
label: string;
value: string | number;
sub: string;
}) {
return (
<div
style={{
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 20,
padding: 14,
background: "rgba(255,255,255,0.04)",
}}
>
<div style={{ fontSize: 12, opacity: 0.72 }}>{label}</div>
<div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{value}</div>
<div style={{ fontSize: 12, opacity: 0.64, marginTop: 4 }}>{sub}</div>
</div>
);
}

function Badge({
children,
active,
}: {
children: React.ReactNode;
active?: boolean;
}) {
return (
<div
style={{
borderRadius: 999,
padding: "8px 12px",
border: active
? "1px solid rgba(255,255,255,0.54)"
: "1px solid rgba(255,255,255,0.12)",
background: active ? "rgba(59,130,246,0.22)" : "rgba(255,255,255,0.04)",
fontSize: 12,
fontWeight: 700,
letterSpacing: 0.4,
}}
>
{children}
</div>
);
}

function NodeButton({
label,
hint,
disabled,
onClick,
}: {
label: string;
hint: string;
disabled?: boolean;
onClick: () => void;
}) {
return (
<button
onClick={onClick}
disabled={disabled}
style={{
borderRadius: 18,
border: "1px solid rgba(255,255,255,0.12)",
background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)",
color: "white",
padding: "14px 12px",
textAlign: "left",
cursor: disabled ? "not-allowed" : "pointer",
opacity: disabled ? 0.45 : 1,
}}
>
<div style={{ fontSize: 16, fontWeight: 800 }}>{label}</div>
<div style={{ fontSize: 12, opacity: 0.68, marginTop: 4 }}>{hint}</div>
</button>
);
}