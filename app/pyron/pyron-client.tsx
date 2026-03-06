"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const BANK_KEY = "axis_shared_charge_v1";
const PYRON_STATE_KEY = "axis_pyron_build_v4";

const CYAN = "rgba(78,245,225,1)";
const CYAN_SOFT = "rgba(78,245,225,0.35)";
const CYAN_DIM = "rgba(78,245,225,0.12)";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type NodeType = "storage" | "amplifier" | "stabilizer" | "relay";

type NodeItem = {
id: string;
type: NodeType;
socketIndex: number;
};

type SavedPyronState = {
nodes: NodeItem[];
};

function getStage(bank: number): Stage {
if (bank < 50) return "Seed";
if (bank < 150) return "Core";
if (bank < 400) return "Pulse";
if (bank < 1000) return "Nova";
return "Titan";
}

function getCoreSize(stage: Stage) {
if (stage === "Seed") return 160;
if (stage === "Core") return 176;
if (stage === "Pulse") return 196;
if (stage === "Nova") return 220;
return 244;
}

function getRingCount(stage: Stage) {
if (stage === "Seed") return 0;
if (stage === "Core") return 1;
if (stage === "Pulse") return 2;
if (stage === "Nova") return 3;
return 4;
}

function getSocketLimit(stage: Stage) {
if (stage === "Seed") return 0;
if (stage === "Core") return 2;
if (stage === "Pulse") return 4;
if (stage === "Nova") return 6;
return 8;
}

function getNextTarget(stage: Stage) {
if (stage === "Seed") return 50;
if (stage === "Core") return 150;
if (stage === "Pulse") return 400;
if (stage === "Nova") return 1000;
return 1000;
}

function getProgress(bank: number, stage: Stage) {
if (stage === "Seed") return Math.min(100, (bank / 50) * 100);
if (stage === "Core") return Math.min(100, (bank / 150) * 100);
if (stage === "Pulse") return Math.min(100, (bank / 400) * 100);
if (stage === "Nova") return Math.min(100, (bank / 1000) * 100);
return 100;
}

function getSocketPositions(count: number) {
if (count <= 0) return [];
const radius = 158;
const startAngle = -90;

return Array.from({ length: count }, (_, i) => {
const angle = ((360 / count) * i + startAngle) * (Math.PI / 180);
return {
x: Math.cos(angle) * radius,
y: Math.sin(angle) * radius,
};
});
}

function nodeCost(type: NodeType) {
if (type === "storage") return 40;
if (type === "amplifier") return 60;
if (type === "stabilizer") return 80;
return 100;
}

function nodeColor(type: NodeType) {
if (type === "storage") return "rgba(78,245,225,0.96)";
if (type === "amplifier") return "rgba(82,179,255,0.96)";
if (type === "stabilizer") return "rgba(255,210,90,0.96)";
return "rgba(255,117,166,0.96)";
}

function nodeLabel(type: NodeType) {
if (type === "storage") return "Storage";
if (type === "amplifier") return "Amplifier";
if (type === "stabilizer") return "Stabilizer";
return "Relay";
}

export default function PyronClient() {
const [bank, setBank] = useState(0);
const [pulseOn, setPulseOn] = useState(false);
const [surgeOn, setSurgeOn] = useState(false);
const [touchGlow, setTouchGlow] = useState(false);
const [nodes, setNodes] = useState<NodeItem[]>([]);
const [deployIndex, setDeployIndex] = useState<number | null>(null);

const previousBankRef = useRef<number | null>(null);
const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const surgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const touchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const deployTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
const readBank = () => {
const raw = window.localStorage.getItem(BANK_KEY);
const value = raw ? Number(raw) : 0;
setBank(Number.isFinite(value) ? value : 0);
};

readBank();

const onChargeUpdate = (event: Event) => {
const custom = event as CustomEvent<number>;
if (typeof custom.detail === "number") {
setBank(custom.detail);
} else {
readBank();
}
};

const onStorage = () => readBank();

window.addEventListener("axis-charge-updated", onChargeUpdate as EventListener);
window.addEventListener("storage", onStorage);

return () => {
window.removeEventListener("axis-charge-updated", onChargeUpdate as EventListener);
window.removeEventListener("storage", onStorage);
};
}, []);

useEffect(() => {
try {
const raw = window.localStorage.getItem(PYRON_STATE_KEY);
if (!raw) return;
const parsed = JSON.parse(raw) as SavedPyronState;
if (Array.isArray(parsed.nodes)) {
setNodes(parsed.nodes);
}
} catch {
window.localStorage.removeItem(PYRON_STATE_KEY);
}
}, []);

useEffect(() => {
const saved: SavedPyronState = { nodes };
window.localStorage.setItem(PYRON_STATE_KEY, JSON.stringify(saved));
}, [nodes]);

const stage = useMemo(() => getStage(bank), [bank]);
const coreSize = useMemo(() => getCoreSize(stage), [stage]);
const ringCount = useMemo(() => getRingCount(stage), [stage]);
const socketLimit = useMemo(() => getSocketLimit(stage), [stage]);
const nextTarget = useMemo(() => getNextTarget(stage), [stage]);
const progress = useMemo(() => getProgress(bank, stage), [bank, stage]);
const sockets = useMemo(() => getSocketPositions(socketLimit), [socketLimit]);

const counts = useMemo(() => {
const storage = nodes.filter((n) => n.type === "storage").length;
const amplifier = nodes.filter((n) => n.type === "amplifier").length;
const stabilizer = nodes.filter((n) => n.type === "stabilizer").length;
const relay = nodes.filter((n) => n.type === "relay").length;
return { storage, amplifier, stabilizer, relay };
}, [nodes]);

function triggerSurge(socketIndex?: number) {
setSurgeOn(true);
setPulseOn(true);
setDeployIndex(socketIndex ?? null);

if (surgeTimeoutRef.current) clearTimeout(surgeTimeoutRef.current);
if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
if (deployTimeoutRef.current) clearTimeout(deployTimeoutRef.current);

pulseTimeoutRef.current = setTimeout(() => {
setPulseOn(false);
}, 240);

surgeTimeoutRef.current = setTimeout(() => {
setSurgeOn(false);
}, 700);

deployTimeoutRef.current = setTimeout(() => {
setDeployIndex(null);
}, 520);
}

useEffect(() => {
const firstLoad = previousBankRef.current === null;
const increased =
previousBankRef.current !== null && bank > previousBankRef.current;

if (firstLoad || increased) {
triggerSurge();
}

previousBankRef.current = bank;
}, [bank]);

useEffect(() => {
const intervalMs =
stage === "Seed"
? 1800
: stage === "Core"
? 1450
: stage === "Pulse"
? 1150
: stage === "Nova"
? 920
: 760;

const interval = setInterval(() => {
setPulseOn(true);

if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
pulseTimeoutRef.current = setTimeout(() => {
setPulseOn(false);
}, 220);
}, intervalMs);

return () => clearInterval(interval);
}, [stage]);

function writeBank(next: number) {
window.localStorage.setItem(BANK_KEY, String(next));
setBank(next);
window.dispatchEvent(
new CustomEvent("axis-charge-updated", {
detail: next,
})
);
}

function handleOrbTouch() {
setTouchGlow(true);

if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
touchTimeoutRef.current = setTimeout(() => {
setTouchGlow(false);
}, 160);

if (typeof navigator !== "undefined" && "vibrate" in navigator) {
navigator.vibrate(10);
}
}

function nextOpenSocketIndex() {
for (let i = 0; i < socketLimit; i += 1) {
const taken = nodes.some((n) => n.socketIndex === i);
if (!taken) return i;
}
return -1;
}

function igniteNode(type: NodeType) {
const cost = nodeCost(type);

if (socketLimit === 0) return;
if (nodes.length >= socketLimit) return;
if (bank < cost) return;

const socketIndex = nextOpenSocketIndex();
if (socketIndex === -1) return;

const item: NodeItem = {
id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
type,
socketIndex,
};

setNodes((prev) => [...prev, item]);
writeBank(bank - cost);
triggerSurge(socketIndex);

if (typeof navigator !== "undefined" && "vibrate" in navigator) {
navigator.vibrate(18);
}
}

function resetPyron() {
setNodes([]);
setDeployIndex(null);
window.localStorage.removeItem(PYRON_STATE_KEY);
}

const glowStrength =
stage === "Seed"
? 0.34
: stage === "Core"
? 0.48
: stage === "Pulse"
? 0.66
: stage === "Nova"
? 0.82
: 1;

return (
<div
style={{
minHeight: "100dvh",
background:
"radial-gradient(circle at center, rgba(6,12,18,1) 0%, rgba(2,6,10,1) 58%, rgba(0,0,0,1) 100%)",
color: "white",
padding: "16px 14px 40px",
fontFamily:
"ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
}}
>
<div
style={{
maxWidth: 900,
margin: "0 auto",
display: "grid",
gap: 16,
}}
>
<div
style={{
display: "flex",
justifyContent: "space-between",
alignItems: "end",
gap: 12,
}}
>
<div>
<div style={{ fontSize: 13, opacity: 0.58 }}>Pyron</div>
<div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.04em" }}>
{stage}
</div>
</div>

<div style={{ textAlign: "right" }}>
<div style={{ fontSize: 13, opacity: 0.58 }}>Bank</div>
<div style={{ fontSize: 22, fontWeight: 800 }}>{bank}</div>
</div>
</div>

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
background: `linear-gradient(90deg, ${CYAN} 0%, rgba(78,245,225,0.65) 100%)`,
transition: "width 220ms ease",
boxShadow: `0 0 18px ${CYAN_SOFT}`,
}}
/>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 28,
minHeight: 640,
position: "relative",
overflow: "hidden",
background:
"radial-gradient(circle at center, rgba(10,28,30,0.30) 0%, rgba(5,10,14,0.72) 56%, rgba(0,0,0,0.35) 100%)",
}}
>
{[...Array(ringCount)].map((_, i) => (
<div
key={i}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 190 + i * 76,
height: 190 + i * 76,
marginLeft: -(190 + i * 76) / 2,
marginTop: -(190 + i * 76) / 2,
borderRadius: "50%",
border: `1px solid rgba(78,245,225,${0.16 + i * 0.08})`,
boxShadow: pulseOn || surgeOn ? `0 0 18px ${CYAN_DIM}` : "none",
transform: `scale(${surgeOn ? 1.03 : pulseOn ? 1.015 : 1})`,
transition: "transform 180ms ease, box-shadow 180ms ease",
}}
/>
))}

{sockets.map((pos, i) => {
const built = nodes.find((n) => n.socketIndex === i);
const isDeploying = deployIndex === i;

return (
<div
key={i}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 18,
height: 18,
marginLeft: -9,
marginTop: -9,
borderRadius: "50%",
background: built
? nodeColor(built.type)
: "rgba(78,245,225,0.10)",
boxShadow: built
? `0 0 18px ${nodeColor(built.type)}`
: "none",
border: built
? "none"
: "1px dashed rgba(78,245,225,0.14)",
opacity: built ? 1 : 0.5,
transform: isDeploying
? `translate(${pos.x * 0.2}px, ${pos.y * 0.2}px) scale(0.6)`
: `translate(${pos.x}px, ${pos.y}px) scale(${surgeOn ? 1.08 : 1})`,
transition: isDeploying
? "transform 420ms cubic-bezier(.2,.8,.2,1), opacity 220ms ease"
: "transform 220ms ease, opacity 220ms ease, box-shadow 220ms ease",
}}
/>
);
})}

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: coreSize + 50,
height: coreSize + 50,
marginLeft: -(coreSize + 50) / 2,
marginTop: -(coreSize + 50) / 2,
borderRadius: "50%",
background: surgeOn
? "radial-gradient(circle, rgba(78,245,225,0.18) 0%, rgba(78,245,225,0.07) 55%, rgba(0,0,0,0) 100%)"
: touchGlow
? "radial-gradient(circle, rgba(78,245,225,0.12) 0%, rgba(78,245,225,0.04) 55%, rgba(0,0,0,0) 100%)"
: "radial-gradient(circle, rgba(78,245,225,0.07) 0%, rgba(78,245,225,0.02) 55%, rgba(0,0,0,0) 100%)",
transform: `scale(${surgeOn ? 1.08 : touchGlow ? 1.04 : 1})`,
transition: "all 180ms ease",
}}
/>

<div
onClick={handleOrbTouch}
onTouchStart={handleOrbTouch}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: coreSize,
height: coreSize,
marginLeft: -coreSize / 2,
marginTop: -coreSize / 2,
borderRadius: "50%",
border: "1px solid rgba(255,255,255,0.08)",
background:
"radial-gradient(circle at 35% 35%, rgba(220,255,250,0.98) 0%, rgba(78,245,225,0.92) 26%, rgba(18,130,130,0.42) 58%, rgba(4,14,18,0.24) 100%)",
boxShadow: `0 0 ${42 + ringCount * 14}px rgba(78,245,225,${glowStrength}), inset 0 0 48px rgba(255,255,255,0.04)`,
transform: `scale(${surgeOn ? 1.05 : pulseOn ? 1.03 : touchGlow ? 1.015 : 1})`,
transition: "transform 180ms ease, box-shadow 180ms ease",
display: "grid",
placeItems: "center",
cursor: "pointer",
userSelect: "none",
}}
/>

<div
style={{
position: "absolute",
left: 18,
right: 18,
bottom: 18,
display: "flex",
justifyContent: "space-between",
alignItems: "center",
gap: 12,
fontSize: 14,
opacity: 0.78,
}}
>
<div>{nodes.length} / {socketLimit}</div>
<div>{surgeOn ? "Surge" : `Next ${nextTarget}`}</div>
</div>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 24,
padding: 16,
background: "rgba(255,255,255,0.03)",
display: "grid",
gap: 12,
}}
>
<div style={{ fontSize: 13, opacity: 0.58 }}>Ignite</div>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
gap: 10,
}}
>
<MiniIgniteButton
label="Storage"
value="40"
color={nodeColor("storage")}
disabled={bank < 40 || nodes.length >= socketLimit || socketLimit === 0}
onClick={() => igniteNode("storage")}
/>
<MiniIgniteButton
label="Amplifier"
value="60"
color={nodeColor("amplifier")}
disabled={bank < 60 || nodes.length >= socketLimit || socketLimit === 0}
onClick={() => igniteNode("amplifier")}
/>
<MiniIgniteButton
label="Stabilizer"
value="80"
color={nodeColor("stabilizer")}
disabled={bank < 80 || nodes.length >= socketLimit || socketLimit === 0}
onClick={() => igniteNode("stabilizer")}
/>
<MiniIgniteButton
label="Relay"
value="100"
color={nodeColor("relay")}
disabled={bank < 100 || nodes.length >= socketLimit || socketLimit === 0}
onClick={() => igniteNode("relay")}
/>
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
gap: 8,
fontSize: 12,
opacity: 0.72,
}}
>
<div>S {counts.storage}</div>
<div>A {counts.amplifier}</div>
<div>Z {counts.stabilizer}</div>
<div>R {counts.relay}</div>
</div>

<div>
<button
onClick={resetPyron}
style={{
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.04)",
color: "#fff",
borderRadius: 16,
padding: "12px 16px",
fontSize: 16,
fontWeight: 700,
cursor: "pointer",
}}
>
Reset Pyron
</button>
</div>
</div>
</div>
</div>
);
}

function MiniIgniteButton({
label,
value,
color,
disabled,
onClick,
}: {
label: string;
value: string;
color: string;
disabled?: boolean;
onClick: () => void;
}) {
return (
<button
onClick={onClick}
disabled={disabled}
style={{
border: "1px solid rgba(255,255,255,0.08)",
background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)",
color: "#fff",
borderRadius: 18,
padding: "14px 12px",
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 10,
cursor: disabled ? "not-allowed" : "pointer",
opacity: disabled ? 0.45 : 1,
}}
>
<div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
<div
style={{
width: 14,
height: 14,
borderRadius: "50%",
background: color,
boxShadow: `0 0 14px ${color}`,
flexShrink: 0,
}}
/>
<div
style={{
fontSize: 15,
fontWeight: 700,
whiteSpace: "nowrap",
overflow: "hidden",
textOverflow: "ellipsis",
}}
>
{label}
</div>
</div>

<div
style={{
fontSize: 15,
fontWeight: 800,
opacity: 0.9,
flexShrink: 0,
}}
>
{value}
</div>
</button>
);
}