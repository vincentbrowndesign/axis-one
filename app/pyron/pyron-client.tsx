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

function getSize(stage: string) {
if (stage === "Spark") return 70;
if (stage === "Core") return 100;
if (stage === "Reactor") return 130;
if (stage === "Nova") return 160;
return 200;
}

export default function PyronClient() {
const [charge, setCharge] = useState(0);

useEffect(() => {
setCharge(getCharge());
}, []);

const stage = getStage(charge);
const size = getSize(stage);

function unlockNode() {
if (charge < 40) return;
const next = spendCharge(40);
setCharge(next);
}

const glow = useMemo(() => {
if (stage === "Spark") return "0 0 40px rgba(0,212,166,0.35)";
if (stage === "Core") return "0 0 60px rgba(0,212,166,0.45)";
if (stage === "Reactor") return "0 0 80px rgba(0,212,166,0.55)";
if (stage === "Nova") return "0 0 100px rgba(0,212,166,0.65)";
return "0 0 130px rgba(0,212,166,0.8)";
}, [stage]);

return (
<div
style={{
padding: 40,
fontFamily: "sans-serif",
textAlign: "center",
}}
>
<h1>Pyron</h1>
<p>Living energy grown from Axis charge</p>

<h3>Stored Charge</h3>
<div style={{ fontSize: 28, marginBottom: 30 }}>{charge}</div>

<h3>Stage</h3>
<div style={{ fontSize: 24, marginBottom: 30 }}>{stage}</div>

<div
style={{
width: size,
height: size,
borderRadius: "50%",
margin: "40px auto",
background: "radial-gradient(circle, #00ffcc 0%, #007777 70%, #001111 100%)",
boxShadow: glow,
transition: "all .3s ease",
}}
/>

<button
onClick={unlockNode}
style={{
padding: "14px 24px",
fontSize: 18,
cursor: "pointer",
borderRadius: 16,
border: "1px solid rgba(255,255,255,0.14)",
background: "rgba(255,255,255,0.06)",
color: "#fff",
}}
>
Unlock Energy Node 40 Charge
</button>
</div>
);
}