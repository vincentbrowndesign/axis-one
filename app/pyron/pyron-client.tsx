"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const BANK_KEY = "axis_shared_charge_v1";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type Mood = "Dormant" | "Calm" | "Awake" | "Bright" | "Wild";

function getStage(charge: number): Stage {
if (charge < 50) return "Seed";
if (charge < 150) return "Core";
if (charge < 400) return "Pulse";
if (charge < 1000) return "Nova";
return "Titan";
}

function getMood(charge: number): Mood {
if (charge < 50) return "Dormant";
if (charge < 150) return "Calm";
if (charge < 400) return "Awake";
if (charge < 1000) return "Bright";
return "Wild";
}

function getCoreSize(stage: Stage) {
if (stage === "Seed") return 150;
if (stage === "Core") return 168;
if (stage === "Pulse") return 188;
if (stage === "Nova") return 212;
return 236;
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

function getProgress(charge: number, stage: Stage) {
if (stage === "Seed") return Math.min(100, (charge / 50) * 100);
if (stage === "Core") return Math.min(100, (charge / 150) * 100);
if (stage === "Pulse") return Math.min(100, (charge / 400) * 100);
if (stage === "Nova") return Math.min(100, (charge / 1000) * 100);
return 100;
}

function getSocketPositions(count: number) {
if (count <= 0) return [];
const radius = 154;
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
const [bank, setBank] = useState(0);
const [pulseOn, setPulseOn] = useState(false);
const [igniting, setIgniting] = useState(false);
const [spin, setSpin] = useState(0);
const [flare, setFlare] = useState(false);

const previousBankRef = useRef<number | null>(null);
const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const igniteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const flareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

const stage = useMemo(() => getStage(bank), [bank]);
const mood = useMemo(() => getMood(bank), [bank]);
const coreSize = useMemo(() => getCoreSize(stage), [stage]);
const ringCount = useMemo(() => getRingCount(stage), [stage]);
const socketLimit = useMemo(() => getSocketLimit(stage), [stage]);
const nextTarget = useMemo(() => getNextTarget(stage), [stage]);
const progress = useMemo(() => getProgress(bank, stage), [bank, stage]);
const sockets = useMemo(() => getSocketPositions(socketLimit), [socketLimit]);

useEffect(() => {
const isFirstLoad = previousBankRef.current === null;
const bankIncreased =
previousBankRef.current !== null && bank > previousBankRef.current;

if (isFirstLoad || bankIncreased) {
setIgniting(true);
setPulseOn(true);

if (igniteTimeoutRef.current) clearTimeout(igniteTimeoutRef.current);
if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);

igniteTimeoutRef.current = setTimeout(() => {
setIgniting(false);
}, 900);

pulseTimeoutRef.current = setTimeout(() => {
setPulseOn(false);
}, 260);

if (bankIncreased) {
setSpin((s) => s + 18);
}
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
? 900
: 760;

const interval = setInterval(() => {
setPulseOn(true);

if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
pulseTimeoutRef.current = setTimeout(() => {
setPulseOn(false);
}, 240);
}, intervalMs);

return () => clearInterval(interval);
}, [stage]);

function triggerTouch(extraSpin = 24) {
setFlare(true);
setSpin((s) => s + extraSpin);

if (flareTimeoutRef.current) clearTimeout(flareTimeoutRef.current);
flareTimeoutRef.current = setTimeout(() => {
setFlare(false);
}, 220);

if (typeof navigator !== "undefined" && "vibrate" in navigator) {
navigator.vibrate(14);
}
}

const glowStrength =
stage === "Seed"
? 0.34
: stage === "Core"
? 0.5
: stage === "Pulse"
? 0.68
: stage === "Nova"
? 0.84
: 1;

const chamberMinHeight = 640;

return (
<div
style={{
minHeight: "100dvh",
background:
"radial-gradient(circle at center, rgba(8,14,30,1) 0%, rgba(4,8,18,1) 58%, rgba(0,0,0,1) 100%)",
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
background:
"linear-gradient(90deg, rgba(130,255,235,1) 0%, rgba(84,162,255,1) 100%)",
transition: "width 220ms ease",
boxShadow: "0 0 18px rgba(84,162,255,0.35)",
}}
/>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.1)",
borderRadius: 28,
minHeight: chamberMinHeight,
position: "relative",
overflow: "hidden",
background:
"radial-gradient(circle at center, rgba(28,56,120,0.22) 0%, rgba(7,12,24,0.52) 56%, rgba(0,0,0,0.35) 100%)",
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
border: `1px solid rgba(120,180,255,${0.18 + i * 0.08})`,
boxShadow: pulseOn ? "0 0 26px rgba(100,160,255,0.14)" : "none",
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
transform: `translate(${pos.x}px, ${pos.y}px) scale(${pulseOn || igniting ? 1.18 : 1})`,
width: 18,
height: 18,
marginLeft: -9,
marginTop: -9,
borderRadius: "50%",
background:
pulseOn || igniting
? "rgba(255,255,255,0.96)"
: "rgba(255,255,255,0.5)",
boxShadow:
pulseOn || igniting ? "0 0 18px rgba(255,255,255,0.42)" : "none",
transition: "all 180ms ease",
}}
/>
))}

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: coreSize + 52,
height: coreSize + 52,
marginLeft: -(coreSize + 52) / 2,
marginTop: -(coreSize + 52) / 2,
borderRadius: "50%",
background: igniting
? "radial-gradient(circle, rgba(180,235,255,0.24) 0%, rgba(80,150,255,0.10) 55%, rgba(0,0,0,0) 100%)"
: flare
? "radial-gradient(circle, rgba(160,230,255,0.16) 0%, rgba(70,140,255,0.06) 55%, rgba(0,0,0,0) 100%)"
: "radial-gradient(circle, rgba(140,220,255,0.08) 0%, rgba(60,140,255,0.03) 55%, rgba(0,0,0,0) 100%)",
transform: `scale(${igniting ? 1.12 : flare ? 1.05 : 1})`,
transition: "all 220ms ease",
}}
/>

<div
onClick={() => triggerTouch(28)}
onTouchStart={() => triggerTouch(18)}
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
"radial-gradient(circle at 35% 35%, rgba(170,240,255,0.98) 0%, rgba(78,158,255,0.96) 24%, rgba(37,99,235,0.46) 58%, rgba(10,18,34,0.22) 100%)",
boxShadow: `0 0 ${44 + ringCount * 16}px rgba(59,130,246,${glowStrength}), inset 0 0 54px rgba(255,255,255,0.09)`,
transform: `scale(${igniting ? 1.08 : pulseOn ? 1.06 : flare ? 1.03 : 1}) rotate(${spin}deg)`,
transition: "transform 240ms ease, box-shadow 220ms ease",
display: "grid",
placeItems: "center",
cursor: "pointer",
userSelect: "none",
}}
>
<div style={{ textAlign: "center", pointerEvents: "none" }}>
<div style={{ fontSize: 14, opacity: 0.78 }}>PYRON</div>
<div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>
{mood}
</div>
</div>
</div>

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
<div>{socketLimit > 0 ? `${socketLimit} sockets live` : "Dormant core"}</div>
<div>{stage === "Titan" ? "Fully ignited" : `Next ${nextTarget}`}</div>
</div>
</div>
</div>
</div>
);
}