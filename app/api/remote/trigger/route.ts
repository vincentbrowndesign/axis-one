// app/api/remote/trigger/route.ts
import { NextResponse } from "next/server";
import Pusher from "pusher";

export const runtime = "nodejs"; // important (Pusher server SDK needs node)

const pusher = new Pusher({
appId: process.env.PUSHER_APP_ID || "",
key: process.env.PUSHER_KEY || "",
secret: process.env.PUSHER_SECRET || "",
cluster: process.env.PUSHER_CLUSTER || "",
useTLS: true,
});

type Action = "start" | "stop" | "decision" | "tag" | "ping";

export async function POST(req: Request) {
try {
const body = await req.json();
const sid = String(body?.sid || "").trim();
const action = String(body?.action || "").trim() as Action;

if (!sid) {
return NextResponse.json({ ok: false, error: "Missing sid" }, { status: 400 });
}
if (!action) {
return NextResponse.json({ ok: false, error: "Missing action" }, { status: 400 });
}

// Basic env validation (helps you debug instantly on Vercel)
const missing = ["PUSHER_APP_ID", "PUSHER_KEY", "PUSHER_SECRET", "PUSHER_CLUSTER"].filter(
(k) => !process.env[k]
);
if (missing.length) {
return NextResponse.json(
{ ok: false, error: `Missing env: ${missing.join(", ")}` },
{ status: 500 }
);
}

const channel = `axis-one-${sid}`;
await pusher.trigger(channel, "control", {
action,
ts: Date.now(),
});

return NextResponse.json({ ok: true, channel, action });
} catch (e: any) {
return NextResponse.json(
{ ok: false, error: e?.message || "Server error" },
{ status: 500 }
);
}
}