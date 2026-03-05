import Link from "next/link";

const btn: React.CSSProperties = {
padding: "12px 14px",
borderRadius: 12,
border: "1px solid rgba(255,255,255,0.14)",
background: "rgba(255,255,255,0.05)",
color: "white",
textDecoration: "none",
display: "inline-flex",
alignItems: "center",
justifyContent: "space-between",
gap: 10,
};

export default function HomePage() {
return (
<main
style={{
minHeight: "100vh",
background: "#050505",
color: "white",
padding: 16,
fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
}}
>
<div style={{ maxWidth: 920, margin: "0 auto" }}>
<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
<div
style={{
width: 10,
height: 10,
borderRadius: 999,
background: "rgba(0,255,180,0.9)",
boxShadow: "0 0 14px rgba(0,255,180,0.35)",
}}
/>
<div style={{ fontSize: 18, fontWeight: 800 }}>Axis Measure</div>
</div>

<div style={{ marginTop: 10, opacity: 0.75, maxWidth: 640 }}>
Run captures the signal. Measure converts it into a result you can show.
</div>

<div
style={{
marginTop: 16,
display: "grid",
gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
gap: 10,
}}
>
<Link href="/run" style={btn}>
<span>Run</span>
<span style={{ opacity: 0.7 }}>Capture →</span>
</Link>

<Link href="/measure" style={{ ...btn, border: "1px solid rgba(0,255,180,0.25)" }}>
<span>Measure</span>
<span style={{ opacity: 0.7 }}>Result →</span>
</Link>

<Link href="/history" style={btn}>
<span>History</span>
<span style={{ opacity: 0.7 }}>Saved →</span>
</Link>

<Link href="/control" style={btn}>
<span>Control</span>
<span style={{ opacity: 0.7 }}>Remote →</span>
</Link>

<Link href="/states" style={btn}>
<span>States</span>
<span style={{ opacity: 0.7 }}>Vocabulary →</span>
</Link>
</div>

<div style={{ marginTop: 18, opacity: 0.6, fontSize: 12 }}>
Flow: Run → Tag Decision → Stop → Measure → Share
</div>
</div>
</main>
);
}