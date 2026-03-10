export default function ResearchPage() {
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
maxWidth: 960,
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
Axis Research
</div>

<h1 style={{ margin: 0, fontSize: 40 }}>Research</h1>
<p style={{ opacity: 0.72, lineHeight: 1.6, marginTop: 14 }}>
Placeholder route for system notes, experiments, state definitions,
and future instrument documentation.
</p>
</div>
</main>
);
}