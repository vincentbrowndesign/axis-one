import { NextResponse } from "next/server";
import { pusherServer } from "@/lib/pusher-server";

export const runtime = "nodejs"; // IMPORTANT for pusher server lib

type Action = "START" | "STOP" | "DECISION" | "TAG";

export async function POST(req: Request) {
try {
const body = await req.json();
const sessionId = String(body?.sessionId || "");
const action = String(body?.action || "") as Action;
const meta = body?.meta ?? {};

if (!sessionId) {
return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
}
if (!["START", "STOP", "DECISION", "TAG"].includes(action)) {
return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
}

const channel = `private-axis-${sessionId}`;
const event = "remote-command";

await pusherServer.trigger(channel, event, {
action,
meta,
ts: Date.now(),
});

return NextResponse.json({ ok: true });
} catch (e: any) {
return NextResponse.json(
{ ok: false, error: e?.message ?? "Server error" },
{ status: 500 }
);
}
}