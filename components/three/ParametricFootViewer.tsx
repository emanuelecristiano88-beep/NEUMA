"use client";

/**
 * React Three Fiber viewer for the parametric foot model.
 *
 * Responsibilities:
 *  - Receives FootParameters and rebuild options as props
 *  - Calls buildParametricFootGeometry in a Worker-free but async-safe way
 *    (heavy computation is deferred via requestAnimationFrame to keep UI responsive)
 *  - Renders the resulting mesh with a studio-quality skin-tone material
 *  - Exposes orbit controls, auto-rotation, and a wireframe overlay toggle
 *  - Shows a build-progress overlay while rebuilding
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import {
  buildParametricFootGeometry,
  type FootParameters,
  type MeshBuilderOptions,
} from "@/lib/parametricFoot";

// ─── Types ────────────────────────────────────────────────────────────────────

type ParametricFootViewerProps = {
  parameters: FootParameters;
  builderOptions?: Partial<MeshBuilderOptions>;
  /** rad/s auto-rotation speed; 0 = disabled */
  autoRotateSpeed?: number;
  wireframe?: boolean;
  /** Height of the canvas container */
  height?: number | string;
  className?: string;
};

// ─── Material constants ───────────────────────────────────────────────────────

const SKIN_COLOR      = "#d4a88a";
const SKIN_ROUGHNESS  = 0.72;
const SKIN_METALNESS  = 0.04;
const SKIN_CLEARCOAT  = 0.22;
const SKIN_CLEARCOAT_ROUGHNESS = 0.55;
const SKIN_SUBSURFACE = "#e8c4a8"; // simulated SSS via emissive tint
const SKIN_EMISSIVE_INTENSITY = 0.04;

// ─── Inner scene component ───────────────────────────────────────────────────

type SceneProps = {
  parameters: FootParameters;
  builderOptions?: Partial<MeshBuilderOptions>;
  autoRotateSpeed: number;
  wireframe: boolean;
};

function ParametricFootScene({
  parameters,
  builderOptions,
  autoRotateSpeed,
  wireframe,
}: SceneProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const groupRef = useRef<THREE.Group>(null);
  const userInteracting = useRef(false);
  const rafRef = useRef<number | null>(null);
  const { invalidate } = useThree();

  // ── Rebuild mesh when parameters change ─────────────────────────────────────
  useEffect(() => {
    setBuilding(true);
    setBuildError(null);

    // Defer heavy computation one animation frame so React can update UI first
    rafRef.current = requestAnimationFrame(() => {
      try {
        const result = buildParametricFootGeometry(parameters, builderOptions);
        if (!result) {
          setBuildError("Mesh degenerate — adjust parameters.");
          setBuilding(false);
          return;
        }
        setGeometry((prev) => {
          prev?.dispose();
          return result.geometry;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setBuildError(`Build error: ${msg}`);
      } finally {
        setBuilding(false);
        invalidate();
      }
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [parameters, builderOptions, invalidate]);

  // Cleanup geometry on unmount
  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  // ── Auto-rotation ────────────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (!groupRef.current || userInteracting.current || autoRotateSpeed <= 0) return;
    if (building) return;
    groupRef.current.rotation.y += autoRotateSpeed * delta;
    invalidate();
  });

  return (
    <>
      {/* Lighting — studio three-point setup */}
      <ambientLight intensity={0.18} color="#f5f0eb" />
      <directionalLight
        castShadow
        color="#fff8f2"
        intensity={1.2}
        position={[-3, 6, 3]}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />
      <directionalLight color="#d0e8ff" intensity={0.28} position={[4, 2, -3]} />
      <directionalLight color="#ffe4c4" intensity={0.12} position={[0, -1, 1]} />

      {/* Contact shadow plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.45, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <shadowMaterial opacity={0.18} transparent />
      </mesh>

      {/* Environment for reflections */}
      <Environment preset="studio" intensity={0.35} environmentIntensity={0.7} />

      {/* Orbit controls */}
      <OrbitControls
        enablePan={false}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={0.6}
        maxDistance={3.5}
        enableDamping
        dampingFactor={0.08}
        onChange={() => invalidate()}
        onStart={() => { userInteracting.current = true; }}
        onEnd={() => { userInteracting.current = false; }}
      />

      {/* Building indicator */}
      {building && (
        <Html center>
          <div className="rounded-lg border border-blue-400/30 bg-black/70 px-4 py-2 text-xs text-blue-200 backdrop-blur-sm">
            Building model…
          </div>
        </Html>
      )}

      {/* Error indicator */}
      {buildError && !building && (
        <Html center>
          <div className="rounded-lg border border-red-400/40 bg-black/70 px-4 py-2 text-xs text-red-200">
            {buildError}
          </div>
        </Html>
      )}

      {/* Foot mesh */}
      <group ref={groupRef}>
        {geometry && !building && !buildError && (
          <>
            {/* Solid skin mesh */}
            <mesh geometry={geometry} castShadow receiveShadow>
              <meshPhysicalMaterial
                color={SKIN_COLOR}
                roughness={SKIN_ROUGHNESS}
                metalness={SKIN_METALNESS}
                clearcoat={SKIN_CLEARCOAT}
                clearcoatRoughness={SKIN_CLEARCOAT_ROUGHNESS}
                emissive={SKIN_SUBSURFACE}
                emissiveIntensity={SKIN_EMISSIVE_INTENSITY}
                wireframe={wireframe}
              />
            </mesh>

            {/* Optional wireframe overlay (when not in wireframe mode) */}
            {!wireframe && (
              <mesh geometry={geometry} scale={1.001} renderOrder={1}>
                <meshBasicMaterial
                  color="#8b6050"
                  wireframe
                  transparent
                  opacity={0.06}
                  depthWrite={false}
                />
              </mesh>
            )}
          </>
        )}
      </group>
    </>
  );
}

// ─── Public viewer component ─────────────────────────────────────────────────

function ParametricFootViewerImpl({
  parameters,
  builderOptions,
  autoRotateSpeed = 0.28,
  wireframe = false,
  height = 400,
  className = "",
}: ParametricFootViewerProps) {
  return (
    <div
      className={`w-full overflow-hidden rounded-xl border border-white/10 bg-black/20 ${className}`}
      style={{ height }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="demand"
        camera={{ position: [0.2, 0.1, 1.1], fov: 36 }}
        gl={{
          alpha: true,
          antialias: true,
          stencil: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}
      >
        <ParametricFootScene
          parameters={parameters}
          builderOptions={builderOptions}
          autoRotateSpeed={autoRotateSpeed}
          wireframe={wireframe}
        />
      </Canvas>
    </div>
  );
}

const ParametricFootViewer = memo(ParametricFootViewerImpl);
ParametricFootViewer.displayName = "ParametricFootViewer";

export default ParametricFootViewer;
export type { ParametricFootViewerProps };
