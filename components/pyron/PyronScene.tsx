"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import PyronField from "./PyronField";
import PyronCore from "./PyronCore";

function CameraOrbit() {
useFrame(({ camera, clock }) => {
const t = clock.getElapsedTime() * 0.12;
camera.position.x = Math.sin(t) * 0.9;
camera.position.z = 5 + Math.cos(t) * 0.35;
camera.position.y = Math.sin(t * 0.7) * 0.12;
camera.lookAt(new THREE.Vector3(0, 0, 0));
});

return null;
}

export default function PyronScene() {
return (
<Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
<color attach="background" args={["#020406"]} />

<ambientLight intensity={0.3} />
<pointLight position={[3, 3, 4]} intensity={1.2} color="#8ffcf6" />
<pointLight position={[-4, -2, 3]} intensity={0.35} color="#2fd6ff" />

<CameraOrbit />
<PyronField />
<PyronCore />

<EffectComposer>
<Bloom luminanceThreshold={0} luminanceSmoothing={0.9} intensity={2} />
</EffectComposer>
</Canvas>
);
}