import Pusher from "pusher";
import { NextResponse } from "next/server";

const pusher = new Pusher({
appId: process.env.PUSHER_APP_ID!,
key: process.env.PUSHER_KEY!,
secret: process.env.PUSHER_SECRET!,
cluster: process.env.PUSHER_CLUSTER!,
useTLS: true,
});

export async function POST(req: Request) {
const body = await req.json();

const { sid, type } = body;

await pusher.trigger(`axis-one-${sid}`, "cmd", {
type,
});

return NextResponse.json({ ok: true });
}