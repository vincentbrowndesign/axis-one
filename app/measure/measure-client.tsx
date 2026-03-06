"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const BANK_KEY = "axis_shared_charge_v1";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";

function getStage(charge: number): Stage {
if (charge < 50) return "Seed";
if (charge < 150) return "Core";
if (charge < 400) return "Pulse";
if (charge < 1000) return "Nova";
return "Titan";
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

function getCoreSize(stage: Stage) {
if (stage === "Seed") return 140;
if (stage === "Core") return 158;
if (stage === "Pulse") return 176;
if (stage === "Nova") return 196;
return 220;
}

function getStageProgress(charge: number, stage: Stage) {
if (stage === "Seed") return Math.min(100, (charge / 50) * 100);
if (stage === "Core") return Math.min(100, (charge / 150) * 100);
if (stage === "Pulse") return Math.min(100, (charge / 400) * 100);
if (stage === "Nova") return Math.min(100, (charge / 1000) * 100);
return 100;
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

export default function PyronClient() {
const [charge, setCharge] = useState(0);
const [pulseOn, setPulseOn] = useState(false);
const [spin, setSpin] = useState(0);
const [flare, setFlare] = useState(false);
const [petMood, setPetMood] = useState<"sleep" | "calm" | "awake" | "wild">("sleep");

const flareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
const readCharge = () => {
const raw = window.localStorage.getItem(BANK_KEY);
const value = raw ? Number(raw) : 0;
setCharge(Number.isFinite(value) ? value : 0);
};

readCharge();

const onChargeUpdate = (event: Event) => {
const custom = event as CustomEvent<number>;
if (typeof custom.detail === "number") {
setCharge(custom.detail);
} else {
readCharge();
}
};

const onStorage = () => readCharge();

window.addEventListener("axis-charge-updated", onChargeUpdate as EventListener);
window.addEventListener("storage", onStorage);

return () => {
window.removeEventListener("axis-charge-updated", onChargeUpdate as EventListener);
window.removeEventListener("storage", onStorage);
};
}, []);

const stage = useMemo(() => getStage(charge), [charge]);
const ringCount = useMemo(() => getRingCount(stage), [stage]);
const socketLimit = useMemo(() => getSocketLimit(stage), [stage]);
const coreSize = useMemo(() => getCoreSize(stage), [stage]);
const progress = useMemo(() => getStageProgress(charge, stage), [charge, stage]);
const sockets = useMemo(() => getSocketPositions(socketLimit), [socketLimit]);

useEffect(() => {
if (charge < 50) setPetMood("sleep");
else if (charge < 150) setPetMood("calm");
else if (charge < 400) setPetMood("awake");
else setPetMood("wild");
}, [charge]);

useEffect(() => {
const intervalMs =
stage === "Seed"
? 1700
: stage === "Core"
? 1350
: stage === "Pulse"
? 1100
: stage === "Nova"
? 900
: 760;

const interval = setInterval(() => {
setPulseOn(true);
setTimeout(() => setPulseOn(false), 240);
}, intervalMs);

return () => clearInterval(interval);
}, [stage]);

function triggerFlare(extraSpin = 0) {
setFlare(true);
setSpin((s) => s + extraSpin);

if (flareTimeoutRef.current) clearTimeout(flareTimeoutRef.current);
flareTimeoutRef.current = setTimeout(() => {
setFlare(false);
}, 220);

if (typeof navigator !== "undefined" && "vibrate" in navigator) {
navigator.vibrate(16);
}
}

function handleOrbTap() {
triggerFlare(22);
}

function handleOrbFlick(direction: 1 | -1) {
triggerFlare(direction * 60);
}

const moodLabel =
petMood === "sleep"
? "Dormant"
: petMood === "calm"
? "Calm"
: petMood === "awake"
? "Awake"
: "Charged";

const glowStrength =
stage === "Seed"
? 0.35
: stage === "Core"
? 0.5
: stage === "Pulse"
? 0.68
: stage === "Nova"
? 0.82
: 1;

return (
<div
style={{
minHeight: "100dvh",
background:
"radial-gradient(circle at center, rgba(8,14,30,1) 0%, rgba(4,8,18,1) 58%, rgba(0,0,0,1) 100%)",
color: "white",
padding: "16px 14px 36px",
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
<div style={{ fontSize: 22, fontWeight: 800 }}>{charge}</div>
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
background:
"linear-gradient(90deg, rgba(130,255,235,1) 0%, rgba(84,162,255,1) 100%)",
transition: "width 180ms ease",
boxShadow: "0 0 18px rgba(84,162,255,0.35)",
}}
/>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.1)",
borderRadius: 28,
minHeight: 620,
position: "relative",
overflow: "hidden",
background:
"radial-gradient(circle at center, rgba(28,56,120,0.22) 0%, rgba(7,12,24,0.5) 56%, rgba(0,0,0,0.35) 100%)",
}}
>
{[...Array(ringCount)].map((_, i) => (
<div
key={i}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: 190 + i * 74,
height: 190 + i * 74,
marginLeft: -(190 + i * 74) / 2,
marginTop: -(190 + i * 74) / 2,
borderRadius: "50%",
border: `1px solid rgba(120,180,255,${0.18 + i * 0.08})`,
boxShadow: pulseOn ? "0 0 28px rgba(100,160,255,0.14)" : "none",
transform: `scale(${pulseOn ? 1.025 : 1}) rotate(${spin * 0.08}deg)`,
transition: "transform 220ms ease, box-shadow 180ms ease",
}}
/>
))}

{sockets.map((pos, i) => (
<div
key={i}
style={{
position: "absolute",
left: "50%",
top: "50%",
transform: `translate(${pos.x}px, ${pos.y}px) scale(${pulseOn ? 1.15 : 1})`,
width: 18,
height: 18,
marginLeft: -9,
marginTop: -9,
borderRadius: "50%",
background: pulseOn
? "rgba(255,255,255,0.95)"
: "rgba(255,255,255,0.48)",
boxShadow: pulseOn ? "0 0 18px rgba(255,255,255,0.4)" : "none",
transition: "all 180ms ease",
}}
/>
))}

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: coreSize + 34,
height: coreSize + 34,
marginLeft: -(coreSize + 34) / 2,
marginTop: -(coreSize + 34) / 2,
borderRadius: "50%",
background: flare
? "radial-gradient(circle, rgba(145,220,255,0.22) 0%, rgba(60,140,255,0.08) 55%, rgba(0,0,0,0) 100%)"
: "radial-gradient(circle, rgba(145,220,255,0.08) 0%, rgba(60,140,255,0.03) 55%, rgba(0,0,0,0) 100%)",
transform: `scale(${flare ? 1.05 : 1})`,
transition: "all 180ms ease",
}}
/>

<div
onClick={handleOrbTap}
onTouchStart={() => triggerFlare(12)}
style={{
position: "absolute",
left: "50%",
top: "50%",
width: coreSize,
height: coreSize,
marginLeft: -coreSize / 2,
marginTop: -coreSize / 2,
borderRadius: "50%",
border: "1px solid rgba(255,255,255,0.16)",
background:
"radial-gradient(circle at 35% 35%, rgba(160,240,255,0.98) 0%, rgba(64,150,255,0.92) 24%, rgba(37,99,235,0.45) 58%, rgba(10,18,34,0.22) 100%)",
boxShadow: `0 0 ${44 + ringCount * 16}px rgba(59,130,246,${glowStrength}), inset 0 0 54px rgba(255,255,255,0.09)`,
transform: `scale(${pulseOn ? 1.06 : flare ? 1.03 : 1}) rotate(${spin}deg)`,
transition: "transform 240ms ease, box-shadow 200ms ease",
display: "grid",
placeItems: "center",
cursor: "pointer",
userSelect: "none",
}}
>
<div style={{ textAlign: "center", pointerEvents: "none" }}>
<div style={{ fontSize: 14, opacity: 0.78 }}>PYRON</div>
<div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
{moodLabel}
</div>
</div>
</div>

<button
onClick={() => handleOrbFlick(-1)}
style={{
position: "absolute",
left: 18,
bottom: 18,
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.05)",
color: "white",
padding: "10px 14px",
fontWeight: 700,
cursor: "pointer",
}}
>
Spin
</button>

<button
onClick={() => handleOrbFlick(1)}
style={{
position: "absolute",
right: 18,
bottom: 18,
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.12)",
background: "rgba(255,255,255,0.05)",
color: "white",
padding: "10px 14px",
fontWeight: 700,
cursor: "pointer",
}}
>
Flare
</button>
</div>
</div>
</div>
);
}