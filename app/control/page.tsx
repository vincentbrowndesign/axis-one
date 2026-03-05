import { Suspense } from "react"
import ControlClient from "./control-client"

export default function Page() {
return (
<Suspense fallback={<div style={{ padding: 24 }}>Loading Control…</div>}>
<ControlClient />
</Suspense>
)
}