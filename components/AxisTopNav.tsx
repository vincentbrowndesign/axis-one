"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AxisTopNav() {
const pathname = usePathname();

const items = [
{ href: "/measure", label: "Measure" },
];

return (
<header
style={{
position: "sticky",
top: 0,
zIndex: 20,
background: "#050505",
borderBottom: "1px solid rgba(255,255,255,0.08)",
}}
>
<div
style={{
maxWidth: 920,
margin: "0 auto",
padding: "18px 20px 16px",
}}
>
<div
style={{
display: "flex",
alignItems: "center",
gap: 12,
marginBottom: 16,
}}
>
<div
style={{
width: 12,
height: 12,
borderRadius: 999,
background: "#00d4a6",
boxShadow: "0 0 16px rgba(0,212,166,0.45)",
flexShrink: 0,
}}
/>
<div
style={{
fontSize: 18,
fontWeight: 700,
color: "#f5f7fa",
letterSpacing: "-0.02em",
}}
>
Axis Measure
</div>
</div>

<nav
style={{
display: "flex",
gap: 12,
flexWrap: "wrap",
}}
>
{items.map((item) => {
const active = pathname === item.href;

return (
<Link
key={item.href}
href={item.href}
style={{
textDecoration: "none",
color: active ? "#ffffff" : "rgba(255,255,255,0.9)",
background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
border: `1px solid ${active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.1)"}`,
borderRadius: 18,
padding: "14px 22px",
fontSize: 17,
lineHeight: 1,
minWidth: 110,
textAlign: "center",
boxShadow: active ? "0 0 0 1px rgba(255,255,255,0.02) inset" : "none",
}}
>
{item.label}
</Link>
);
})}
</nav>
</div>
</header>
);
}