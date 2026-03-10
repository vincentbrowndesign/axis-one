import { AxisState, CENTER } from "./axis-types";

export function deriveAxisState(
x: number,
y: number,
center = CENTER
): AxisState {

const dx = x - center.x;
const dy = y - center.y;

const distance = Math.sqrt(dx * dx + dy * dy);

if (distance < 0.25) {
return "aligned";
}

if (distance < 0.6) {
return "shift";
}

if (distance < 1.0) {
return "recover";
}

return "drop";
}