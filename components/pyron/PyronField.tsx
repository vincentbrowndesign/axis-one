"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { createNoise3D } from "simplex-noise";
import { useSensor } from "../../lib/pyron/useSensor";

const PARTICLE_COUNT = 420;
const FIELD_RADIUS = 5.6;

type ParticleData = {
position: THREE.Vector3;
velocity: THREE.Vector3;
phase: number;
};

export default function PyronField() {
const pointsRef = useRef<THREE.Points>(null);
const energyRef = useSensor();
const noise3D = useMemo(() => createNoise3D(), []);

const particles = useMemo<ParticleData[]>(() => {
return new Array(PARTICLE_COUNT).fill(0).map(() => {
const r = Math.random() * FIELD_RADIUS;
const theta = Math.random() * Math.PI * 2;
const phi = Math.acos(2 * Math.random() - 1);

const x = r * Math.sin(phi) * Math.cos(theta);
const y = r * Math.sin(phi) * Math.sin(theta);
const z = r * Math.cos(phi);

return {
position: new THREE.Vector3(x, y, z),
velocity: new THREE.Vector3(0, 0, 0),
phase: Math.random() * Math.PI * 2,
};
});
}, []);

const positions = useMemo(() => {
const arr = new Float32Array(PARTICLE_COUNT * 3);

particles.forEach((p, i) => {
arr[i * 3] = p.position.x;
arr[i * 3 + 1] = p.position.y;
arr[i * 3 + 2] = p.position.z;
});

return arr;
}, [particles]);

useFrame(({ clock }) => {
const points = pointsRef.current;
if (!points) return;

const time = clock.getElapsedTime();
const energy = Math.min(2, energyRef.current * 0.015);
const pos = points.geometry.attributes.position.array as Float32Array;

for (let i = 0; i < PARTICLE_COUNT; i++) {
const particle = particles[i];
const p = particle.position;
const v = particle.velocity;

const centerPull = p
.clone()
.multiplyScalar(-1)
.normalize()
.multiplyScalar(0.00045 + energy * 0.00015);
v.add(centerPull);

const n = noise3D(p.x * 0.25 + time * 0.2, p.y * 0.25, p.z * 0.25);

const flow = new THREE.Vector3(
Math.sin(n * Math.PI * 2),
Math.cos(n * Math.PI * 2),
Math.sin(n * Math.PI * 1.3)
).multiplyScalar(0.0006 + energy * 0.0005);
v.add(flow);

const swirl = new THREE.Vector3(-p.z, 0, p.x)
.normalize()
.multiplyScalar(0.0004 + energy * 0.0002);
v.add(swirl);

v.y += Math.sin(time * 0.9 + particle.phase) * 0.00025;

let avgVx = 0;
let avgVy = 0;
let avgVz = 0;
let count = 0;

for (let j = i + 1; j < Math.min(i + 10, PARTICLE_COUNT); j++) {
const q = particles[j];
const d2 = p.distanceToSquared(q.position);

if (d2 < 1.5) {
avgVx += q.velocity.x;
avgVy += q.velocity.y;
avgVz += q.velocity.z;
count++;

if (d2 < 0.08) {
const repel = p
.clone()
.sub(q.position)
.normalize()
.multiplyScalar(0.0004);
v.add(repel);
}
}
}

if (count > 0) {
avgVx /= count;
avgVy /= count;
avgVz /= count;

v.x += (avgVx - v.x) * 0.01;
v.y += (avgVy - v.y) * 0.01;
v.z += (avgVz - v.z) * 0.01;
}

v.multiplyScalar(0.986);
p.add(v);

const dist = p.length();
if (dist > FIELD_RADIUS) {
p.normalize().multiplyScalar(FIELD_RADIUS * 0.95);
v.multiplyScalar(-0.3);
}

pos[i * 3] = p.x;
pos[i * 3 + 1] = p.y;
pos[i * 3 + 2] = p.z;
}

points.geometry.attributes.position.needsUpdate = true;
points.rotation.y = time * 0.04;
});

return (
<points ref={pointsRef}>
<bufferGeometry>
<bufferAttribute attach="attributes-position" args={[positions, 3]} />
</bufferGeometry>

<pointsMaterial
color="#b9fff7"
size={0.05}
sizeAttenuation
transparent
opacity={0.9}
depthWrite={false}
/>
</points>
);
}