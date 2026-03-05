"use client";

import { useEffect, useMemo, useState } from "react";
import Pusher from "pusher-js";

type LiveState = {
isCapturing: boolean;
permission: "idle" | "granted" | "denied";
samples: number;
tags: number;
lastTag?: { t: number; kind: string };
};

const btn =
"w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-5 text-xl font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)] active:scale-[0.99]";
const btnPrimary =
"w-full rounded-2xl bg-white px-5 py-5 text-xl font-semibold text-black shadow-[0_18px_60px_rgba(255,255,255,0.12)] active:scale-[0.99]";

export default function ControlPage() {
const [sessionId, setSessionId] = useState("");
const [connected, setConnected] = useState(false);
const [live, setLive] = useState<LiveState>({
isCapturing: false,
permission: "idle",
samples: 0,
tags: 0,
});

const canConnect = sessionId.trim().length >= 6;

const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY!;
const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER!;

useEffect(() => {
if (!canConnect) return;

const pusher = new Pusher(pusherKey, {
cluster: pusherCluster,
});

const channel = pusher.subscribe(`axis-one-${sessionId.trim()}`);

channel.bind("pusher:subscription_succeeded", () => setConnected(true));
channel.bind("pusher:subscription_error", () => setConnected(false));

channel.bind("state", (data: any) => {
const payload = data?.payload;
if (!payload) return;
setLive((prev) => ({ ...prev, ...payload }));
});

return () => {
try {
pusher.unsubscribe(`axis-one-${sessionId.trim()}`);
pusher.disconnect();
} catch {}
};
}, [canConnect, sessionId, pusherKey, pusherCluster]);

async function send(name: string, payload?: any) {
const sid = sessionId.trim();
if (!sid) return;

await fetch("/api/remote", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ sessionId: sid, type: "cmd", name, payload }),
}).catch(() => {});
}

const statusLabel = useMemo(() => {
if (!canConnect) return "Enter a session id";
if (!connected) return "Connecting…";
if (live.permission === "denied") return "Sensor permission denied on phone A";
if (live.isCapturing) return "LIVE (capturing)";
return "Connected (idle)";
}, [canConnect, connected, live]);

return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto w-full max-w-xl px-6 pb-16 pt-10">
<h1 className="text-4xl font-semibold tracking-tight">Axis One Control</h1>
<p className="mt-2 text-white/60">
Remote controller (works across networks). Paste the session id from the sensor phone.
</p>

<div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
<label className="text-sm text-white/60">Session ID</label>
<input
value={sessionId}
onChange={(e) => setSessionId(e.target.value)}
placeholder="e.g. 6f3c7b2a"
className="mt-2 w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-lg outline-none"
/>
<div className="mt-3 text-sm text-white/60">{statusLabel}</div>

<div className="mt-5 grid grid-cols-2 gap-3">
<button className={btn} onClick={() => send("ENABLE_SENSORS")}>
Enable Sensors
</button>
<button className={btnPrimary} onClick={() => send("START")}>
Start
</button>

<button className={btn} onClick={() => send("STOP")}>
Stop
</button>
<button className={btn} onClick={() => send("DECISION")}>
Decision
</button>

<button className={btn} onClick={() => send("TAG")}>
Tag
</button>
<button className={btn} onClick={() => send("DOWNLOAD")}>
Download JSON
</button>
</div>

<div className="mt-6 grid grid-cols-2 gap-3">
<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
<div className="text-sm text-white/60">Samples</div>
<div className="mt-2 text-4xl font-semibold">{live.samples}</div>
</div>
<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
<div className="text-sm text-white/60">Tags</div>
<div className="mt-2 text-4xl font-semibold">{live.tags}</div>
</div>
</div>
</div>
</div>
</main>
);
}