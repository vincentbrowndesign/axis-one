import type { Metadata } from "next";
import AxisTopNav from "@/components/AxisTopNav";
import "./globals.css";

export const metadata: Metadata = {
title: "Axis Measure",
description: "Axis reveals activity and turns it into charge.",
};

export default function RootLayout({
children,
}: Readonly<{
children: React.ReactNode;
}>) {
return (
<html lang="en">
<body
style={{
margin: 0,
background: "#050505",
color: "#f5f7fa",
fontFamily:
'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}}
>
<AxisTopNav />
<main
style={{
maxWidth: 920,
margin: "0 auto",
padding: "24px 20px 48px",
}}
>
{children}
</main>
</body>
</html>
);
}