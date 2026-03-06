"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
{ href: "/measure", label: "Measure" },
{ href: "/pyron", label: "Pyron" },
];

export default function AxisTopNav() {
const pathname = usePathname();

return (
<header
style={{
position: "sticky",
top: 0,
zIndex: 20,
background: "#030303",
borderBottom: "1px solid rgba(255,255,255,0.08)",
}}
>
<div
style={{
maxWidth: 980,
margin: "0 auto",
padding: "16px 20px",
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: 16,
}}
>
<div
style={{
fontSize: 18,
fontWeight: 700,
letterSpacing: "-0.04em",
color: "#f5f7fa",
}}
>
Axis
</div>

<nav
style={{
display: "flex",
gap: 10,
alignItems: "center",
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
color: "#fff",
fontSize: 15,
fontWeight: 600,
padding: "10px 16px",
borderRadius: 999,
border: "1px solid rgba(255,255,255,0.1)",
background: active
? "rgba(0,212,166,0.14)"
: "rgba(255,255,255,0.03)",
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