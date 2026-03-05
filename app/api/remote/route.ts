import Pusher from "pusher";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const pusher = new Pusher({
appId: process.env.PUSHER_APP_ID!,
key: process.env.PUSHER_KEY!,
secret: process.env.PUSHER_SECRET!,
cluster: process.env.PUSHER_CLUSTER!,
useTLS: true,
});

type Body = {
sessionId: string;
type?: "cmd" | "state";
name?: string; // command name if type=cmd
payload?: any;
};

function bad(msg: string, status = 400) {
return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
if (
!process.env.PUSHER_APP_ID ||
!process.env.PUSHER_KEY ||
!process.env.PUSHER_SECRET ||
!process.env.PUSHER_CLUSTER
) {
return bad("Missing PUSHER_* env vars (set in Vercel + .env.local).", 500);
}

let body: Body;
try {
body = (await req.json()) as Body;
} catch {
return bad("Invalid JSON body.");
}

const sessionId = (body.sessionId || "").trim();
if (!sessionId) return bad("sessionId required.");

const channel = `axis-one-${sessionId}`;
const type = body.type ?? "cmd";

if (type === "cmd") {
const name = (body.name || "").trim();
if (!name) return bad("name required when type=cmd.");
await pusher.trigger(channel, "cmd", {
name,
payload: body.payload ?? null,
ts: Date.now(),
});
return NextResponse.json({ ok: true });
}

// state event
await pusher.trigger(channel, "state", {
payload: body.payload ?? null,
ts: Date.now(),
});

return NextResponse.json({ ok: true });
}