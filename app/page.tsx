// app/page.tsx
import Link from "next/link";

const cardStyle: React.CSSProperties = {
border: "1px solid rgba(255,255,255,0.12)",
borderRadius: 16,
padding: 16,
background: "rgba(255,255,255,0.03)",
textDecoration: "none",
color: "white",
display: "block",
};

export default function HomePage() {
return (
<main style={{ padding: 16 }}>
<div style={{ padding: "18px 0 8px" }}>
<div style={{ opacity: 0.75, fontSize: 13 }}>Axis</div>
<h1 style={{ margin: "6px 0 0", fontSize: 28 }}>
Structural Deviation Under Load
</h1>
<div style={{ marginTop: 10, opacity: 0.75, maxWidth: 720 }}>
Run captures signal. Measure converts it into a result you can show.
</div>
</div>

<div
style={{
display: "grid",
gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
gap: 12,
marginTop: 16,
}}
>
<Link href="/measure" style={cardStyle}>
<div style={{ fontWeight: 700, fontSize: 18 }}>Measure</div>
<div style={{ opacity: 0.7, marginTop: 6 }}>
Turn a window into a result card.
</div>
</Link>

<Link href="/run" style={cardStyle}>
<div style={{ fontWeight: 700, fontSize: 18 }}>Run</div>
<div style={{ opacity: 0.7, marginTop: 6 }}>
Live axis line + motion signal.
</div>
</Link>

<Link href="/history" style={cardStyle}>
<div style={{ fontWeight: 700, fontSize: 18 }}>History</div>
<div style={{ opacity: 0.7, marginTop: 6 }}>
Past sessions and exports.
</div>
</Link>

<Link href="/control" style={cardStyle}>
<div style={{ fontWeight: 700, fontSize: 18 }}>Control</div>
<div style={{ opacity: 0.7, marginTop: 6 }}>
Controller / pairing / remote.
</div>
</Link>
</div>

<div style={{ marginTop: 16, opacity: 0.6, fontSize: 12 }}>
Tip: You no longer need to type <b>/run</b>. Use the top nav.
</div>
</main>
);
}