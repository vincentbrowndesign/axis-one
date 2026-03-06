"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const BANK_KEY = "axis_shared_charge_v1";
const ACCENT = "rgba(78,245,225,1)";
const ACCENT_SOFT = "rgba(78,245,225,0.35)";
const ACCENT_DIM = "rgba(78,245,225,0.12)";

type Stage = "Seed" | "Core" | "Pulse" | "Nova" | "Titan";
type Mood = "Dormant" | "Calm" | "Awake" | "Bright" | "Charged";

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
return "Charged";
}

function getCoreSize(stage: Stage) {
if (stage === "Seed") return 156;
if (stage === "Core") return 172;
if (stage === "Pulse") return 194;
if (stage === "Nova") return 220;
return 246;
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
const radius = 156;
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
const [surgeOn, setSurgeOn] = useState(false);
const [touchGlow, setTouchGlow] = useState(false);

const previousBankRef = useRef<number | null>(null);
const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const surgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const touchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
const firstLoad = previousBankRef.current === null;
const increased =
previousBankRef.current !== null && bank > previousBankRef.current;

if (firstLoad || increased) {
setSurgeOn(true);
setPulseOn(true);

if (surgeTimeoutRef.current) clearTimeout(surgeTimeoutRef.current);
if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);

surgeTimeoutRef.current = setTimeout(() => {
setSurgeOn(false);
}, 1100);

pulseTimeoutRef.current = setTimeout(() => {
setPulseOn(false);
}, 260);
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
}, 240);
}, intervalMs);

return () => clearInterval(interval);
}, [stage]);

function handleOrbTouch() {
setTouchGlow(true);

if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
touchTimeoutRef.current = setTimeout(() => {
setTouchGlow(false);
}, 180);

if (typeof navigator !== "undefined" && "vibrate" in navigator) {
navigator.vibrate(12);
}
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

const chamberMinHeight = 640;

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
background: `linear-gradient(90deg, ${ACCENT} 0%, rgba(78,245,225,0.65) 100%)`,
transition: "width 220ms ease",
boxShadow: `0 0 18px ${ACCENT_SOFT}`,
}}
/>
</div>

<div
style={{
border: "1px solid rgba(255,255,255,0.08)",
borderRadius: 28,
minHeight: chamberMinHeight,
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
boxShadow: pulseOn || surgeOn ? `0 0 22px ${ACCENT_DIM}` : "none",
transform: `scale(${surgeOn ? 1.04 : pulseOn ? 1.02 : 1})`,
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
transform: `translate(${pos.x}px, ${pos.y}px) scale(${surgeOn ? 1.22 : pulseOn ? 1.14 : 1})`,
width: 18,
height: 18,
marginLeft: -9,
marginTop: -9,
borderRadius: "50%",
background:
surgeOn || pulseOn
? "rgba(78,245,225,0.96)"
: "rgba(78,245,225,0.55)",
boxShadow:
surgeOn || pulseOn ? `0 0 18px ${ACCENT_SOFT}` : "none",
transition: "all 180ms ease",
}}
/>
))}

<div
style={{
position: "absolute",
left: "50%",
top: "50%",
width: coreSize + 58,
height: coreSize + 58,
marginLeft: -(coreSize + 58) / 2,
marginTop: -(coreSize + 58) / 2,
borderRadius: "50%",
background: surgeOn
? "radial-gradient(circle, rgba(78,245,225,0.22) 0%, rgba(78,245,225,0.08) 55%, rgba(0,0,0,0) 100%)"
: touchGlow
? "radial-gradient(circle, rgba(78,245,225,0.14) 0%, rgba(78,245,225,0.05) 55%, rgba(0,0,0,0) 100%)"
: "radial-gradient(circle, rgba(78,245,225,0.08) 0%, rgba(78,245,225,0.03) 55%, rgba(0,0,0,0) 100%)",
transform: `scale(${surgeOn ? 1.12 : touchGlow ? 1.05 : 1})`,
transition: "all 220ms ease",
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
border: "1px solid rgba(255,255,255,0.12)",
background:
"radial-gradient(circle at 35% 35%, rgba(160,255,242,0.98) 0%, rgba(78,245,225,0.92) 26%, rgba(18,130,130,0.42) 58%, rgba(4,14,18,0.24) 100%)",
boxShadow: `0 0 ${44 + ringCount * 16}px rgba(78,245,225,${glowStrength}), inset 0 0 54px rgba(255,255,255,0.06)`,
transform: `scale(${surgeOn ? 1.08 : pulseOn ? 1.05 : touchGlow ? 1.02 : 1})`,
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
<div>
{surgeOn
? "Surge active"
: stage === "Titan"
? "Fully ignited"
: `Next ${nextTarget}`}
</div>
</div>
</div>
</div>
</div>
);
}