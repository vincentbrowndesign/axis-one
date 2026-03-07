"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useSensor } from "../../lib/pyron/useSensor";

export default function PyronCore() {
const coreRef = useRef<THREE.Mesh>(null);
const haloRef = useRef<THREE.Mesh>(null);
const outerHaloRef = useRef<THREE.Mesh>(null);
const energy = useSensor();

useFrame(({ clock }) => {
const t = clock.getElapsedTime();
const e = Math.min(1.4, energy.current * 0.02);

if (coreRef.current) {
const scale = 1 + e * 0.18 + Math.sin(t * 1.6) * (0.025 + e * 0.03);
coreRef.current.scale.set(scale, scale, scale);
coreRef.current.rotation.y += 0.002;

const material = coreRef.current.material as THREE.MeshStandardMaterial;
material.emissiveIntensity = 1.8 + e * 2.4;
}

if (haloRef.current) {
const scale = 1.28 + e * 0.16 + Math.sin(t * 1.2) * 0.04;
haloRef.current.scale.set(scale, scale, scale);

const material = haloRef.current.material as THREE.MeshBasicMaterial;
material.opacity = 0.12 + e * 0.08 + Math.sin(t * 1.5) * 0.02;
}

if (outerHaloRef.current) {
const scale = 1.62 + e * 0.2 + Math.sin(t * 0.85) * 0.05;
outerHaloRef.current.scale.set(scale, scale, scale);

const material = outerHaloRef.current.material as THREE.MeshBasicMaterial;
material.opacity = 0.05 + e * 0.04 + Math.sin(t * 1.1) * 0.01;
}
});

return (
<group>
<mesh ref={outerHaloRef}>
<sphereGeometry args={[1, 48, 48]} />
<meshBasicMaterial
color="#72fff6"
transparent
opacity={0.05}
depthWrite={false}
/>
</mesh>

<mesh ref={haloRef}>
<sphereGeometry args={[1, 64, 64]} />
<meshBasicMaterial
color="#7ef9f2"
transparent
opacity={0.14}
depthWrite={false}
/>
</mesh>

<mesh ref={coreRef}>
<sphereGeometry args={[1, 64, 64]} />
<meshStandardMaterial
color="#9ffff7"
emissive="#2af8ee"
emissiveIntensity={2}
metalness={0}
roughness={0.18}
/>
</mesh>
</group>
);
}