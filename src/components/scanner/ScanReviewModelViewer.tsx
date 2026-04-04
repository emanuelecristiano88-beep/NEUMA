"use client";

import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Html,
  MeshTransmissionMaterial,
  OrbitControls,
} from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import * as THREE from "three";
import type { ObservationData } from "@/lib/aruco/poseEstimation";
import type { FootMeasurements } from "@/lib/scanner/finalizeScanData";
import { finalizeScanData } from "@/lib/scanner/finalizeScanData";
import {
  extractPlantMorphFromPointCloud,
  morphAvatarToClientData,
  NEUTRAL_PLANT_MORPH,
} from "@/lib/visualization/morphAvatarToClientData";
import { getThreePerformanceProfile } from "@/hooks/useThreePerformanceProfile";

const FALLBACK_SHEET_MM = { widthMm: 210, heightMm: 297 } as const;

// ─── Timing (ms) ─────────────────────────────────────────────────────────────
const ENTRY_MS = 880;
const MORPH_MS = 1050;
const MORPH_DELAY_MS = 90;
const CALLOUT_MS = 740;
const CALLOUT_DELAY_MS = 340;
const COUNT_MS = 1000;
const COUNT_DELAY_MS = 240;

function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

function easeOutQuart(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 4);
}

function useFirstMeshGeometryFromObj(obj: THREE.Group): THREE.BufferGeometry | null {
  return useMemo(() => {
    let geo: THREE.BufferGeometry | null = null;
    obj.traverse((child) => {
      if (!geo && (child as THREE.Mesh).isMesh) {
        geo = (child as THREE.Mesh).geometry.clone();
      }
    });
    geo?.computeVertexNormals();
    return geo;
  }, [obj]);
}

function useFresnelRimMaterial() {
  return useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: {
        uColor: { value: new THREE.Color("#7fefff") },
        uPower: { value: 2.35 },
        uAlpha: { value: 0 },
      },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vP = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vN;
        varying vec3 vP;
        uniform vec3 uColor;
        uniform float uPower;
        uniform float uAlpha;
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(vP);
          float f = pow(1.0 - max(dot(n, v), 0.0), uPower);
          gl_FragColor = vec4(uColor * f, f * 0.72 * uAlpha);
        }
      `,
    });
  }, []);
}

function TransmissionBackdrop() {
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[1400, 40, 32]} />
      <meshBasicMaterial color="#030b18" side={THREE.BackSide} depthWrite={false} />
    </mesh>
  );
}

type CalloutSeg = { a: THREE.Vector3; b: THREE.Vector3 };

function buildCalloutSegments(box: THREE.Box3): {
  heel: CalloutSeg;
  toe: CalloutSeg;
  lateral: CalloutSeg;
  medial: CalloutSeg;
  ankle: CalloutSeg;
} {
  const { min, max } = box;
  const cx = (min.x + max.x) * 0.5;
  const cy = (min.y + max.y) * 0.5;
  const cz = (min.z + max.z) * 0.5;
  const sx = max.x - min.x;
  const sy = max.y - min.y;
  const sz = max.z - min.z;
  const ext = Math.max(sx, sy, sz) * 0.24;

  const heel = new THREE.Vector3(cx, min.y + sy * 0.15, min.z + sz * 0.06);
  const toe = new THREE.Vector3(cx, min.y + sy * 0.13, max.z - sz * 0.06);
  const lat = new THREE.Vector3(max.x - sx * 0.03, cy, cz);
  const med = new THREE.Vector3(min.x + sx * 0.03, cy, cz);
  const ankle = new THREE.Vector3(cx, max.y - sy * 0.04, cz);

  return {
    heel: { a: heel, b: heel.clone().add(new THREE.Vector3(-ext * 0.4, sy * 0.07, -ext * 1.05)) },
    toe: { a: toe, b: toe.clone().add(new THREE.Vector3(ext * 0.25, sy * 0.06, ext * 1.05)) },
    lateral: { a: lat, b: lat.clone().add(new THREE.Vector3(ext * 1.05, sy * 0.04, sz * 0.05)) },
    medial: { a: med, b: med.clone().add(new THREE.Vector3(-ext * 1.05, sy * 0.04, sz * 0.05)) },
    ankle: { a: ankle, b: ankle.clone().add(new THREE.Vector3(-ext * 0.5, ext * 0.95, -sz * 0.04)) },
  };
}

function makeThinLineGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  return g;
}

function ReviewAnimatedScene({
  observations,
  measurements,
  onInteractionStart,
  liteGpu,
}: {
  observations: ObservationData[];
  measurements: FootMeasurements | null;
  onInteractionStart?: () => void;
  liteGpu: boolean;
}) {
  const obj = useLoader(OBJLoader, "/models/feet.obj") as THREE.Group;
  const template = useFirstMeshGeometryFromObj(obj);
  const rimMat = useFresnelRimMaterial();
  const mountedAtRef = useRef(performance.now());
  const normScaleRef = useRef(1);
  const frameRef = useRef(0);

  const physicalMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const transmissionMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);

  const rootScaleGroupRef = useRef<THREE.Group>(null);
  const liftGroupRef = useRef<THREE.Group>(null);
  const rotGroupRef = useRef<THREE.Group>(null);

  const lineGeomHeel = useMemo(() => makeThinLineGeometry(), []);
  const lineGeomToe = useMemo(() => makeThinLineGeometry(), []);
  const lineGeomLat = useMemo(() => makeThinLineGeometry(), []);
  const lineGeomMed = useMemo(() => makeThinLineGeometry(), []);
  const lineGeomAnkle = useMemo(() => makeThinLineGeometry(), []);

  const labelLRef = useRef<HTMLSpanElement>(null);
  const labelW1Ref = useRef<HTMLSpanElement>(null);
  const labelW2Ref = useRef<HTMLSpanElement>(null);
  const labelHRef = useRef<HTMLSpanElement>(null);

  const toeLabelGroupRef = useRef<THREE.Group>(null);
  const latLabelGroupRef = useRef<THREE.Group>(null);
  const medLabelGroupRef = useRef<THREE.Group>(null);
  const ankleLabelGroupRef = useRef<THREE.Group>(null);

  const effectiveMeasurements = useMemo((): FootMeasurements => {
    if (measurements) return measurements;
    return finalizeScanData({
      capturedPoints: observations,
      textureFrameCount: 0,
      scanDurationMs: null,
      sheetDimensions: { ...FALLBACK_SHEET_MM },
    }).measurements;
  }, [measurements, observations]);

  const plant = useMemo(() => extractPlantMorphFromPointCloud(observations), [observations]);

  const startMs = useMemo(() => {
    const e = effectiveMeasurements;
    return {
      lengthMm: Math.max(210, e.lengthMm - Math.max(22, Math.round(e.lengthMm * 0.095))),
      widthMm: Math.max(78, e.widthMm - Math.max(10, Math.round(e.widthMm * 0.11))),
      instepHeightMm: Math.max(48, e.instepHeightMm - Math.max(8, Math.round(e.instepHeightMm * 0.14))),
    };
  }, [effectiveMeasurements]);

  const startGeom = useMemo(() => {
    if (!template) return null;
    return morphAvatarToClientData(template, {
      lengthMm: startMs.lengthMm,
      widthMm: startMs.widthMm,
      instepHeightMm: startMs.instepHeightMm,
      plant: NEUTRAL_PLANT_MORPH,
    });
  }, [template, startMs]);

  const endGeom = useMemo(() => {
    if (!template) return null;
    return morphAvatarToClientData(template, {
      lengthMm: effectiveMeasurements.lengthMm,
      widthMm: effectiveMeasurements.widthMm,
      instepHeightMm: effectiveMeasurements.instepHeightMm,
      plant,
    });
  }, [template, effectiveMeasurements, plant]);

  const startPositions = useMemo(() => {
    if (!startGeom) return null;
    return new Float32Array((startGeom.getAttribute("position") as THREE.BufferAttribute).array);
  }, [startGeom]);

  const endPositions = useMemo(() => {
    if (!endGeom) return null;
    return new Float32Array((endGeom.getAttribute("position") as THREE.BufferAttribute).array);
  }, [endGeom]);

  const displayGeom = useMemo(() => startGeom?.clone() ?? null, [startGeom]);

  const targets = effectiveMeasurements;

  useEffect(() => {
    return () => {
      startGeom?.dispose();
      endGeom?.dispose();
      displayGeom?.dispose();
      lineGeomHeel.dispose();
      lineGeomToe.dispose();
      lineGeomLat.dispose();
      lineGeomMed.dispose();
      lineGeomAnkle.dispose();
      rimMat.dispose();
    };
  }, [startGeom, endGeom, displayGeom, lineGeomHeel, lineGeomToe, lineGeomLat, lineGeomMed, lineGeomAnkle, rimMat]);

  const normScale = useMemo(() => {
    const m = Math.max(targets.lengthMm, targets.widthMm, targets.instepHeightMm, 1);
    return 0.86 / m;
  }, [targets]);

  useLayoutEffect(() => {
    normScaleRef.current = normScale;
  }, [normScale]);

  const lineMatHeel = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: true,
      }),
    [],
  );
  const lineMatToe = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: true }),
    [],
  );
  const lineMatLat = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: true }),
    [],
  );
  const lineMatMed = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: true }),
    [],
  );
  const lineMatAnkle = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: true }),
    [],
  );

  useEffect(() => {
    return () => {
      lineMatHeel.dispose();
      lineMatToe.dispose();
      lineMatLat.dispose();
      lineMatMed.dispose();
      lineMatAnkle.dispose();
    };
  }, [lineMatHeel, lineMatToe, lineMatLat, lineMatMed, lineMatAnkle]);

  const writeLine = (geom: THREE.BufferGeometry, seg: CalloutSeg) => {
    const arr = (geom.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    arr[0] = seg.a.x;
    arr[1] = seg.a.y;
    arr[2] = seg.a.z;
    arr[3] = seg.b.x;
    arr[4] = seg.b.y;
    arr[5] = seg.b.z;
    (geom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };

  useFrame(() => {
    if (!displayGeom || !startPositions || !endPositions) return;

    const elapsed = performance.now() - mountedAtRef.current;
    const entryT = easeOutCubic(elapsed / ENTRY_MS);
    const morphT = easeOutCubic(Math.max(0, elapsed - MORPH_DELAY_MS) / MORPH_MS);
    const calloutT = easeOutQuart(Math.max(0, elapsed - CALLOUT_DELAY_MS) / CALLOUT_MS);
    const countT = easeOutCubic(Math.max(0, elapsed - COUNT_DELAY_MS) / COUNT_MS);

    const posAttr = displayGeom.getAttribute("position") as THREE.BufferAttribute;
    const out = posAttr.array as Float32Array;
    const n = Math.min(out.length, startPositions.length, endPositions.length);
    for (let i = 0; i < n; i++) {
      out[i] = startPositions[i]! + (endPositions[i]! - startPositions[i]!) * morphT;
    }
    posAttr.needsUpdate = true;

    frameRef.current++;
    if (frameRef.current % 4 === 0 || morphT >= 0.995) {
      displayGeom.computeVertexNormals();
    }
    displayGeom.computeBoundingBox();
    const box = displayGeom.boundingBox!;
    const lift = -box.min.y;
    if (liftGroupRef.current) liftGroupRef.current.position.y = lift;

    const segs = buildCalloutSegments(box);
    writeLine(lineGeomHeel, segs.heel);
    writeLine(lineGeomToe, segs.toe);
    writeLine(lineGeomLat, segs.lateral);
    writeLine(lineGeomMed, segs.medial);
    writeLine(lineGeomAnkle, segs.ankle);

    const lineOpacity = 0.08 + 0.82 * calloutT;
    lineMatHeel.opacity = lineOpacity;
    lineMatToe.opacity = lineOpacity;
    lineMatLat.opacity = lineOpacity;
    lineMatMed.opacity = lineOpacity;
    lineMatAnkle.opacity = lineOpacity;

    const pulse =
      entryT >= 1 ? 1 + 0.018 * Math.sin(elapsed * 0.0033) : 1 + 0.012 * Math.sin(elapsed * 0.004) * entryT;
    const entryScale = 0.82 + 0.18 * entryT;
    const s = normScaleRef.current * entryScale * pulse;
    if (rootScaleGroupRef.current) {
      rootScaleGroupRef.current.scale.setScalar(s);
    }

    const fade = 0.06 + 0.94 * entryT;
    const pm = physicalMatRef.current;
    if (pm) pm.opacity = fade;
    const tm = transmissionMatRef.current;
    if (tm) tm.opacity = fade;
    rimMat.uniforms.uAlpha!.value = fade;

    if (rotGroupRef.current) {
      rotGroupRef.current.rotation.y = 0.15 + Math.sin(elapsed * 0.0022) * 0.055 * (0.5 + 0.5 * entryT);
    }

    const vL = Math.round(targets.lengthMm * countT);
    const vW = Math.round(targets.widthMm * countT);
    const vH = Math.round(targets.instepHeightMm * countT);
    if (labelLRef.current) labelLRef.current.textContent = `${vL} mm`;
    if (labelW1Ref.current) labelW1Ref.current.textContent = `${vW} mm`;
    if (labelW2Ref.current) labelW2Ref.current.textContent = `${vW} mm`;
    if (labelHRef.current) labelHRef.current.textContent = `${vH} mm`;

    if (toeLabelGroupRef.current) toeLabelGroupRef.current.position.copy(segs.toe.b);
    if (latLabelGroupRef.current) latLabelGroupRef.current.position.copy(segs.lateral.b);
    if (medLabelGroupRef.current) medLabelGroupRef.current.position.copy(segs.medial.b);
    if (ankleLabelGroupRef.current) ankleLabelGroupRef.current.position.copy(segs.ankle.b);
  });

  const labelStyle: CSSProperties = {
    pointerEvents: "none",
    fontFamily: "ui-monospace, 'SF Mono', ui-rounded, -apple-system, sans-serif",
    fontSize: 11,
    fontWeight: 600,
    color: "rgba(255,255,255,0.92)",
    letterSpacing: "0.06em",
    textShadow: "0 0 12px rgba(56,189,248,0.45), 0 2px 8px rgba(0,0,0,0.6)",
    whiteSpace: "nowrap",
  };

  const subStyle: CSSProperties = {
    ...labelStyle,
    fontSize: 8,
    fontWeight: 500,
    opacity: 0.55,
    letterSpacing: "0.14em",
    marginBottom: 2,
  };

  if (!displayGeom || !startPositions || !endPositions) {
    return (
      <Html center style={{ pointerEvents: "none" }}>
        <span
          style={{
            fontFamily: "ui-rounded, -apple-system, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: "rgba(255,255,255,0.42)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          Caricamento avatar…
        </span>
      </Html>
    );
  }

  return (
    <>
      <color attach="background" args={["transparent"]} />
      <TransmissionBackdrop />

      <ambientLight intensity={0.28} />
      <directionalLight position={[2.8, 4.2, 2.2]} intensity={0.55} color="#e8f4ff" />
      <directionalLight position={[-2.4, 2.1, -1.6]} intensity={0.2} color="#a8d8f0" />
      <spotLight position={[0, 6, 1.2]} angle={0.5} penumbra={0.85} intensity={0.45} color="#cfefff" />

      {!liteGpu ? (
        <Suspense fallback={null}>
          <Environment preset="city" environmentIntensity={0.85} />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <Environment preset="studio" environmentIntensity={0.75} />
        </Suspense>
      )}

      <group ref={rootScaleGroupRef}>
        <group ref={liftGroupRef}>
          <group ref={rotGroupRef} rotation={[-0.1, 0.15, 0]}>
            <mesh geometry={displayGeom} castShadow receiveShadow>
              {liteGpu ? (
                <meshPhysicalMaterial
                  ref={physicalMatRef}
                  color="#b8f0ff"
                  emissive="#0a3d52"
                  emissiveIntensity={0.35}
                  metalness={0.02}
                  roughness={0.08}
                  transmission={0.62}
                  thickness={0.55}
                  ior={1.47}
                  clearcoat={0.85}
                  clearcoatRoughness={0.06}
                  transparent
                  opacity={0}
                  attenuationColor="#5ec8e8"
                  attenuationDistance={0.45}
                  envMapIntensity={1.2}
                  side={THREE.DoubleSide}
                />
              ) : (
                <MeshTransmissionMaterial
                  ref={transmissionMatRef}
                  backside
                  samples={8}
                  resolution={384}
                  transmission={1}
                  thickness={0.55}
                  roughness={0.08}
                  chromaticAberration={0.04}
                  anisotropicBlur={0.22}
                  distortion={0.12}
                  distortionScale={0.35}
                  temporalDistortion={0.08}
                  color="#9ee8ff"
                  metalness={0.05}
                  ior={1.48}
                  background={new THREE.Color("#030b18")}
                  transparent
                  opacity={0}
                />
              )}
            </mesh>
            <mesh geometry={displayGeom} material={rimMat} scale={1.014} />

            <lineSegments geometry={lineGeomHeel} material={lineMatHeel} />
            <lineSegments geometry={lineGeomToe} material={lineMatToe} />
            <lineSegments geometry={lineGeomLat} material={lineMatLat} />
            <lineSegments geometry={lineGeomMed} material={lineMatMed} />
            <lineSegments geometry={lineGeomAnkle} material={lineMatAnkle} />

            <group ref={toeLabelGroupRef}>
              <Html center transform occlude={false} style={{ pointerEvents: "none" }} distanceFactor={0.55}>
                <div style={{ textAlign: "center" }}>
                  <div style={subStyle}>LUNGHEZZA</div>
                  <span ref={labelLRef} style={labelStyle}>
                    0 mm
                  </span>
                </div>
              </Html>
            </group>
            <group ref={latLabelGroupRef}>
              <Html center transform occlude={false} style={{ pointerEvents: "none" }} distanceFactor={0.52}>
                <div style={{ textAlign: "center" }}>
                  <div style={subStyle}>LARGHEZZA</div>
                  <span ref={labelW1Ref} style={labelStyle}>
                    0 mm
                  </span>
                </div>
              </Html>
            </group>
            <group ref={medLabelGroupRef}>
              <Html center transform occlude={false} style={{ pointerEvents: "none" }} distanceFactor={0.52}>
                <div style={{ textAlign: "center" }}>
                  <div style={subStyle}>LARGHEZZA</div>
                  <span ref={labelW2Ref} style={labelStyle}>
                    0 mm
                  </span>
                </div>
              </Html>
            </group>
            <group ref={ankleLabelGroupRef}>
              <Html center transform occlude={false} style={{ pointerEvents: "none" }} distanceFactor={0.52}>
                <div style={{ textAlign: "center" }}>
                  <div style={subStyle}>COLLO / INSTEP</div>
                  <span ref={labelHRef} style={labelStyle}>
                    0 mm
                  </span>
                </div>
              </Html>
            </group>
          </group>
        </group>
      </group>

      <ContactShadows
        position={[0, -0.008, 0]}
        opacity={liteGpu ? 0.22 : 0.3}
        scale={2.2}
        blur={2.2}
        far={2.5}
      />

      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        autoRotate={false}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.82}
        zoomSpeed={0.92}
        panSpeed={0.62}
        minDistance={0.35}
        maxDistance={2.8}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI - 0.15}
        onStart={() => onInteractionStart?.()}
      />
    </>
  );
}

export type ScanReviewModelViewerProps = {
  observations: ObservationData[];
  measurements: FootMeasurements | null;
  onInteractionStart?: () => void;
};

export function ScanReviewModelViewer({
  observations,
  measurements,
  onInteractionStart,
}: ScanReviewModelViewerProps) {
  const perf = useMemo(() => getThreePerformanceProfile(), []);
  const liteGpu = perf.isMobileOrLowTier;

  if (observations.length < 3) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, rgba(4,10,28,0.95) 0%, rgba(2,5,18,0.98) 100%)",
        }}
      >
        <p
          style={{
            fontFamily: "ui-rounded, -apple-system, sans-serif",
            fontSize: 14,
            color: "rgba(255,255,255,0.45)",
            textAlign: "center",
            padding: 24,
          }}
        >
          Dati insufficienti per il modello personalizzato.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        touchAction: "none",
        isolation: "isolate",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 90% 70% at 50% 38%, rgba(56,189,248,0.14) 0%, transparent 52%), linear-gradient(165deg, #020617 0%, #0a1628 45%, #020617 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backdropFilter: "blur(26px) saturate(1.15)",
          WebkitBackdropFilter: "blur(26px) saturate(1.15)",
          background: "rgba(2, 8, 22, 0.42)",
          pointerEvents: "none",
        }}
      />
      <Canvas
        dpr={liteGpu ? [1, 1.25] : [1, Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1.65)]}
        frameloop="always"
        camera={{ position: [0.42, 0.32, 0.95], fov: 38, near: 0.02, far: 80 }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          position: "relative",
          zIndex: 1,
          background: "transparent",
        }}
        onPointerDown={() => onInteractionStart?.()}
      >
        <Suspense
          fallback={
            <Html center style={{ pointerEvents: "none" }}>
              <span
                style={{
                  fontFamily: "ui-rounded, -apple-system, sans-serif",
                  fontSize: 13,
                  color: "rgba(255,255,255,0.4)",
                }}
              >
                Caricamento…
              </span>
            </Html>
          }
        >
          <ReviewAnimatedScene
            observations={observations}
            measurements={measurements}
            onInteractionStart={onInteractionStart}
            liteGpu={liteGpu}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
