// app/control/control-client.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PairPayload = {
sid: string;
};

type Command = "enable" | "start" | "stop" | "tag" | "decision";

function parseSidFromText(text: string): string | null {
const t = (text || "").trim();
if (!t) return null;

// 1) If QR is a URL like https://axismeasure.com/run?sid=XXXX
try {
if (t.startsWith("http://") || t.startsWith("https://")) {
const url = new URL(t);
const sid = url.searchParams.get("sid") || url.searchParams.get("session") || url.searchParams.get("id");
if (sid) return sid.trim();
}
} catch {}

// 2) If QR is JSON like {"sid":"XXXX"}
try {
const obj = JSON.parse(t);
if (obj?.sid) return String(obj.sid).trim();
if (obj?.sessionId) return String(obj.sessionId).trim();
} catch {}

// 3) If QR is just the session id
// allow short ids and uuid-ish
return t.length >= 6 ? t : null;
}

async function apiPost<T>(url: string, body: any): Promise<T> {
const res = await fetch(url, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(body),
cache: "no-store",
});
if (!res.ok) {
const txt = await res.text().catch(() => "");
throw new Error(txt || `Request failed: ${res.status}`);
}
return (await res.json()) as T;
}

export default function ControlClient() {
const [scanning, setScanning] = useState(false);
const [sid, setSid] = useState<string>("");
const [status, setStatus] = useState<string>("Idle");
const [error, setError] = useState<string | null>(null);

const videoRef = useRef<HTMLVideoElement | null>(null);

// ZXing instances live in refs (no React state churn)
const readerRef = useRef<any>(null);
const controlsRef = useRef<any>(null);

const paired = useMemo(() => sid.trim().length > 0, [sid]);

useEffect(() => {
// cleanup on unmount
return () => {
try {
controlsRef.current?.stop?.();
} catch {}
controlsRef.current = null;
readerRef.current = null;
};
}, []);

const stopScan = () => {
setScanning(false);
setStatus("Idle");
setError(null);

// Stop camera stream/decoder
try {
controlsRef.current?.stop?.();
} catch {}
controlsRef.current = null;

// NOTE: newer @zxing/browser has no reset()
readerRef.current = null;
};

const startScan = async () => {
setError(null);
setStatus("Starting camera…");
setScanning(true);

try {
// Dynamically import so Next server build never touches browser APIs
const zxing = await import("@zxing/browser");
const { BrowserMultiFormatReader } = zxing;

// Ensure old session stopped
try {
controlsRef.current?.stop?.();
} catch {}
controlsRef.current = null;

// Create reader
readerRef.current = new BrowserMultiFormatReader();

if (!videoRef.current) {
throw new Error("Video element not ready.");
}

setStatus("Scanning QR…");

// Start decoding from default camera
// decodeFromVideoDevice(deviceId, videoEl, callback) returns controls
const controls = await readerRef.current.decodeFromVideoDevice(
undefined,
videoRef.current,
async (result: any, err: any, controlsFromCb: any) => {
// Save controls reference if callback provides it
if (!controlsRef.current && controlsFromCb) controlsRef.current = controlsFromCb;

// Ignore decode errors; keep scanning
if (err) return;

const text = result?.getText?.() ?? "";
const parsed = parseSidFromText(text);

if (parsed) {
setStatus("QR read ✓ Pairing…");
setSid(parsed);

// optional: notify server that controller paired
// if your API route differs, adjust these endpoints
try {
await apiPost<{ ok: boolean }>("/api/remote/pair", { sid: parsed } satisfies PairPayload);
} catch {
// pairing API is optional; don't block
}

// stop scanning once paired
stopScan();
}
}
);

controlsRef.current = controls;
} catch (e: any) {
setError(e?.message || "Camera scan failed");
setStatus("Idle");
setScanning(false);
// best-effort stop
try {
controlsRef.current?.stop?.();
} catch {}
controlsRef.current = null;
readerRef.current = null;
}
};

const send = async (cmd: Command) => {
setError(null);
if (!sid.trim()) {
setError("No session id. Scan the QR from the Run phone first.");
return;
}

try {
setStatus(`Sending: ${cmd}…`);
// If your API route differs, change this endpoint
await apiPost<{ ok: boolean }>("/api/remote/command", { sid: sid.trim(), cmd });
setStatus(`Sent ✓ ${cmd}`);
setTimeout(() => setStatus("Idle"), 900);
} catch (e: any) {
setError(e?.message || "Command failed");
setStatus("Idle");
}
};

return (
<main className="min-h-screen bg-black text-white px-5 py-8">
<div className="max-w-xl mx-auto">
<h1 className="text-4xl font-semibold tracking-tight">Axis One</h1>
<p className="text-white/60 mt-2">Controller — scan QR from the Run phone, then control it remotely.</p>

<div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="flex items-center justify-between">
<div className="text-sm text-white/60">Status</div>
<div className="text-sm">{status}</div>
</div>

<div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
<div className="text-sm text-white/60 mb-2">Session</div>

<div className="flex gap-2 items-center">
<input
className="w-full rounded-xl bg-black/60 border border-white/10 px-3 py-2 text-white outline-none"
placeholder="Scan QR or paste session id"
value={sid}
onChange={(e) => setSid(e.target.value)}
/>
<button
className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm"
onClick={() => setSid("")}
>
Clear
</button>
</div>

<div className="mt-3 flex items-center gap-2 text-sm">
<span
className={`inline-block h-2.5 w-2.5 rounded-full ${
paired ? "bg-emerald-400" : "bg-white/20"
}`}
/>
<span className="text-white/70">{paired ? "Paired" : "Not paired"}</span>
</div>
</div>

<div className="mt-4 grid grid-cols-2 gap-3">
{!scanning ? (
<button
onClick={startScan}
className="rounded-2xl bg-white text-black font-semibold py-4"
>
Scan QR
</button>
) : (
<button
onClick={stopScan}
className="rounded-2xl bg-white/10 border border-white/10 text-white font-semibold py-4"
>
Stop scan
</button>
)}

<button
onClick={() => send("enable")}
className="rounded-2xl bg-white/10 border border-white/10 text-white font-semibold py-4"
>
Enable sensors
</button>

<button
onClick={() => send("start")}
className="rounded-2xl bg-white/10 border border-white/10 text-white font-semibold py-4"
>
Start
</button>
<button
onClick={() => send("stop")}
className="rounded-2xl bg-white/10 border border-white/10 text-white font-semibold py-4"
>
Stop
</button>

<button
onClick={() => send("decision")}
className="rounded-2xl bg-white/10 border border-white/10 text-white font-semibold py-4"
>
Decision
</button>
<button
onClick={() => send("tag")}
className="rounded-2xl bg-white/10 border border-white/10 text-white font-semibold py-4"
>
Tag
</button>
</div>

{error ? (
<div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
{error}
</div>
) : null}
</div>

{/* Camera preview */}
{scanning ? (
<div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-sm text-white/60 mb-3">Camera</div>
<video
ref={videoRef}
className="w-full rounded-2xl bg-black"
muted
playsInline
/>
<div className="mt-3 text-xs text-white/50">
Tip: iOS Safari needs camera permission. If it fails, refresh and allow.
</div>
</div>
) : null}
</div>
</main>
);
}