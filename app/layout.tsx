import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
title: "Axis Instrument",
description: "Axis movement measurement system",
};

export default function RootLayout({
children,
}: {
children: React.ReactNode;
}) {
return (
<html lang="en">
<body>

<div className="axis-shell">

{/* ambient instrument glow */}
<div className="axis-glow-layer" />

{/* instrument frame */}
<div className="axis-frame">

{children}

</div>

</div>

</body>
</html>
);
}