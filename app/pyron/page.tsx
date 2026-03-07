"use client";

import PyronScene from "../../components/pyron/PyronScene";

export default function PyronPage() {
return (
<main
style={{
position: "relative",
width: "100vw",
height: "100dvh",
overflow: "hidden",
background: "#020406",
color: "white",
}}
>
<div
style={{
position: "absolute",
inset: 0,
zIndex: 0,
}}
>
<PyronScene />
</div>

<div
style={{
position: "absolute",
inset: 0,
zIndex: 2,
pointerEvents: "none",
display: "flex",
flexDirection: "column",
justifyContent: "space-between",
}}
>
<header
style={{
pointerEvents: "auto",
display: "flex",
alignItems: "center",
justifyContent: "space-between",
padding: "20px 18px 0 18px",
}}
>
<div
style={{
fontSize: 18,
fontWeight: 600,
letterSpacing: "-0.02em",
color: "rgba(255,255,255,0.92)",
textShadow: "0 0 24px rgba(0,0,0,0.5)",
}}
>
Axis
</div>

<div
style={{
display: "flex",
gap: 10,
padding: 6,
borderRadius: 999,
background: "rgba(0,0,0,0.22)",
border: "1px solid rgba(255,255,255,0.08)",
backdropFilter: "blur(16px)",
WebkitBackdropFilter: "blur(16px)",
boxShadow: "0 10px 40px rgba(0,0,0,0.28)",
}}
>
<button
style={pillButton(false)}
onClick={() => (window.location.href = "/measure")}
>
Measure
</button>
<button style={pillButton(true)}>Pyron</button>
</div>
</header>

<footer
style={{
pointerEvents: "none",
padding: "0 18px 18px 18px",
}}
>
<div
style={{
margin: "0 auto",
width: "min(560px, calc(100vw - 36px))",
borderRadius: 24,
background: "rgba(0,0,0,0.18)",
border: "1px solid rgba(255,255,255,0.08)",
backdropFilter: "blur(18px)",
WebkitBackdropFilter: "blur(18px)",
boxShadow: "0 10px 50px rgba(0,0,0,0.25)",
padding: "12px 16px",
}}
>
<div
style={{
display: "flex",
justifyContent: "space-between",
gap: 16,
fontSize: 12,
letterSpacing: "0.14em",
textTransform: "uppercase",
color: "rgba(255,255,255,0.58)",
}}
>
<span>Form</span>
<span>Signal</span>
<span>Energy</span>
</div>

<div
style={{
marginTop: 8,
display: "flex",
justifyContent: "space-between",
gap: 16,
fontSize: 16,
fontWeight: 600,
color: "rgba(255,255,255,0.92)",
}}
>
<span>In Control</span>
<span>Clean</span>
<span>Low</span>
</div>
</div>
</footer>
</div>
</main>
);
}

function pillButton(active: boolean): React.CSSProperties {
return {
pointerEvents: "auto",
border: "1px solid rgba(255,255,255,0.08)",
background: active ? "rgba(23,120,96,0.42)" : "rgba(255,255,255,0.04)",
color: "rgba(255,255,255,0.92)",
borderRadius: 999,
padding: "12px 22px",
fontSize: 16,
fontWeight: 600,
cursor: "pointer",
minWidth: 112,
boxShadow: active ? "0 0 24px rgba(54,255,214,0.14)" : "none",
};
}