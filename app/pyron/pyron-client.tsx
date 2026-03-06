"use client";

import { useEffect, useMemo, useState } from "react";

const CHARGE_KEY = "axis_charge_v1";

function getCharge() {
if (typeof window === "undefined") return 0;
const raw = localStorage.getItem(CHARGE_KEY);
return raw ? Number(raw) || 0 : 0;
}

function spendCharge(amount: number) {
const current = getCharge();
const next = Math.max(0, current - amount);
localStorage.setItem(CHARGE_KEY, String(next));
return next;
}

function getStage(charge: number) {
if (charge < 50) return "Spark";
if (charge < 150) return "Core";
if (charge < 400) return "Reactor";
if (charge < 800) return "Nova";
return "Titan";
}

function getCoreSize(stage: string) {
if (stage === "Spark") return 70;
if (stage === "Core") return 96;
if (stage === "Reactor") return 124;
if (stage === "Nova") return 152;
return 184;
}

function getRingCount(stage: string) {
if (stage === "Spark") return 0;
if (stage === "Core") return 1;
if (stage === "Reactor") return 2;
if (stage === "Nova") return 3;
return 4;
}

function getSocketLimit(stage: string) {
if (stage === "Spark") return 0;
if (stage === "Core") return 2;
if (stage === "Reactor") return 4;
if (stage === "Nova") return 6;
return 8;
}

type NodeType = "Storage" | "Amplifier" | "Stabilizer" | "Relay";

type NodeState = {
id: number;
type: NodeType;
};

const ALL_NODE_TYPES: NodeType[] = ["Storage", "Amplifier", "Stabilizer", "Relay"];

const NODE_COSTS: Record<NodeType, number> = {
Storage: 40,
Amplifier: 60,
Stabilizer: 80,
Relay: 100,
};

const NODE_COLORS: Record<NodeType, string> = {
Storage: "#34f5c5",
Amplifier: "#53c7ff",
Stabilizer: "#ffd166",
Relay: "#ff8fab",
};

export default function PyronClient() {
const [charge, setCharge] = useState(0);
const [nodes, setNodes] = useState<NodeState[]>([]);

useEffect(() => {
setCharge(getCharge());
}, []);

const stage = getStage(charge);
const coreSize = getCoreSize(stage);
const ringCount = getRingCount(stage);
const socketLimit = getSocketLimit(stage);

const sockets = useMemo(() => {
const count = socketLimit;
if (count === 0) return [];

const radius = coreSize / 2 + 52;

return Array.from({ length: count }).map((_, i) => {
const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
const x = Math.cos(angle) * radius;
const y = Math.sin(angle) * radius;
return { x, y };
});
}, [socketLimit, coreSize]);

const glow = useMemo(() => {
if (stage === "Spark") return "0 0 40px rgba(0,212,166,0.35)";
if (stage === "Core") return "0 0 70px rgba(0,212,166,0.45)";
if (stage === "Reactor") return "0 0 95px rgba(0,212,166,0.58)";
if (stage === "Nova") return "0 0 120px rgba(0,212,166,0.68)";
return "0 0 150px rgba(0,212,166,0.8)";
}, [stage]);

function unlockNode(type: NodeType) {
const cost = NODE_COSTS[type];

if (charge < cost) return;
if (nodes.length >= socketLimit) return;

const nextCharge = spendCharge(cost);
setCharge(nextCharge);

setNodes((prev) => [
...prev,
{
id: Date.now() + prev.length,
type,
},
]);
}

function resetPyron() {
localStorage.removeItem(CHARGE_KEY);
setCharge(0);
setNodes([]);
}

return (
<div
style={{
display: "grid",
gap: 18,
}}
>
<section
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 28,
background: "rgba(255,255,255,0.02)",
padding: 22,
textAlign: "center",
}}
>
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.6)",
marginBottom: 8,
}}
>
Pyron
</div>

<div
style={{
fontSize: 32,
fontWeight: 700,
letterSpacing: "-0.04em",
marginBottom: 6,
}}
>
{stage}
</div>

<div
style={{
fontSize: 15,
color: "rgba(255,255,255,0.68)",
marginBottom: 16,
}}
>
Living energy grown from Axis charge
</div>

<div
style={{
display: "flex",
justifyContent: "center",
gap: 24,
flexWrap: "wrap",
marginBottom: 22,
}}
>
<Stat label="Stored Charge" value={String(charge)} />
<Stat label="Rings" value={String(ringCount)} />
<Stat label="Nodes" value={`${nodes.length}/${socketLimit}`} />
</div>

<div
style={{
position: "relative",
width: 360,
height: 360,
maxWidth: "100%",
margin: "8px auto 20px",
borderRadius: 32,
background:
"radial-gradient(circle at center, rgba(0,212,166,0.08) 0%, rgba(255,255,255,0.01) 46%, rgba(255,255,255,0) 72%)",
overflow: "hidden",
}}
>
{Array.from({ length: ringCount }).map((_, i) => {
const size = coreSize + 72 + i * 42;
return (
<div
key={i}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: size,
height: size,
transform: "translate(-50%, -50%)",
borderRadius: "50%",
border: "1px solid rgba(0,212,166,0.22)",
boxShadow: "0 0 18px rgba(0,212,166,0.12)",
}}
/>
);
})}

{sockets.map((socket, index) => {
const node = nodes[index];
const baseSize = 26;

return (
<div
key={`${socket.x}-${socket.y}`}
style={{
position: "absolute",
left: "50%",
top: "50%",
transform: `translate(calc(-50% + ${socket.x}px), calc(-50% + ${socket.y}px))`,
}}
>
<div
style={{
width: baseSize,
height: baseSize,
borderRadius: "50%",
border: node
? `1px solid ${NODE_COLORS[node.type]}`
: "1px dashed rgba(255,255,255,0.18)",
background: node ? NODE_COLORS[node.type] : "transparent",
boxShadow: node ? `0 0 18px ${NODE_COLORS[node.type]}` : "none",
opacity: node ? 1 : 0.55,
}}
/>
</div>
);
})}

{nodes.map((node, index) => {
const socket = sockets[index];
if (!socket) return null;

return (
<div
key={node.id}
style={{
position: "absolute",
left: "50%",
top: "50%",
transform: `translate(calc(-50% + ${socket.x}px), calc(-50% + ${socket.y + 22}px))`,
fontSize: 11,
color: "rgba(255,255,255,0.75)",
whiteSpace: "nowrap",
}}
>
{node.type}
</div>
);
})}

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: coreSize,
height: coreSize,
transform: "translate(-50%, -50%)",
borderRadius: "50%",
background: "radial-gradient(circle, #20ffd7 0%, #09bcb1 50%, #04535c 100%)",
boxShadow: glow,
transition: "all .35s ease",
}}
/>

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: Math.max(18, coreSize * 0.18),
height: Math.max(18, coreSize * 0.18),
transform: "translate(-50%, -50%)",
borderRadius: "50%",
background: "rgba(255,255,255,0.35)",
filter: "blur(6px)",
}}
/>
</div>

<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.62)",
}}
>
Build the inner environment from charge.
</div>
</section>

<section
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 28,
background: "rgba(255,255,255,0.02)",
padding: 22,
}}
>
<div
style={{
fontSize: 14,
color: "rgba(255,255,255,0.6)",
marginBottom: 8,
}}
>
Build
</div>

<div
style={{
fontSize: 26,
fontWeight: 700,
letterSpacing: "-0.04em",
marginBottom: 18,
}}
>
Nodes
</div>

<div
style={{
display: "grid",
gap: 12,
}}
>
{ALL_NODE_TYPES.map((type) => {
const cost = NODE_COSTS[type];
const disabled = charge < cost || nodes.length >= socketLimit;

return (
<button
key={type}
onClick={() => unlockNode(type)}
disabled={disabled}
style={{
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 16,
border: "1px solid rgba(255,255,255,0.08)",
background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)",
color: "#fff",
borderRadius: 20,
padding: "16px 18px",
cursor: disabled ? "not-allowed" : "pointer",
opacity: disabled ? 0.5 : 1,
}}
>
<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
<div
style={{
width: 14,
height: 14,
borderRadius: "50%",
background: NODE_COLORS[type],
boxShadow: `0 0 14px ${NODE_COLORS[type]}`,
}}
/>
<div style={{ textAlign: "left" }}>
<div style={{ fontSize: 17, fontWeight: 700 }}>{type}</div>
<div style={{ fontSize: 13, color: "rgba(255,255,255,0.62)" }}>
{type === "Storage" && "Expands holding capacity"}
{type === "Amplifier" && "Strengthens output"}
{type === "Stabilizer" && "Settles the system"}
{type === "Relay" && "Extends the field"}
</div>
</div>
</div>

<div style={{ fontSize: 15, fontWeight: 700 }}>{cost}</div>
</button>
);
})}
</div>

<div
style={{
display: "flex",
gap: 12,
flexWrap: "wrap",
marginTop: 18,
}}
>
<button
onClick={resetPyron}
style={{
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.04)",
color: "#f5f7fa",
borderRadius: 18,
padding: "16px 22px",
fontSize: 17,
fontWeight: 700,
cursor: "pointer",
}}
>
Reset Pyron
</button>
</div>
</section>
</div>
);
}

function Stat({ label, value }: { label: string; value: string }) {
return (
<div
style={{
minWidth: 110,
}}
>
<div
style={{
fontSize: 13,
color: "rgba(255,255,255,0.58)",
marginBottom: 6,
}}
>
{label}
</div>
<div
style={{
fontSize: 20,
fontWeight: 700,
}}
>
{value}
</div>
</div>
);
}