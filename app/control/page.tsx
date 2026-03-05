"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function extractSid(input: string): string {
const raw = (input || "").trim();
if (!raw) return "";

// If they paste a full URL like https://.../control?sid=abc OR /run?sid=abc
try {
if (raw.startsWith("http://") || raw.startsWith("https://")) {
const u = new URL(raw);
const sid = u.searchParams.get("sid");
return (sid || "").trim();
}
} catch {}

// If they paste something like /run?sid=abc
if (raw.includes("?sid=")) {
const sid = raw.split("?sid=")[1]?.split("&")[0] ?? "";
return sid.trim();
}

// Otherwise assume they pasted just the sid
return raw;
}

async function sendCommand(sid: string, command: "run:start" | "run:stop" | "run:reset" | "run:tag") {
const res = await fetch("/api/remote/command", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ sid, command }),
});

if (!res.ok) {
const text = await res.text().catch(() => "");
throw new Error(`HTTP ${res.status} ${text || ""}`.trim());
}

return res.json().catch(() => ({}));
}

function ControlInner() {
const router = useRouter();
const searchParams = useSearchParams();

const sidFromUrl = useMemo(() => (searchParams?.get("sid") || "").trim(), [searchParams]);
const [sidInput, setSidInput] = useState(sidFromUrl);
const sid = useMemo(() => extractSid(sidInput), [sidInput]);

const [status, setStatus] = useState<"ready" | "sending" | "error">("ready");
const [last, setLast] = useState<string>("—");

useEffect(() => {
if (sidFromUrl && !sidInput) setSidInput(sidFromUrl);
}, [sidFromUrl, sidInput]);

function lockUrl() {
if (!sid) {
alert("Paste a session id (sid) first.");
return;
}
router.replace(`/control?sid=${encodeURIComponent(sid)}`);
}

async function doCmd(label: string, cmd: "run:start" | "run:stop" | "run:reset" | "run:tag") {
if (!sid) {
alert("Paste a session id (sid) first.");
return;
}
try {
setStatus("sending");
await sendCommand(sid, cmd);
setLast(label);
setStatus("ready");
} catch (e: any) {
setStatus("error");
alert(`Control error: ${e?.message || "Unknown error"}`);
setStatus("ready");
}
}

return (
<div className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-3xl px-4 py-8">
<div className="mb-6 flex items-center gap-3">
<div className="h-2 w-2 rounded-full bg-emerald-400" />
<div className="text-lg font-semibold">Axis Measure</div>
</div>

<div className="mb-4 flex gap-2 text-sm opacity-80">
<a className="rounded-full border border-white/15 px-4 py-2 hover:bg-white/5" href="/measure">Measure</a>
<a className="rounded-full border border-white/15 px-4 py-2 hover:bg-white/5" href="/run">Run</a>
<a className="rounded-full border border-white/15 px-4 py-2 hover:bg-white/5" href="/history">History</a>
<a className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2" href="/control">Control</a>
<a className="rounded-full border border-white/15 px-4 py-2 hover:bg-white/5" href="/states">States</a>
</div>

<h1 className="mb-2 text-4xl font-semibold">Control</h1>
<p className="mb-6 max-w-xl text-white/70">
Control is the remote that tags decisions on another device&apos;s Run session.
</p>

<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
<div className="mb-2 text-sm font-semibold">Session ID (sid)</div>

<input
className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white outline-none placeholder:text-white/30"
placeholder="Paste sid here (or paste the full link)"
value={sidInput}
onChange={(e) => setSidInput(e.target.value)}
/>

<div className="mt-3 flex flex-wrap gap-2">
<button
className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 hover:bg-white/10"
onClick={() => setSidInput("")}
>
Clear
</button>

<button
className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 hover:bg-white/10"
onClick={lockUrl}
>
Lock URL
</button>
</div>

<div className="mt-2 text-xs text-white/50">
Tip: Open Control as <span className="font-mono">/control?sid=YOUR_SID</span>
</div>
</div>

<div className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-4">
<div className="mb-2 text-xl font-semibold">Axis Controller</div>
<div className="text-sm text-white/70">
Session: <span className="font-mono">{sid || "—"}</span>
</div>
<div className="text-sm text-white/70">
Status: <span className="font-semibold">{status}</span> • Last: <span className="font-semibold">{last}</span>
</div>

<div className="mt-4 flex flex-wrap gap-2">
<button
className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 hover:bg-emerald-400/15 disabled:opacity-40"
disabled={status === "sending"}
onClick={() => doCmd("Start Run", "run:start")}
>
Start Run
</button>

<button
className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 hover:bg-emerald-400/15 disabled:opacity-40"
disabled={status === "sending"}
onClick={() => doCmd("Tag Decision", "run:tag")}
>
Tag Decision
</button>

<button
className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 hover:bg-white/10 disabled:opacity-40"
disabled={status === "sending"}
onClick={() => doCmd("Stop", "run:stop")}
>
Stop
</button>

<button
className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 hover:bg-white/10 disabled:opacity-40"
disabled={status === "sending"}
onClick={() => doCmd("Reset", "run:reset")}
>
Reset
</button>

<a className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 hover:bg-white/10" href="/run">
Go to Run →
</a>

<a className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 hover:bg-white/10" href="/measure">
Go to Measure →
</a>
</div>

<div className="mt-3 text-xs text-white/50">
You&apos;re not starting a session on the Controller device anymore — this page ONLY sends commands to the Run device by sid.
</div>
</div>
</div>
</div>
);
}

export default function ControlPage() {
// Fixes Next.js prerender error for useSearchParams by isolating it in Suspense
return (
<Suspense fallback={<div className="min-h-screen bg-black text-white p-6">Loading…</div>}>
<ControlInner />
</Suspense>
);
}