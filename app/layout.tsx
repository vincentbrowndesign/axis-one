import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
title: "Axis",
description: "Axis measures structural readiness before action.",
};

export default function RootLayout({
children,
}: Readonly<{
children: React.ReactNode;
}>) {
return (
<html lang="en">
<body>{children}</body>
</html>
);
}