export default function SessionsPage() {
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
Axis Sessions
</div>

<h1 style={{ margin: 0, fontSize: 40 }}>Sessions</h1>
<p style={{ opacity: 0.72, lineHeight: 1.6, marginTop: 14 }}>
Placeholder route for session history, exports, and session review.
</p>
</div>
</main>
);
}