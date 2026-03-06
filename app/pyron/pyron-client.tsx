"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const CHARGE_KEY = "axis_charge_v2";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type NodeType = "storage" | "amplifier" | "stabilizer" | "relay";

type NodeItem = {
id: string;
type: NodeType;
socketIndex: number;
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

function getStageThreshold(stage: Stage) {
if (stage === "Seed") return 50;
if (stage === "Core") return 150;
if (stage === "Pulse") return 400;
if (stage === "Nova") return 1000;
return 1000;
}

function clamp(value: number, min: number, max: number) {
return Math.max(min, Math.min(max, value));
}

function getSocketPositions(count: number) {
if (count <= 0) return [];
const radius = 150;
const startAngle = -90;

return Array.from({ length: count }, (_, i) => {
const angle = ((360 / count) * i + startAngle) * (Math.PI / 180);
return {
x: Math.cos(angle) * radius,
y: Math.sin(angle) * radius,
};
});
}

function niceNodeLabel(type: NodeType) {
if (type === "storage") return "Storage";
if (type === "amplifier") return "Amplifier";
if (type === "stabilizer") return "Stabilizer";
return "Relay";
}

export default function PyronClient() {
const [charge, setCharge] = useState(0);
const [nodes, setNodes] = useState<NodeItem[]>([]);
const [hold, setHold] = useState(72);
const [surge, setSurge] = useState(0);
const [surgeActive, setSurgeActive] = useState(false);
const [pulseOn, setPulseOn] = useState(false);
const [strikeOn, setStrikeOn] = useState(false);
const [lastAction, setLastAction] = useState("System idle");
const [limitMessage, setLimitMessage] = useState("");
const [flash, setFlash] = useState(false);

const strikeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
const saved = window.localStorage.getItem(CHARGE_KEY);
if (saved) {
const parsed = Number(saved);
if (!Number.isNaN(parsed)) setCharge(parsed);
}
}, []);

useEffect(() => {
window.localStorage.setItem(CHARGE_KEY, String(charge));
}, [charge]);

const stage = useMemo(() => getStage(charge), [charge]);
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

const maxCharge =
1000 +
counts.storage * 120 +
(surgeActive ? 120 : 0);

const gainMultiplier =
1 +
counts.amplifier * 0.2 +
(surgeActive ? 0.5 : 0);

const decayRate = Math.max(
1,
3 - counts.stabilizer * 0.4 - (surgeActive ? 0.5 : 0)
);

const stageTarget = getStageThreshold(stage);
const progressToNext = clamp((charge / stageTarget) * 100, 0, 100);

useEffect(() => {
const intervalMs = Math.max(700, 1500 - charge * 0.25);

const rhythm = setInterval(() => {
setPulseOn(true);
setStrikeOn(true);

if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
if (strikeTimeoutRef.current) clearTimeout(strikeTimeoutRef.current);

pulseTimeoutRef.current = setTimeout(() => {
setPulseOn(false);
}, 260);

strikeTimeoutRef.current = setTimeout(() => {
setStrikeOn(false);
}, Math.max(240, 420 - counts.stabilizer * 20));
}, intervalMs);

return () => clearInterval(rhythm);
}, [charge, counts.stabilizer]);

useEffect(() => {
const decay = setInterval(() => {
setCharge((c) => Math.max(0, c - decayRate));
setSurge((s) => Math.max(0, s - (surgeActive ? 1.6 : 0.6)));
setHold((h) => clamp(h - 0.35 + counts.stabilizer * 0.08, 0, 100));
}, 1800);

return () => clearInterval(decay);
}, [counts.stabilizer, decayRate, surgeActive]);

useEffect(() => {
if (surge >= 100 && !surgeActive) {
setSurgeActive(true);
setLastAction("Surge active");
setFlash(true);
setTimeout(() => setFlash(false), 260);
}
}, [surge, surgeActive]);

useEffect(() => {
if (surgeActive && (surge <= 15 || hold <= 10)) {
setSurgeActive(false);
setLastAction(hold <= 10 ? "Surge lost from low Hold" : "Surge ended");
setSurge((s) => clamp(s, 0, 40));
}
}, [surgeActive, surge, hold]);

function triggerFeedback(text: string) {
setLastAction(text);
setFlash(true);
setTimeout(() => setFlash(false), 180);

if (typeof navigator !== "undefined" && "vibrate" in navigator) {
navigator.vibrate(18);
}
}

function addCharge(base: number, hitStrike: boolean) {
const strikeBonus = hitStrike ? 1.7 : 1;
const total = Math.round(base * gainMultiplier * strikeBonus);

setCharge((c) => clamp(c + total, 0, maxCharge));
setSurge((s) => clamp(s + (hitStrike ? 16 : 8), 0, 100));
setHold((h) => clamp(h + (hitStrike ? 5 : 2), 0, 100));
}

function handleCoreTap() {
const hitStrike = strikeOn;
addCharge(12, hitStrike);
triggerFeedback(hitStrike ? "Strike hit on core" : "Core tapped");
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
setLimitMessage("Build more Charge to unlock sockets");
triggerFeedback("No sockets unlocked");
return;
}

if (nodes.length >= socketLimit) {
setLimitMessage("All sockets filled");
triggerFeedback("Socket limit reached");
return;
}

const socketIndex = nextOpenSocketIndex();
if (socketIndex === -1) {
setLimitMessage("No open socket");
triggerFeedback("No open socket");
return;
}

const hitStrike = strikeOn;
const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

setNodes((prev) => [...prev, { id, type, socketIndex }]);
setLimitMessage("");

if (type === "storage") {
addCharge(10, hitStrike);
setHold((h) => clamp(h + 2, 0, 100));
}

if (type === "amplifier") {
addCharge(14, hitStrike);
setHold((h) => clamp(h - 2, 0, 100));
}

if (type === "stabilizer") {
addCharge(8, hitStrike);
setHold((h) => clamp(h + 8, 0, 100));
}

if (type === "relay") {
addCharge(12, hitStrike);
setSurge((s) => clamp(s + 10, 0, 100));
}

triggerFeedback(
`${niceNodeLabel(type)} added${hitStrike ? " with Strike" : ""}`
);
}

function resetSystem() {
setCharge(0);
setNodes([]);
setHold(72);
setSurge(0);
setSurgeActive(false);
setLimitMessage("");
setLastAction("System reset");
window.localStorage.removeItem(CHARGE_KEY);
}

const shellGlow = surgeActive ? 0.95 : 0.55;
const coreScale = pulseOn ? 1.08 : 1;
const ringScale = pulseOn ? 1.03 : 1;

return (
<div
style={{
minHeight: "100dvh",
background:
"radial-gradient(circle at center, rgba(25,35,60,1) 0%, rgba(7,10,18,1) 55%, rgba(0,0,0,1) 100%)",
color: "white",
padding: "20px 16px 32px",
fontFamily:
"ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
}}
>
<div
style={{
maxWidth: 980,
margin: "0 auto",
display: "grid",
gridTemplateColumns: "1fr",
gap: 20,
}}
>
<div
style={{
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 12,
}}
>
<StatCard label="Charge" value={charge} sub={`${stage} stage`} />
<StatCard
label="Surge"
value={`${Math.round(surge)}%`}
sub={surgeActive ? "Active" : surge >= 80 ? "Ready" : "Building"}
/>
<StatCard label="Hold" value={`${Math.round(hold)}%`} sub={hold > 55 ? "Controlled" : hold > 25 ? "Shifting" : "Low"} />
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
padding: 18,
background: "rgba(255,255,255,0.04)",
backdropFilter: "blur(16px)",
}}
>
<div
style={{
display: "flex",
justifyContent: "space-between",
gap: 12,
alignItems: "center",
marginBottom: 12,
flexWrap: "wrap",
}}
>
<div>
<div style={{ fontSize: 13, opacity: 0.7 }}>Pyron Core</div>
<div style={{ fontSize: 22, fontWeight: 700 }}>{stage}</div>
</div>

<div
style={{
display: "flex",
gap: 8,
alignItems: "center",
flexWrap: "wrap",
}}
>
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
width: `${progressToNext}%`,
height: "100%",
borderRadius: 999,
background:
"linear-gradient(90deg, rgba(94,234,212,1) 0%, rgba(59,130,246,1) 100%)",
transition: "width 180ms ease",
}}
/>
</div>
<div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
Next stage target: {stageTarget}
</div>
</div>

<div
style={{
position: "relative",
width: "100%",
minHeight: 430,
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
width: 170 + i * 58,
height: 170 + i * 58,
borderRadius: "50%",
border: `1px solid rgba(120,180,255,${0.18 + i * 0.08})`,
transform: `scale(${ringScale})`,
transition: "transform 180ms ease, opacity 180ms ease",
boxShadow: pulseOn
? "0 0 20px rgba(120,180,255,0.12)"
: "none",
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
? "1px solid rgba(255,255,255,0.4)"
: "1px dashed rgba(255,255,255,0.22)",
background: node
? "rgba(255,255,255,0.08)"
: pulseOn
? "rgba(80,120,255,0.10)"
: "rgba(255,255,255,0.03)",
transition: "all 180ms ease",
fontSize: 10,
textTransform: "uppercase",
letterSpacing: 0.8,
}}
>
{node ? node.type.slice(0, 3) : ""}
</div>
);
})}

<button
onClick={handleCoreTap}
style={{
width: 140,
height: 140,
borderRadius: "50%",
border: strikeOn
? "1px solid rgba(255,255,255,0.65)"
: "1px solid rgba(255,255,255,0.18)",
background: flash
? "radial-gradient(circle at center, rgba(96,165,250,0.95) 0%, rgba(37,99,235,0.45) 55%, rgba(15,23,42,0.25) 100%)"
: "radial-gradient(circle at center, rgba(59,130,246,0.82) 0%, rgba(37,99,235,0.35) 55%, rgba(15,23,42,0.18) 100%)",
boxShadow: `0 0 50px rgba(59,130,246,${shellGlow}), inset 0 0 40px rgba(255,255,255,0.08)`,
transform: `scale(${coreScale})`,
transition:
"transform 180ms ease, box-shadow 180ms ease, background 180ms ease, border 180ms ease",
color: "white",
cursor: "pointer",
}}
>
<div style={{ fontSize: 14, opacity: 0.75 }}>PYRON</div>
<div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
{strikeOn ? "STRIKE" : "TAP"}
</div>
</button>
</div>

<div
style={{
display: "flex",
justifyContent: "space-between",
gap: 12,
flexWrap: "wrap",
alignItems: "center",
marginTop: 8,
}}
>
<div style={{ fontSize: 13, opacity: 0.8 }}>{lastAction}</div>
<div style={{ fontSize: 13, opacity: 0.8 }}>
{limitMessage || (strikeOn ? "Strike window open" : "Build Charge")}
</div>
</div>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 24,
padding: 18,
background: "rgba(255,255,255,0.04)",
}}
>
<div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
Nodes
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 12,
}}
>
<NodeButton
label="Storage"
hint="More capacity"
disabled={nodes.length >= socketLimit}
onClick={() => addNode("storage")}
/>
<NodeButton
label="Amplifier"
hint="More gain"
disabled={nodes.length >= socketLimit}
onClick={() => addNode("amplifier")}
/>
<NodeButton
label="Stabilizer"
hint="More control"
disabled={nodes.length >= socketLimit}
onClick={() => addNode("stabilizer")}
/>
<NodeButton
label="Relay"
hint="More reach"
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
opacity: 0.85,
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

<button
onClick={handleCoreTap}
style={{
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.18)",
background: "rgba(59,130,246,0.18)",
color: "white",
padding: "10px 14px",
cursor: "pointer",
}}
>
Build Charge
</button>
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
<div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
<div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{value}</div>
<div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>{sub}</div>
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
? "1px solid rgba(255,255,255,0.55)"
: "1px solid rgba(255,255,255,0.12)",
background: active ? "rgba(59,130,246,0.22)" : "rgba(255,255,255,0.04)",
fontSize: 12,
fontWeight: 700,
letterSpacing: 0.5,
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
<div style={{ fontSize: 16, fontWeight: 700 }}>{label}</div>
<div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{hint}</div>
</button>
);
}