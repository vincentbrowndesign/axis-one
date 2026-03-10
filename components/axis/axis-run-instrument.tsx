"use client";

export default function AxisRunInstrument() {
return (
<main
style={{
minHeight: "100vh",
background:
"radial-gradient(circle at center, rgba(16,22,36,0.95) 0%, #05070b 60%, #020305 100%)",
color: "#f5f7fb",
padding:
"max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))",
}}
>
<div
style={{
maxWidth: 920,
margin: "0 auto",
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 28,
padding: 24,
background: "rgba(255,255,255,0.03)",
}}
>
<div
style={{
fontSize: 12,
letterSpacing: "0.28em",
textTransform: "uppercase",
opacity: 0.6,
marginBottom: 10,
}}
>
Axis Run
</div>

<h1 style={{ margin: 0, fontSize: 42 }}>Run Instrument</h1>

<p style={{ opacity: 0.72, lineHeight: 1.6, marginTop: 14 }}>
Clean placeholder for the run route while camera becomes the primary
instrument.
</p>
</div>
</main>
);
}