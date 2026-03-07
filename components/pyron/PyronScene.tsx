"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import PyronField from "./PyronField";
import PyronCore from "./PyronCore";

function CameraDrift() {
useFrame(({ camera, clock }) => {
const t = clock.getElapsedTime() * 0.08;
camera.position.x = Math.sin(t) * 0.55;
camera.position.y = Math.sin(t * 0.72) * 0.18;
camera.position.z = 5.6 + Math.cos(t) * 0.22;
camera.lookAt(0, 0, 0);
});

return null;
}

function Atmosphere() {
return (
<>
<mesh position={[0, 0, -2.4]}>
<planeGeometry args={[18, 18]} />
<meshBasicMaterial color="#031317" transparent opacity={0.9} />
</mesh>

<mesh position={[0, 0, -1.6]}>
<planeGeometry args={[16, 16]} />
<meshBasicMaterial color="#0a3438" transparent opacity={0.12} />
</mesh>
</>
);
}

export default function PyronScene() {
return (
<Canvas
camera={{ position: [0, 0, 5.6], fov: 58 }}
gl={{ antialias: true, alpha: true }}
style={{ width: "100%", height: "100%" }}
>
<color attach="background" args={["#020406"]} />

<fog attach="fog" args={["#031015", 4.8, 10.5]} />

<ambientLight intensity={0.22} />
<pointLight position={[2.6, 2.2, 3.8]} intensity={1.15} color="#98fff7" />
<pointLight position={[-3.6, -1.4, 2.4]} intensity={0.24} color="#22d7ff" />

<Atmosphere />
<CameraDrift />
<PyronField />
<PyronCore />

<EffectComposer>
<Bloom luminanceThreshold={0} luminanceSmoothing={0.92} intensity={1.55} />
</EffectComposer>
</Canvas>
);
}