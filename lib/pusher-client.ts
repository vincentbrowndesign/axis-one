// lib/pusher-client.ts
import Pusher from "pusher-js";

export function makePusherClient() {
const key = process.env.NEXT_PUBLIC_PUSHER_KEY!;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER!;
return new Pusher(key, { cluster });
}