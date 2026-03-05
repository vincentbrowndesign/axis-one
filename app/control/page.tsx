import { Suspense } from "react"
import ControlClient from "./control-client"

export default function Page() {
return (
<Suspense fallback={<div>Loading Control…</div>}>
<ControlClient />
</Suspense>
)
}