'use client';
import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Stars, MeshDistortMaterial } from '@react-three/drei';
import type { Group } from 'three';

function Blob({ position, color, speed = 1, scale = 1, distort = 0.35 }:
  { position: [number, number, number]; color: string; speed?: number; scale?: number; distort?: number }) {
  return (
    <Float speed={speed} rotationIntensity={1.1} floatIntensity={1.3}>
      <mesh position={position} scale={scale}>
        <icosahedronGeometry args={[1, 4]} />
        <MeshDistortMaterial color={color} roughness={0.2} metalness={0.5} distort={distort} speed={1.6} />
      </mesh>
    </Float>
  );
}

function Rig({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) group.current.rotation.y = Math.sin(t * 0.08) * 0.25;
    state.camera.position.x += (state.pointer.x * 0.7 - state.camera.position.x) * 0.03;
    state.camera.position.y += (state.pointer.y * 0.45 - state.camera.position.y) * 0.03;
    state.camera.lookAt(0, 0, 0);
  });
  return <group ref={group}>{children}</group>;
}

export default function HeroScene({ count = 2400 }: { count?: number }) {
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 0, 7], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ pointerEvents: 'none' }}>
      <ambientLight intensity={0.7} />
      <pointLight position={[6, 5, 5]} intensity={2.2} color="#a855f7" />
      <pointLight position={[-6, -3, 2]} intensity={1.6} color="#6366f1" />
      <pointLight position={[0, 4, -4]} intensity={1.2} color="#ec4899" />
      <Stars radius={42} depth={55} count={count} factor={4} saturation={0} fade speed={0.5} />
      <Rig>
        <Blob position={[-2.6, 0.6, 0]} color="#6366f1" speed={1.1} scale={1.25} />
        <Blob position={[2.7, -0.7, -1]} color="#a855f7" speed={0.9} scale={1.55} distort={0.4} />
        <Blob position={[0.6, 1.7, -2]} color="#ec4899" speed={1.3} scale={0.8} distort={0.3} />
      </Rig>
    </Canvas>
  );
}
