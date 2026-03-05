// app/api/remote/trigger/route.ts
import { NextResponse } from "next/server";
import { pusherServer } from "@/lib/pusher-server";

export async function POST(req: Request) {
try {
const body = await req.json();
const sessionId = String(body?.sessionId || "").trim();
const cmd = String(body?.cmd || "").trim();

if (!sessionId || !cmd) {
return NextResponse.json({ ok: false, error: "Missing sessionId/cmd" }, { status: 400 });
}

const channel = `axis-one-${sessionId}`;
await pusherServer.trigger(channel, "cmd", { cmd, ts: Date.now() });

return NextResponse.json({ ok: true });
} catch (e: any) {
return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
}
}