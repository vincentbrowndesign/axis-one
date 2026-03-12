export type AxisState = "aligned" | "shift" | "drop" | "recover";

export type AxisSample = {
tilt: number;
rotation: number;
};

export type AxisReading = {
state: AxisState;
stability: number;
tilt: number;
rotation: number;
};

function clamp(value: number, min: number, max: number) {
return Math.min(max, Math.max(min, value));
}

export function evaluateAxis(sample: AxisSample): AxisReading {
const tilt = Math.abs(sample.tilt ?? 0);
const rotation = Math.abs(sample.rotation ?? 0);

const tiltPenalty = clamp(tilt * 10, 0, 60);
const rotationPenalty = clamp(rotation * 0.6, 0, 50);

const stability = clamp(100 - tiltPenalty - rotationPenalty, 0, 100);

let state: AxisState = "drop";

if (stability >= 82 && tilt < 2.8 && rotation < 30) {
state = "aligned";
} else if (stability >= 62 && tilt < 5.2 && rotation < 75) {
state = "shift";
} else if (stability >= 38 || tilt >= 5.2) {
state = "drop";
}

if (state === "drop" && stability >= 68 && tilt < 3.8 && rotation < 45) {
state = "recover";
}

return {
state,
stability,
tilt,
rotation,
};
}