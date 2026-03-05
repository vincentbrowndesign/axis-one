import Pusher from "pusher-js";

function required(name: string) {
const v = process.env[name];
if (!v) throw new Error(`Missing env var: ${name}`);
return v;
}

export function makePusherClient() {
return new Pusher(required("NEXT_PUBLIC_PUSHER_KEY"), {
cluster: required("NEXT_PUBLIC_PUSHER_CLUSTER"),
forceTLS: true,
});
}