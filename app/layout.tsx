// app/layout.tsx
import React from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
title: "Axis Measure",
description: "Axis measures structural deviation under load.",
};

const navLinkStyle: React.CSSProperties = {
padding: "10px 12px",
borderRadius: 10,
border: "1px solid rgba(255,255,255,0.10)",
background: "rgba(255,255,255,0.04)",
color: "white",
textDecoration: "none",
fontSize: 14,
};

export default function RootLayout({
children,
}: {
children: React.ReactNode;
}) {
return (
<html lang="en">
<body
style={{
margin: 0,
background: "#050505",
color: "white",
fontFamily:
"system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
}}
>
{/* Global Top Nav */}
<div
style={{
position: "sticky",
top: 0,
zIndex: 50,
background: "rgba(5,5,5,0.85)",
backdropFilter: "blur(10px)",
borderBottom: "1px solid rgba(255,255,255,0.08)",
}}
>
<div
style={{
maxWidth: 1100,
margin: "0 auto",
padding: "12px 16px",
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 12,
flexWrap: "wrap",
}}
>
<Link
href="/"
style={{
display: "flex",
alignItems: "center",
gap: 10,
textDecoration: "none",
color: "white",
}}
>
<div
style={{
width: 10,
height: 10,
borderRadius: 999,
background: "rgba(0,255,180,0.9)",
boxShadow: "0 0 12px rgba(0,255,180,0.35)",
}}
/>
<div style={{ fontWeight: 700, letterSpacing: 0.2 }}>
Axis Measure
</div>
</Link>

<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
<Link href="/measure" style={navLinkStyle}>
Measure
</Link>
<Link href="/run" style={navLinkStyle}>
Run
</Link>
<Link href="/history" style={navLinkStyle}>
History
</Link>
<Link href="/control" style={navLinkStyle}>
Control
</Link>
<Link href="/states" style={navLinkStyle}>
States
</Link>
</div>
</div>
</div>

{/* Page Content */}
<div style={{ maxWidth: 1100, margin: "0 auto" }}>{children}</div>
</body>
</html>
);
}