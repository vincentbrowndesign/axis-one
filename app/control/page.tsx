"use client";

import { useEffect, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

function getSid() {
if (typeof window === "undefined") return null;
const url = new URL(window.location.href);
return url.searchParams.get("sid");
}

export default function ControlPage() {
const [sid, setSid] = useState<string | null>(null);

useEffect(() => {
setSid(getSid());
}, []);

async function send(type: string) {
if (!sid) return;

await fetch("/api/remote", {
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
sid,
type,
}),
});
}

return (
<main className="min-h-screen bg-black text-white p-6">

<h1 className="text-4xl font-semibold">
Axis Controller
</h1>

<div className="text-white/60 mt-2">
Session: {sid}
</div>

<div className="grid grid-cols-2 gap-4 mt-6">

<button
onClick={() => send("start")}
className="p-6 bg-white text-black rounded-xl"
>
Start
</button>

<button
onClick={() => send("stop")}
className="p-6 bg-white/10 rounded-xl"
>
Stop
</button>

<button
onClick={() => send("decision")}
className="p-6 bg-white/10 rounded-xl"
>
Decision
</button>

<button
onClick={() => send("tag")}
className="p-6 bg-white/10 rounded-xl"
>
Tag
</button>

</div>

</main>
);
}