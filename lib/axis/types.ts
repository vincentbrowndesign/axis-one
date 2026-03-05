export type Vec3 = { x: number; y: number; z: number };

export type AxisOneSample = {
t: number; // epoch ms
dt?: number;
accel?: Vec3;
accelIncludingGravity: Vec3;
gyro?: { alpha: number; beta: number; gamma: number };
rotationRate: { alpha: number; beta: number; gamma: number };
};

export type AxisOneTag = {
t: number; // epoch ms (must match sample time base)
kind?: string; // optional if you have it
label?: string; // optional
note?: string; // optional
};

export type AxisOneSession = {
exported_at: string;
environment: string;
started_at_epoch_ms: number;
ended_at_epoch_ms: number;
samples_count: number;
tags_count: number;
samples: AxisOneSample[];
tags?: AxisOneTag[]; // sometimes your export may include this
};

export type AxisLinePoint = {
u: number; // 0..1
D: number; // normalized 0..1
R: number; // normalized 0..1
J: number; // normalized 0..1
};

export type AxisDecision = {
tagIndex: number;
tagTimeMs: number;
windowStartMs: number;
windowEndMs: number;
points: AxisLinePoint[]; // N points
peaks: {
Dmax: number;
Rmax: number;
Jmax: number;
};
features: AxisFeatures;
pattern: AxisPatternGuess;
};

export type AxisFeatures = {
// timing (seconds from window start)
tPeakD: number;
tPeakR: number;
tPeakJ: number;

// shape
smoothness: number; // lower is smoother
asymmetry: number; // 0 symmetric, higher = one-sided
impulseIndex: number; // how "snap" the jerk is

// magnitudes (raw, not normalized)
Dmax: number;
Rmax: number;
Jmax: number;
};

export type AxisPatternGuess = {
label: "drive" | "crossover" | "stepback" | "stop" | "unknown";
confidence: number; // 0..1
reason: string;
};