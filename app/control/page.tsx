import Link from "next/link";

export default function ControlPage() {
return (
<main
style={{
minHeight: "100vh",
background: "#05070b",
color: "#f5f7fb",
padding: "32px 20px",
}}
>
<div
style={{
maxWidth: 860,
margin: "0 auto",
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 24,
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
marginBottom: 12,
}}
>
Axis Control
</div>

<h1 style={{ margin: 0, fontSize: 40 }}>Control</h1>

<p style={{ opacity: 0.72, lineHeight: 1.6, marginTop: 14 }}>
Placeholder control route. Keep this page alive so routing is clean
while the live controller gets rebuilt.
</p>

<div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
<Link
href="/axis-camera"
style={{
padding: "14px 18px",
borderRadius: 14,
textDecoration: "none",
color: "#f5f7fb",
border: "1px solid rgba(255,255,255,0.12)",
}}
>
Open Camera
</Link>

<Link
href="/axis"
style={{
padding: "14px 18px",
borderRadius: 14,
textDecoration: "none",
color: "#f5f7fb",
border: "1px solid rgba(255,255,255,0.12)",
}}
>
Open Run
</Link>
</div>
</div>
</main>
);
}