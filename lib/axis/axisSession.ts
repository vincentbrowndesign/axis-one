import { SessionEvent, STORAGE_KEY } from "./axis-types"

export class AxisSession {

private events: SessionEvent[] = []

start() {
this.events = []
}

record(event: SessionEvent) {
this.events.push(event)
}

stop() {
localStorage.setItem(
STORAGE_KEY,
JSON.stringify(this.events)
)
}

getEvents() {
return this.events
}

}