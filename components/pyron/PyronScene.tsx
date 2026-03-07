"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import PyronField from "./PyronField";
import PyronCore from "./PyronCore";

export default function PyronScene() {
return (
<Canvas camera={{ position: [0, 0, 8], fov: 50 }}>
<color attach="background" args={["#020406"]} />

<ambientLight intensity={0.35} />
<pointLight position={[4, 4, 5]} intensity={1.8} color="#b8fffb" />
<pointLight position={[-5, -3, -4]} intensity={0.45} color="#4cc9ff" />

<PyronField />
<PyronCore />

<EffectComposer>
<Bloom
intensity={1.2}
luminanceThreshold={0.15}
luminanceSmoothing={0.9}
/>
</EffectComposer>

<OrbitControls enableZoom={false} enablePan={false} />
</Canvas>
);
}