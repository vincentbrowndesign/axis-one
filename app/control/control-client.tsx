"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

function getParam(name: string) {
if (typeof window === "undefined") return null;
const url = new URL(window.location.href);
return url.searchParams.get(name);
}

export default function ControlClient() {
const [sid, setSid] = useState<string>("");
const [scanning, setScanning] = useState(false);
const videoRef = useRef<HTMLVideoElement | null>(null);
const readerRef = useRef<BrowserMultiFormatReader | null>(null);

useEffect(() => {
const existing = getParam("sid");
if (existing) setSid(existing);
}, []);

const channelName = useMemo(() => (sid ? `axis-one-${sid}` : ""), [sid]);

// TODO: wire these to your realtime (Pusher) once sid exists.
const send = async (type: string, payload: any = {}) => {
if (!sid) return alert("No session id. Scan QR first.");
// You probably already have Pusher working. If you have a server route that triggers events:
// await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid, type, payload }) });
console.log("CONTROL SEND", { sid, channelName, type, payload });
alert(`Sent: ${type}`);
};

const startScan = async () => {
try {
setScanning(true);

if (!readerRef.current) readerRef.current = new BrowserMultiFormatReader();
const reader = readerRef.current;

const video = videoRef.current;
if (!video) throw new Error("Video element missing");

// Start camera + decode continuously
const controls = await reader.decodeFromVideoDevice(
undefined,
video,
(result, err) => {
if (result) {
const text = result.getText();
// expecting a URL like https://axismeasure.com/control?sid=xxxxx
try {
const u = new URL(text);
const nextSid = u.searchParams.get("sid");
if (nextSid) {
setSid(nextSid);
setScanning(false);
controls.stop();
// keep user on this page, but update URL to include sid
window.history.replaceState({}, "", `/control?sid=${encodeURIComponent(nextSid)}`);
} else {
alert("QR scanned but no sid found.");
}
} catch {
// If you ever encode raw sid, handle it too:
setSid(text);
setScanning(false);
controls.stop();
window.history.replaceState({}, "", `/control?sid=${encodeURIComponent(text)}`);
}
}
}
);

// If user stops scanning, make sure we stop camera
return () => controls.stop();
} catch (e: any) {
console.error(e);
setScanning(false);
alert(e?.message ?? "Camera scan failed");
}
};

const stopScan = async () => {
setScanning(false);
try {
readerRef.current?.reset();
} catch {}
};

return (
<main className="min-h-screen bg-black text-white px-5 py-8">
<div className="max-w-xl mx-auto">
<h1 className="text-4xl font-semibold tracking-tight">Axis One</h1>
<p className="text-white/60 mt-2">Controller</p>

<div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-sm text-white/60">Session</div>
<div className="mt-1 text-xl font-semibold break-all">{sid || "— (scan QR)"} </div>

<div className="mt-4 flex gap-3">
{!scanning ? (
<button
onClick={startScan}
className="rounded-2xl px-4 py-3 bg-white text-black font-semibold"
>
Scan QR
</button>
) : (
<button
onClick={stopScan}
className="rounded-2xl px-4 py-3 bg-white/10 border border-white/10 font-semibold"
>
Stop
</button>
)}

<button
onClick={() => {
const manual = prompt("Enter session id (sid):");
if (manual) {
setSid(manual);
window.history.replaceState({}, "", `/control?sid=${encodeURIComponent(manual)}`);
}
}}
className="rounded-2xl px-4 py-3 bg-white/10 border border-white/10 font-semibold"
>
Enter sid
</button>
</div>

{scanning && (
<div className="mt-5 rounded-3xl border border-white/10 bg-black/40 overflow-hidden">
<video ref={videoRef} className="w-full h-[320px] object-cover" muted playsInline />
<div className="p-3 text-xs text-white/50">
If camera permission is blocked: iOS Settings → Safari → Camera → Allow
</div>
</div>
)}
</div>

<div className="mt-6 grid grid-cols-2 gap-3">
<button
onClick={() => send("start")}
className="rounded-2xl px-4 py-4 bg-white/10 border border-white/10 font-semibold"
>
Start
</button>
<button
onClick={() => send("stop")}
className="rounded-2xl px-4 py-4 bg-white/10 border border-white/10 font-semibold"
>
Stop
</button>

<button
onClick={() => send("decision")}
className="rounded-2xl px-4 py-4 bg-white/10 border border-white/10 font-semibold"
>
Decision
</button>
<button
onClick={() => send("tag")}
className="rounded-2xl px-4 py-4 bg-white/10 border border-white/10 font-semibold"
>
Tag
</button>
</div>

<div className="mt-6 text-xs text-white/50">
Channel: <span className="text-white/70">{channelName || "—"}</span>
</div>
</div>
</main>
);
}