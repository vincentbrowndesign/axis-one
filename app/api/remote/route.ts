import { NextResponse } from "next/server"
import Pusher from "pusher"

const pusher = new Pusher({
appId: process.env.PUSHER_APP_ID!,
key: process.env.PUSHER_KEY!,
secret: process.env.PUSHER_SECRET!,
cluster: process.env.PUSHER_CLUSTER!,
useTLS: true,
})

export async function POST(req: Request) {
try {
const body = await req.json()

const sid = body.sid
const type = body.type

if (!sid || !type) {
return NextResponse.json(
{ error: "Missing sid or type" },
{ status: 400 }
)
}

const channel = `axis-${sid}`

await pusher.trigger(channel, "control", {
type,
time: Date.now(),
})

return NextResponse.json({ ok: true })
} catch (err) {
console.error(err)
return NextResponse.json(
{ error: "Server error" },
{ status: 500 }
)
}
}