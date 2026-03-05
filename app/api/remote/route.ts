// app/api/remote/route.ts
import { NextResponse } from "next/server";
import Pusher from "pusher";

const pusher = new Pusher({
appId: process.env.PUSHER_APP_ID!,
key: process.env.PUSHER_KEY!,
secret: process.env.PUSHER_SECRET!,
cluster: process.env.PUSHER_CLUSTER!,
useTLS: true,
});

export async function POST(req: Request) {
try {
const body = await req.json();
const sid = String(body?.sid || "");
const type = String(body?.type || "");
const payload = body?.payload ?? {};

if (!sid) return NextResponse.json({ ok: false, error: "Missing sid" }, { status: 400 });
if (!type) return NextResponse.json({ ok: false, error: "Missing type" }, { status: 400 });

// Public channel name derived from session id
const channel = `axis-${sid}`;

await pusher.trigger(channel, "control", {
type,
payload,
sentAt: Date.now(),
});

return NextResponse.json({ ok: true });
} catch (err: any) {
return NextResponse.json(
{ ok: false, error: err?.message || "Unknown error" },
{ status: 500 }
);
}
}