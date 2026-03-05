"use client"

import { useSearchParams } from "next/navigation"
import { useState } from "react"

export default function ControlClient() {
const params = useSearchParams()
const sid = params.get("sid")

const [status, setStatus] = useState("ready")

async function sendCommand(cmd: string) {
if (!sid) return alert("No session id")

await fetch("/api/control", {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
sid,
command: cmd,
}),
})

setStatus(cmd)
}

return (
<div style={{ padding: 20 }}>
<h2>Axis Controller</h2>

<p>Session: {sid}</p>
<p>Status: {status}</p>

<button onClick={() => sendCommand("start")}>Start Run</button>
<button onClick={() => sendCommand("tag")}>Tag Decision</button>
<button onClick={() => sendCommand("stop")}>Stop</button>
</div>
)
}