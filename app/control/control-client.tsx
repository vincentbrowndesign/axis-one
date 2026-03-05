"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

type Cmd = "start" | "stop" | "tag" | "reset"

export default function ControlClient() {
const params = useSearchParams()

// sid can come from URL (?sid=xxx) or manual input
const sidFromUrl = params.get("sid") || ""
const [sidInput, setSidInput] = useState(sidFromUrl)

useEffect(() => {
// keep input synced if URL sid changes
setSidInput(sidFromUrl)
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [sidFromUrl])

const sid = useMemo(() => sidInput.trim(), [sidInput])

const [busy, setBusy] = useState<Cmd | null>(null)
const [status, setStatus] = useState<string>("ready")
const [last, setLast] = useState<string>("—")

async function sendCommand(command: Cmd) {
if (!sid) {
alert("Paste a session id (sid) first.")
return
}

try {
setBusy(command)
setStatus("sending…")

const res = await fetch("/api/control", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ sid, command }),
})

if (!res.ok) {
const text = await res.text().catch(() => "")
throw new Error(text || `HTTP ${res.status}`)
}

setLast(command.toUpperCase())
setStatus("sent")
setTimeout(() => setStatus("ready"), 600)
} catch (e: any) {
setStatus("error")
alert(`Control error: ${e?.message || "unknown"}`)
} finally {
setBusy(null)
}
}

// simple reusable button style (matches your dark UI vibe)
const btn =
"px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 active:bg-white/15 transition text-sm"
const btnPrimary =
"px-4 py-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/15 active:bg-emerald-400/20 transition text-sm"
const card =
"rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5"

return (
<div className="min-h-screen text-white">
<div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
{/* Header */}
<div className="flex items-center justify-between gap-3">
<div className="flex items-center gap-3">
<div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
<div className="text-lg font-semibold">Axis Measure</div>
</div>

<div className="flex gap-2">
<Link className={btn} href="/measure">Measure</Link>
<Link className={btn} href="/run">Run</Link>
<Link className={btn} href="/history">History</Link>
<Link className={btnPrimary} href="/control">Control</Link>
<Link className={btn} href="/states">States</Link>
</div>
</div>

{/* Title */}
<div className="mt-8">
<div className="text-xs uppercase tracking-wide text-white/50">Axis</div>
<h1 className="mt-2 text-4xl font-semibold">Control</h1>
<p className="mt-2 text-white/60">
Control is the remote that tags decisions on another device’s Run session.
</p>
</div>

{/* Session input */}
<div className={`mt-6 ${card}`}>
<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
<div className="flex-1">
<div className="text-sm text-white/70">Session ID (sid)</div>
<input
value={sidInput}
onChange={(e) => setSidInput(e.target.value)}
placeholder="Paste sid here (from /run?sid=...)"
className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400/40"
/>
<div className="mt-2 text-xs text-white/45">
Tip: Open Control as <span className="text-white/70">/control?sid=YOUR_SID</span>
</div>
</div>

<div className="flex gap-2">
<button
className={btn}
onClick={() => {
setSidInput("")
setLast("—")
setStatus("ready")
}}
>
Clear
</button>
<Link className={btn} href={`/control${sid ? `?sid=${encodeURIComponent(sid)}` : ""}`}>
Lock URL
</Link>
</div>
</div>
</div>

{/* Controls */}
<div className={`mt-4 ${card}`}>
<div className="flex items-center justify-between">
<div>
<div className="text-lg font-semibold">Axis Controller</div>
<div className="mt-1 text-sm text-white/60">
Session: <span className="text-white/90">{sid || "—"}</span>
</div>
<div className="mt-1 text-sm text-white/60">
Status: <span className="text-white/90">{status}</span> • Last:{" "}
<span className="text-white/90">{last}</span>
</div>
</div>
</div>

<div className="mt-4 flex flex-wrap gap-2">
<button
className={btnPrimary}
disabled={busy !== null}
onClick={() => sendCommand("start")}
>
{busy === "start" ? "Starting…" : "Start Run"}
</button>

<button
className={btnPrimary}
disabled={busy !== null}
onClick={() => sendCommand("tag")}
>
{busy === "tag" ? "Tagging…" : "Tag Decision"}
</button>

<button
className={btn}
disabled={busy !== null}
onClick={() => sendCommand("stop")}
>
{busy === "stop" ? "Stopping…" : "Stop"}
</button>

<button
className={btn}
disabled={busy !== null}
onClick={() => sendCommand("reset")}
>
{busy === "reset" ? "Resetting…" : "Reset"}
</button>

<Link className={btn} href="/run">
Go to Run →
</Link>

<Link className={btn} href="/measure">
Go to Measure →
</Link>
</div>

<div className="mt-4 text-xs text-white/45">
You’re not starting a session on the Controller device anymore — this page ONLY sends
commands to the Run device by <span className="text-white/70">sid</span>.
</div>
</div>
</div>
</div>
)
}