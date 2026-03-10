import Link from "next/link";

const links = [
{ href: "/axis-camera", label: "Axis Camera" },
{ href: "/axis", label: "Axis Run" },
{ href: "/control", label: "Control" },
{ href: "/sessions", label: "Sessions" },
{ href: "/states", label: "States" },
{ href: "/research", label: "Research" },
];

export default function HomePage() {
return (
<main
style={{
minHeight: "100vh",
background:
"radial-gradient(circle at top, #0b1220 0%, #06080d 45%, #030406 100%)",
color: "#f5f7fb",
padding: "32px 20px",
display: "flex",
alignItems: "center",
justifyContent: "center",
}}
>
<div
style={{
width: "100%",
maxWidth: 980,
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 28,
padding: 24,
background: "rgba(255,255,255,0.03)",
boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
backdropFilter: "blur(12px)",
}}
>
<div style={{ marginBottom: 28 }}>
<div
style={{
fontSize: 12,
letterSpacing: "0.28em",
textTransform: "uppercase",
opacity: 0.6,
marginBottom: 10,
}}
>
Axis OS
</div>

<h1
style={{
margin: 0,
fontSize: "clamp(2.2rem, 5vw, 4.5rem)",
lineHeight: 0.95,
letterSpacing: "-0.04em",
}}
>
Measurement
<br />
System
</h1>

<p
style={{
marginTop: 16,
maxWidth: 640,
fontSize: 16,
lineHeight: 1.6,
color: "rgba(245,247,251,0.72)",
}}
>
Clean route reset. Camera is at <strong>/axis-camera</strong>. Run
instrument is at <strong>/axis</strong>.
</p>
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
gap: 14,
}}
>
{links.map((link) => (
<Link
key={link.href}
href={link.href}
style={{
display: "block",
padding: "18px 18px",
borderRadius: 18,
border: "1px solid rgba(255,255,255,0.12)",
color: "#f5f7fb",
background:
"linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
fontSize: 15,
letterSpacing: "0.08em",
textTransform: "uppercase",
}}
>
{link.label}
</Link>
))}
</div>
</div>
</main>
);
}