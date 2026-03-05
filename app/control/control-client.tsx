"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

type Action = "start" | "stop" | "decision" | "tag" | "ping";

function createId(prefix = "sess_") {
return prefix + Math.random().toString(36).slice(2, 14);
}

export default function ControlClient() {
const [sid, setSid] = useState<string>("");
const [status, setStatus] = useState<string>("Ready");
const [busy, setBusy] = useState<boolean>(false);
const [err, setErr] = useState<string | null>(null);

// camera scanning is optional; this version pairs by URL param or manual paste
const [manualSid, setManualSid] = useState("");

// read sid from URL ?sid=...
useEffect(() => {
const url = new URL(window.location.href);
const qsSid = url.searchParams.get("sid");
const stored = window.localStorage.getItem("axis:control:sid");

const initial = qsSid || stored || "";
if (initial) {
setSid(initial);
setManualSid(initial);
window.localStorage.setItem("axis:control:sid", initial);
} else {
const fresh = createId("sess_");
setSid(fresh);
setManualSid(fresh);
window.localStorage.setItem("axis:control:sid", fresh);
}
}, []);

const origin = useMemo(() => {
if (typeof window === "undefined") return "";
return window.location.origin;
}, []);

const runUrl = useMemo(() => {
if (!origin || !sid) return "";
return `${origin}/run?sid=${encodeURIComponent(sid)}`;
}, [origin, sid]);

const controlUrl = useMemo(() => {
if (!origin || !sid) return "";
return `${origin}/control?sid=${encodeURIComponent(sid)}`;
}, [origin, sid]);

async function send(action: Action) {
if (!sid) return;
setBusy(true);
setErr(null);
setStatus(`Sending: ${action}...`);

try {
const res = await fetch("/api/remote/trigger", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ sid, action }),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || !json?.ok) {
throw new Error(json?.error || `HTTP ${res.status}`);
}

setStatus(`Sent: ${action}`);
} catch (e: any) {
setErr(e?.message || "Failed");
setStatus("Error");
} finally {
setBusy(false);
}
}

function applyManualSid() {
const next = manualSid.trim();
if (!next) return;
setSid(next);
window.localStorage.setItem("axis:control:sid", next);

// keep URL in sync (so you can share / bookmark)
const url = new URL(window.location.href);
url.searchParams.set("sid", next);
window.history.replaceState({}, "", url.toString());
}

const btnBase =
"rounded-3xl border border-white/10 bg-white/5 px-6 py-8 text-xl font-semibold tracking-tight active:scale-[0.99] transition";
const btnPrimary =
"rounded-3xl border border-white/10 bg-white text-black px-6 py-8 text-xl font-semibold tracking-tight active:scale-[0.99] transition";
const card =
"rounded-3xl border border-white/10 bg-white/5 backdrop-blur px-6 py-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]";

return (
<main className="min-h-screen bg-black text-white px-6 py-10">
<div className="max-w-xl mx-auto">
<h1 className="text-5xl font-semibold tracking-tight">Axis Controller</h1>
<p className="text-white/60 mt-3">
Session: <span className="text-white/80">{sid || "—"}</span>
</p>

<div className="mt-6 grid gap-3">
<div className={card}>
<div className="flex items-center gap-3">
<input
value={manualSid}
onChange={(e) => setManualSid(e.target.value)}
className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-white outline-none"
placeholder="Paste session id (sess_...)"
/>
<button
onClick={applyManualSid}
className="rounded-2xl bg-white text-black px-4 py-3 font-semibold"
>
Set
</button>
</div>

<div className="mt-4 text-sm text-white/60">
Tip: the **Run device** should be opened at:
<div className="mt-2 break-all text-white/80">{runUrl || "—"}</div>
</div>

<div className="mt-4 flex items-center gap-4">
<div className="rounded-2xl bg-white p-3">
<QRCodeCanvas value={runUrl || "about:blank"} size={140} />
</div>
<div className="text-sm text-white/60">
Scan this QR on the phone that will be the <b>Run (Axis One)</b> device.
</div>
</div>

<div className="mt-4 text-xs text-white/50">
Status: <span className="text-white/70">{status}</span>
{err ? <span className="text-red-300"> — {err}</span> : null}
</div>
</div>

<div className="grid grid-cols-2 gap-4 mt-2">
<button disabled={busy} onClick={() => send("start")} className={btnPrimary}>
Start
</button>
<button disabled={busy} onClick={() => send("stop")} className={btnBase}>
Stop
</button>
<button disabled={busy} onClick={() => send("decision")} className={btnBase}>
Decision
</button>
<button disabled={busy} onClick={() => send("tag")} className={btnBase}>
Tag
</button>
</div>

<button
disabled={busy}
onClick={() => send("ping")}
className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/80"
>
Test Ping
</button>

<div className="mt-4 text-xs text-white/40 break-all">
Controller link: {controlUrl || "—"}
</div>
</div>
</div>
</main>
);
}