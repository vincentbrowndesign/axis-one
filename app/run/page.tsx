import RunClient from "./run-client";

export default function RunPage() {
return (
<main className="min-h-screen bg-black text-white">
<div className="mx-auto max-w-5xl px-6 py-12">
<h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
Run (Axis One)
</h1>

<p className="mt-3 max-w-2xl text-white/70">
Capture motion, tag decision windows, export the session.
</p>

<div className="mt-8">
<RunClient />
</div>
</div>
</main>
);
}