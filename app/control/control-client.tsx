"use client";

import { useEffect, useMemo, useState } from "react";

type Cmd = "START" | "STOP" | "DECISION" | "TAG";

export default function ControlClient() {
const [sid, setSid] = useState<string>("");
const [status, setStatus] = useState<string>("Not paired");
const [busy, setBusy] = useState(false);

// If your pairing page already stores sid somewhere, this tries to read it:
useEffect(() => {
try {
const fromUrl = new URL(window.location.href).searchParams.get("sid");
const fromLs = window.localStorage.getItem("axis_remote_sid");
const s = fromUrl || fromLs || "";
if (s) setSid(s);
if (fromUrl) window.localStorage.setItem("axis_remote_sid", fromUrl);
} catch {}
}, []);

const canSend = useMemo(() => !!sid && !busy, [sid, busy]);

async function send(cmd: Cmd) {
if (!sid) {
setStatus("Missing session id (sid). Re-pair.");
return;
}
setBusy(true);
setStatus(`Sending ${cmd}…`);
try {
const res = await fetch("/api/remote/command", {
method: "POST",
headers: { "Content-Type": "application/json" },
cache: "no-store",
body: JSON.stringify({ sid, cmd }),
});

const text = await res.text();
if (!res.ok) {
setStatus(`Failed (${res.status}): ${text}`);
return;
}
setStatus(`${cmd} sent ✅`);
} catch (e: any) {
setStatus(`Network error: ${e?.message ?? String(e)}`);
} finally {
setBusy(false);
}
}

return (
<main className="min-h-screen bg-black text-white px-6 py-10">
<div className="max-w-xl mx-auto">
<h1 className="text-5xl font-semibold tracking-tight">Axis Controller</h1>

<div className="mt-3 text-white/60 text-lg">
Session: <span className="text-white/85 break-all">{sid || "—"}</span>
</div>

<div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
<div className="text-white/60">Status</div>
<div className="mt-1 text-xl">{status}</div>
</div>

<div className="mt-8 grid grid-cols-2 gap-4">
{/* IMPORTANT: type="button" so Safari doesn't treat it like a form submit */}
<button
type="button"
disabled={!canSend}
onClick={() => send("START")}
className="h-24 rounded-3xl bg-white text-black text-2xl font-semibold disabled:opacity-40"
>
Start
</button>

<button
type="button"
disabled={!canSend}
onClick={() => send("STOP")}
className="h-24 rounded-3xl bg-white/10 text-white text-2xl font-semibold border border-white/10 disabled:opacity-40"
>
Stop
</button>

<button
type="button"
disabled={!canSend}
onClick={() => send("DECISION")}
className="h-24 rounded-3xl bg-white/10 text-white text-2xl font-semibold border border-white/10 disabled:opacity-40"
>
Decision
</button>

<button
type="button"
disabled={!canSend}
onClick={() => send("TAG")}
className="h-24 rounded-3xl bg-white/10 text-white text-2xl font-semibold border border-white/10 disabled:opacity-40"
>
Tag
</button>
</div>

<div className="mt-8 text-white/50 text-sm">
If buttons say “sent ✅” but Run doesn’t react, it’s a Run listener / Pusher env mismatch.
</div>
</div>
</main>
);
}