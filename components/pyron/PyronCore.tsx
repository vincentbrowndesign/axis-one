"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useSensor } from "../../lib/pyron/useSensor";

export default function PyronCore() {
const coreRef = useRef<THREE.Mesh>(null);
const haloRef = useRef<THREE.Mesh>(null);
const energyRef = useSensor();

useFrame(({ clock }) => {
const t = clock.getElapsedTime();
const energy = Math.min(1.25, energyRef.current * 0.02);

if (coreRef.current) {
const s = 1 + Math.sin(t * 1.6) * (0.035 + energy * 0.12);
coreRef.current.scale.setScalar(s);

const material = coreRef.current.material as THREE.MeshStandardMaterial;
material.emissiveIntensity = 2.2 + energy * 2.2;
}

if (haloRef.current) {
const s = 1.35 + Math.sin(t * 1.2) * (0.05 + energy * 0.06);
haloRef.current.scale.setScalar(s);

const material = haloRef.current.material as THREE.MeshBasicMaterial;
material.opacity = 0.14 + Math.sin(t * 1.5) * 0.03 + energy * 0.07;
}
});

return (
<group>
<mesh ref={haloRef}>
<sphereGeometry args={[1.45, 64, 64]} />
<meshBasicMaterial
color="#7ef9f2"
transparent
opacity={0.16}
depthWrite={false}
/>
</mesh>

<mesh ref={coreRef}>
<sphereGeometry args={[1, 64, 64]} />
<meshStandardMaterial
color="#9bfff8"
emissive="#38fff2"
emissiveIntensity={2.4}
roughness={0.18}
metalness={0.05}
/>
</mesh>
</group>
);
}