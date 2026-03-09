import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
title: "Axis",
description: "Axis structure instrument",
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