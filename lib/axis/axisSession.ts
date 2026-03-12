export type SessionEventType =
| "session_started"
| "session_stopped"
| "state_changed"
| "reading_captured";

export type SessionEvent = {
id: string;
type: SessionEventType;
timestamp: number;
payload?: Record<string, unknown>;
};

const STORAGE_KEY = "axis_session_v1";

function createId() {
return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class AxisSession {
private events: SessionEvent[] = [];

constructor() {
this.events = this.read();
}

private read(): SessionEvent[] {
if (typeof window === "undefined") return [];

try {
const raw = window.localStorage.getItem(STORAGE_KEY);
if (!raw) return [];

const parsed = JSON.parse(raw) as SessionEvent[];
return Array.isArray(parsed) ? parsed : [];
} catch {
return [];
}
}

private write() {
if (typeof window === "undefined") return;

try {
window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events));
} catch {
// ignore storage write errors
}
}

addEvent(type: SessionEventType, payload?: Record<string, unknown>) {
const event: SessionEvent = {
id: createId(),
type,
timestamp: Date.now(),
payload,
};

this.events.push(event);
this.write();

return event;
}

getEvents() {
return this.events;
}

clear() {
this.events = [];
this.write();
}
}