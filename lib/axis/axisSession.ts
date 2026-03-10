import type { SessionEvent } from "../axis-types"
import { STORAGE_KEY } from "../axis-types"

export class AxisSession {
private events: SessionEvent[] = []

start() {
this.events = []
}

record(event: SessionEvent) {
this.events.push(event)
}

stop() {
if (typeof window !== "undefined") {
localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events))
}
}

getEvents() {
return this.events
}
}