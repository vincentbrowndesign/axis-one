import type { Metadata } from "next";
import AxisTopNav from "@/components/AxisTopNav";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
title: "Axis",
description: "Axis reveals activity. Pyron stores energy.",
};

export default function RootLayout({
children,
}: Readonly<{
children: React.ReactNode;
}>) {
return (
<html lang="en" className={cn("font-sans", geist.variable)}>
<body
style={{
margin: 0,
background: "#030303",
color: "#f5f7fa",
fontFamily:
'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}}
>
<AxisTopNav />
<main
style={{
maxWidth: 980,
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