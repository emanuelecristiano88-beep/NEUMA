"use client";

/**
 * Viewer 3D biometrico: piede con materiale tipo “mappa calore” / scansione laser + griglia millimetrica.
 */
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

type Metrics = { footLengthMm: number; forefootWidthMm: number };

type DigitalFittingViewerProps = {
  shoeTransparencyPercent: number;
  metrics?: Metrics | null;
  footPlaceholderUrl?: string | null;
  shoeUrl?: string;
  className?: string;
};

function computeOffsetToCenterAndDrop(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  return new THREE.Vector3(-center.x, -minY, -center.z);
}

/** Texture gradiente azzurro/blu elettrico (effetto scansione). */
function useHeatScanTexture() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      const fallback = new THREE.Texture();
      return fallback;
    }
    const g = ctx.createLinearGradient(0, 256, 256, 0);
    g.addColorStop(0, "#020617");
    g.addColorStop(0.25, "#0369a1");
    g.addColorStop(0.55, "#22d3ee");
    g.addColorStop(0.8, "#3b82f6");
    g.addColorStop(1, "#6366f1");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.2, 1.2);
    return tex;
  }, []);
}

const footMat = {
  color: "#e0f2fe" as const,
  metalness: 0.22,
  roughness: 0.35,
  clearcoat: 0.55,
  clearcoatRoughness: 0.28,
  emissive: "#1d4ed8" as const,
  emissiveIntensity: 0.22,
};

/** Piede placeholder con MeshPhysicalMaterial “laser / heat map”. */
function HeatScannedFootPlaceholder({ scaleFactor }: { scaleFactor: number }) {
  const map = useHeatScanTexture();
  const s = scaleFactor * 0.95;

  return (
    <group scale={[s, s, s]} position={[0, 0.02, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.035, 0.06]} rotation={[0.15, 0, 0]}>
        <capsuleGeometry args={[0.055, 0.14, 8, 24]} />
        <meshPhysicalMaterial {...footMat} map={map} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.04, -0.05]}>
        <sphereGeometry args={[0.07, 24, 24]} />
        <meshPhysicalMaterial {...footMat} map={map} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.012, 0]}>
        <boxGeometry args={[0.09, 0.024, 0.22]} />
        <meshPhysicalMaterial {...footMat} map={map} />
      </mesh>
    </group>
  );
}

function applyShoeOpacity(root: THREE.Object3D, opacity: number) {
  const clamped = THREE.MathUtils.clamp(opacity, 0.05, 1);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      const m = mat as THREE.MeshStandardMaterial;
      m.transparent = true;
      m.opacity = clamped;
      m.depthWrite = clamped > 0.92;
      m.needsUpdate = true;
    });
  });
}

function ShoeOverlay({
  shoeUrl,
  metrics,
  opacity,
}: {
  shoeUrl: string;
  metrics: Metrics | null;
  opacity: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(shoeUrl) as unknown as { scene: THREE.Object3D };
  const scaleFactor = metrics ? metrics.footLengthMm / 280 : 1;
  const offset = useMemo(() => computeOffsetToCenterAndDrop(scene), [scene]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(offset);
  }, [offset]);

  useEffect(() => {
    applyShoeOpacity(scene, opacity);
  }, [scene, opacity]);

  return (
    <group ref={groupRef} scale={[scaleFactor, scaleFactor, scaleFactor]}>
      <primitive object={scene} />
    </group>
  );
}

function MillimeterGrid() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(1.6, 32, 0x3b82f6, 0x3f3f46);
    g.position.y = -0.02;
    return g;
  }, []);
  return <primitive object={grid} />;
}

function SceneContent({
  shoeUrl,
  metrics,
  shoeTransparencyPercent,
}: {
  shoeUrl: string;
  metrics: Metrics | null;
  shoeTransparencyPercent: number;
}) {
  const scaleFactor = metrics ? metrics.footLengthMm / 280 : 1;
  const shoeOpacity = 1 - shoeTransparencyPercent / 100;

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[0.45, 0.95, 0.4]} intensity={1.25} color="#ffffff" />
      <directionalLight position={[-0.55, 0.35, -0.25]} intensity={0.45} color="#38bdf8" />
      <pointLight position={[0, 0.35, 0.2]} intensity={0.35} color="#93c5fd" distance={2} />

      <MillimeterGrid />
      <HeatScannedFootPlaceholder scaleFactor={scaleFactor} />

      <Suspense
        fallback={
          <Html center>
            <div className="rounded border border-blue-500/40 bg-black/70 px-3 py-2 text-xs text-blue-200">
              Caricamento scarpa (fitting)…
            </div>
          </Html>
        }
      >
        <Environment preset="studio" intensity={0.55} />
        <ShoeOverlay shoeUrl={shoeUrl} metrics={metrics} opacity={shoeOpacity} />
      </Suspense>
      <OrbitControls enablePan={false} minDistance={0.35} maxDistance={1.4} target={[0, 0.06, 0]} />
    </>
  );
}

export default function DigitalFittingViewer({
  shoeTransparencyPercent,
  metrics = { footLengthMm: 265, forefootWidthMm: 95 },
  shoeUrl = "/models/placeholder_sneaker.glb",
  className = "h-full min-h-[280px] w-full",
}: DigitalFittingViewerProps) {
  return (
    <div className={className}>
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        frameloop="always"
        camera={{ position: [0.28, 0.22, 0.72], fov: 38 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      >
        <SceneContent
          shoeUrl={shoeUrl}
          metrics={metrics}
          shoeTransparencyPercent={shoeTransparencyPercent}
        />
      </Canvas>
    </div>
  );
}
