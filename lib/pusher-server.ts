import Pusher from "pusher";

function required(name: string) {
const v = process.env[name];
if (!v) throw new Error(`Missing env var: ${name}`);
return v;
}

export const pusherServer = new Pusher({
appId: required("PUSHER_APP_ID"),
key: required("PUSHER_KEY"),
secret: required("PUSHER_SECRET"),
cluster: required("PUSHER_CLUSTER"),
useTLS: true,
});