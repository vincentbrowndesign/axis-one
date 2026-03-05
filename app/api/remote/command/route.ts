import { NextResponse } from "next/server";
import Pusher from "pusher";

export const runtime = "nodejs";

const pusher = new Pusher({
appId: process.env.PUSHER_APP_ID || "",
key: process.env.PUSHER_KEY || "",
secret: process.env.PUSHER_SECRET || "",
cluster: process.env.PUSHER_CLUSTER || "",
useTLS: true,
});

type Command =
| "run:start"
| "run:stop"
| "run:reset"
| "run:tag";

function okJson(data: any, status = 200) {
return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
try {
const body = await req.json();
const sid = String(body?.sid || "").trim();
const command = String(body?.command || "").trim() as Command;

if (!sid) return okJson({ error: "Missing sid" }, 400);

const allowed: Command[] = ["run:start", "run:stop", "run:reset", "run:tag"];
if (!allowed.includes(command)) return okJson({ error: "Invalid command" }, 400);

const channel = `private-axis-run-${sid}`;

await pusher.trigger(channel, "axis:command", {
sid,
command,
at: Date.now(),
// optional payload passthrough (future use)
payload: body?.payload ?? null,
});

return okJson({ ok: true });
} catch (err: any) {
return okJson({ error: err?.message || "Command failed" }, 500);
}
}

// Helps avoid 405 confusion if something accidentally hits GET.
export async function GET() {
return okJson({ error: "Use POST" }, 405);
}