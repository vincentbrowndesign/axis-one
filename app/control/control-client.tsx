"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

function getSid() {
if (typeof window === "undefined") return null;
const url = new URL(window.location.href);
return url.searchParams.get("sid");
}

export default function ControlClient() {
const [sid, setSid] = useState<string | null>(null);
const [scanning, setScanning] = useState(false);

const videoRef = useRef<HTMLVideoElement | null>(null);
const readerRef = useRef<BrowserMultiFormatReader | null>(null);

useEffect(() => {
const existing = getSid();
if (existing) setSid(existing);
}, []);

async function send(type: string) {
if (!sid) return;

await fetch("/api/remote", {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
sid,
type,
}),
});
}

const startScan = async () => {
try {
setScanning(true);

const reader = new BrowserMultiFormatReader();
readerRef.current = reader;

const video = videoRef.current;
if (!video) return;

const controls = await reader.decodeFromVideoDevice(
undefined,
video,
(result) => {
if (!result) return;

const text = result.getText();

try {
const url = new URL(text);
const newSid = url.searchParams.get("sid");

if (newSid) {
setSid(newSid);
setScanning(false);
controls.stop();
}
} catch {
setSid(text);
setScanning(false);
controls.stop();
}
}
);
} catch (e) {
console.error(e);
setScanning(false);
alert("Camera scan failed");
}
};

const stopScan = () => {
setScanning(false);
readerRef.current?.reset();
};

return (
<main className="min-h-screen bg-black text-white px-6 py-10">

<div className="max-w-xl mx-auto">

<h1 className="text-4xl font-semibold">Axis Controller</h1>

<div className="text-white/50 mt-2">
Session: {sid ?? "Not paired"}
</div>

{!sid && (
<div className="mt-6">

{!scanning ? (
<button
onClick={startScan}
className="px-6 py-4 rounded-xl bg-white text-black font-semibold"
>
Scan QR
</button>
) : (
<button
onClick={stopScan}
className="px-6 py-4 rounded-xl bg-white/10"
>
Stop Camera
</button>
)}

{scanning && (
<div className="mt-4 border border-white/10 rounded-xl overflow-hidden">
<video
ref={videoRef}
className="w-full h-[300px] object-cover"
/>
</div>
)}

</div>
)}

{sid && (

<div className="grid grid-cols-2 gap-4 mt-8">

<button
onClick={() => send("start")}
className="p-6 rounded-xl bg-white text-black font-semibold"
>
Start
</button>

<button
onClick={() => send("stop")}
className="p-6 rounded-xl bg-white/10"
>
Stop
</button>

<button
onClick={() => send("decision")}
className="p-6 rounded-xl bg-white/10"
>
Decision
</button>

<button
onClick={() => send("tag")}
className="p-6 rounded-xl bg-white/10"
>
Tag
</button>

</div>

)}

</div>

</main>
);
}