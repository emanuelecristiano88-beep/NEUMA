"use client";

/**
 * Pagina: SCAN DATA → parametri → modello base → deformazione → smoothing → render
 *
 * Permette di esplorare l'intera pipeline di ricostruzione 3D in modo interattivo,
 * partendo da dati di scansione (o da una nuvola demo) e modificando in tempo reale
 * i parametri di ogni stadio.
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import { cn } from "../lib/utils";
import type { PointCloud, FootSurfaceOptions, FootDeformOptions } from "../lib/reconstruction";
import {
  DEFAULT_FOOT_SURFACE_OPTIONS,
  DEFAULT_FOOT_DEFORM_OPTIONS,
  buildFootSurfaceFromPositions,
  laplacianSmoothGeometry,
  centerAndNormalizeFootMesh,
  deformFootGeometry,
} from "../lib/reconstruction";
import { generateDemoFootCloud } from "../lib/reconstruction/demoCloud";
import NeumaLogo from "../components/NeumaLogo";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

type PipelineStage = "scan" | "parametri" | "modello" | "deformazione" | "smoothing" | "render";

type ScanDataParams = {
  pointCount: number;
  /** 0 = usa nuvola demo, 1 = usa nuvola da sessionStorage (se presente) */
  useSessionCloud: boolean;
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function formatNum(n: number, dec = 2) {
  return n.toFixed(dec);
}

function useDebounce<T>(value: T, ms: number): T {
  const [dv, setDv] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return dv;
}

// --------------------------------------------------------------------------
// Compact 3-D viewer (R3F) for the render stage
// --------------------------------------------------------------------------

type FootMeshViewerProps = {
  geometry: THREE.BufferGeometry | null;
  heatmap?: boolean;
};

function FootMeshViewer({ geometry, heatmap = false }: FootMeshViewerProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const frameId = useRef(0);

  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      if (meshRef.current) {
        meshRef.current.rotation.y += 0.004;
      }
      frameId.current = requestAnimationFrame(animate);
    };
    frameId.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(frameId.current);
    };
  }, []);

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={heatmap ? "#ffffff" : "#d4d4d4"}
        roughness={0.55}
        metalness={0.08}
        vertexColors={heatmap}
      />
    </mesh>
  );
}

const FootMeshViewerMemo = memo(FootMeshViewer);

// --------------------------------------------------------------------------
// Collapsible section
// --------------------------------------------------------------------------

type SectionProps = {
  id: PipelineStage;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function PipelineSection({
  title,
  subtitle,
  badge,
  badgeColor = "bg-blue-600",
  active,
  open,
  onToggle,
  children,
}: SectionProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border transition-colors duration-200",
        active
          ? "border-blue-500/40 bg-zinc-900/90"
          : "border-zinc-800 bg-zinc-900/50"
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={onToggle}
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
            active ? badgeColor : "bg-zinc-700"
          )}
        >
          {badge}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-mono text-xs font-semibold uppercase tracking-[0.14em]",
              active ? "text-white" : "text-zinc-400"
            )}
          >
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
              {subtitle}
            </div>
          )}
        </div>
        <span className="text-zinc-500">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Slider row
// --------------------------------------------------------------------------

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
};

function SliderRow({ label, value, min, max, step = 0.01, unit = "", onChange }: SliderRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">{label}</span>
        <span className="font-mono text-[11px] text-zinc-300">
          {formatNum(value, step < 0.1 ? 2 : 0)}
          {unit}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Main page
// --------------------------------------------------------------------------

export default function ParametriModelloPage() {
  const navigate = useNavigate();

  // Open/closed state for each section
  const [openSections, setOpenSections] = useState<Set<PipelineStage>>(
    new Set(["scan"])
  );

  const toggleSection = useCallback((id: PipelineStage) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Stage 1: Scan Data ---
  const [scanParams, setScanParams] = useState<ScanDataParams>({
    pointCount: 1400,
    useSessionCloud: false,
  });
  const [sourceCloud, setSourceCloud] = useState<PointCloud | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);

  const generateCloud = useCallback(() => {
    setCloudBusy(true);
    setTimeout(() => {
      const cloud = generateDemoFootCloud(scanParams.pointCount);
      setSourceCloud(cloud);
      setCloudBusy(false);
      // Auto-open next stage
      setOpenSections((prev) => new Set([...prev, "parametri"]));
    }, 60);
  }, [scanParams.pointCount]);

  // Auto-generate on mount
  useEffect(() => {
    generateCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Stage 2: Parametri di ricostruzione ---
  const [reconParams, setReconParams] = useState<
    Pick<FootSurfaceOptions, "resolution" | "strength" | "subtract" | "isolation" | "fieldBlurPasses">
  >({
    resolution: DEFAULT_FOOT_SURFACE_OPTIONS.resolution,
    strength: DEFAULT_FOOT_SURFACE_OPTIONS.strength,
    subtract: DEFAULT_FOOT_SURFACE_OPTIONS.subtract,
    isolation: DEFAULT_FOOT_SURFACE_OPTIONS.isolation,
    fieldBlurPasses: DEFAULT_FOOT_SURFACE_OPTIONS.fieldBlurPasses,
  });

  // --- Stage 3: Modello base (output from marching cubes, pre-deform) ---
  const [baseGeometry, setBaseGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [baseBusy, setBaseBusy] = useState(false);

  const debouncedReconParams = useDebounce(reconParams, 280);

  useEffect(() => {
    if (!sourceCloud) return;
    setBaseBusy(true);
    const timer = setTimeout(() => {
      const opts: Partial<FootSurfaceOptions> = {
        ...debouncedReconParams,
        smoothIterations: 0, // smoothing is stage 5
        lambda: 0,
        maxSourcePoints: DEFAULT_FOOT_SURFACE_OPTIONS.maxSourcePoints,
      };
      const scaledPos = new Float32Array(sourceCloud.positions.length);
      for (let i = 0; i < sourceCloud.positions.length; i++) {
        scaledPos[i] = sourceCloud.positions[i] * 0.002;
      }
      const geom = buildFootSurfaceFromPositions(scaledPos, sourceCloud.pointCount, opts);
      setBaseGeometry((prev) => {
        prev?.dispose();
        return geom;
      });
      setBaseBusy(false);
      setOpenSections((prev) => new Set([...prev, "modello"]));
    }, 10);
    return () => clearTimeout(timer);
  }, [sourceCloud, debouncedReconParams]);

  // --- Stage 4: Deformazione ---
  const [deformParams, setDeformParams] = useState<FootDeformOptions>({
    ...DEFAULT_FOOT_DEFORM_OPTIONS,
  });

  const debouncedDeformParams = useDebounce(deformParams, 120);

  // --- Stage 5: Smoothing ---
  const [smoothParams, setSmoothParams] = useState({
    smoothIterations: DEFAULT_FOOT_SURFACE_OPTIONS.smoothIterations,
    lambda: DEFAULT_FOOT_SURFACE_OPTIONS.lambda,
  });

  const debouncedSmoothParams = useDebounce(smoothParams, 180);

  // --- Final geometry (deform + smooth) ---
  const [finalGeometry, setFinalGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [finalBusy, setFinalBusy] = useState(false);

  useEffect(() => {
    if (!baseGeometry) return;
    setFinalBusy(true);
    const timer = setTimeout(() => {
      // Clone to avoid mutating the base
      let g = baseGeometry.clone();

      // Deformazione
      g = deformFootGeometry(g, debouncedDeformParams);

      // Smoothing
      g = laplacianSmoothGeometry(g, debouncedSmoothParams.smoothIterations, debouncedSmoothParams.lambda);

      // Normalize after deform+smooth
      g = centerAndNormalizeFootMesh(g);

      setFinalGeometry((prev) => {
        prev?.dispose();
        return g;
      });
      setFinalBusy(false);
      setOpenSections((prev) => new Set([...prev, "deformazione", "smoothing", "render"]));
    }, 10);
    return () => clearTimeout(timer);
  }, [baseGeometry, debouncedDeformParams, debouncedSmoothParams]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      baseGeometry?.dispose();
      finalGeometry?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived stats
  const cloudStats = useMemo(() => {
    if (!sourceCloud) return null;
    return { n: sourceCloud.pointCount };
  }, [sourceCloud]);

  const baseStats = useMemo(() => {
    if (!baseGeometry) return null;
    const pos = baseGeometry.attributes.position;
    return {
      vertices: pos?.count ?? 0,
      triangles: (baseGeometry.index?.count ?? 0) / 3,
    };
  }, [baseGeometry]);

  const finalStats = useMemo(() => {
    if (!finalGeometry) return null;
    const pos = finalGeometry.attributes.position;
    return {
      vertices: pos?.count ?? 0,
      triangles: (finalGeometry.index?.count ?? 0) / 3,
    };
  }, [finalGeometry]);

  const resetAll = () => {
    setScanParams({ pointCount: 1400, useSessionCloud: false });
    setReconParams({
      resolution: DEFAULT_FOOT_SURFACE_OPTIONS.resolution,
      strength: DEFAULT_FOOT_SURFACE_OPTIONS.strength,
      subtract: DEFAULT_FOOT_SURFACE_OPTIONS.subtract,
      isolation: DEFAULT_FOOT_SURFACE_OPTIONS.isolation,
      fieldBlurPasses: DEFAULT_FOOT_SURFACE_OPTIONS.fieldBlurPasses,
    });
    setDeformParams({ ...DEFAULT_FOOT_DEFORM_OPTIONS });
    setSmoothParams({
      smoothIterations: DEFAULT_FOOT_SURFACE_OPTIONS.smoothIterations,
      lambda: DEFAULT_FOOT_SURFACE_OPTIONS.lambda,
    });
  };

  const anyBusy = cloudBusy || baseBusy || finalBusy;

  return (
    <div className="min-h-[100dvh] bg-zinc-950 pb-24 text-zinc-100">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
          onClick={() => navigate(-1)}
          aria-label="Indietro"
        >
          ‹
        </button>
        <NeumaLogo size="sm" />
        <div className="flex-1">
          <div className="font-mono text-[11px] tracking-[0.18em] text-blue-500">
            PARAMETRI MODELLO
          </div>
          <div className="text-[10px] text-zinc-500">
            scan data → parametri → modello base → deformazione → smoothing → render
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/70 px-3 text-[11px] text-zinc-400 hover:text-zinc-100"
          onClick={resetAll}
          title="Reset parametri"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      {/* Pipeline steps */}
      <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">

        {/* ── 1. SCAN DATA ── */}
        <PipelineSection
          id="scan"
          title="Scan Data"
          subtitle={cloudStats ? `${cloudStats.n} punti generati` : "Dati sorgente"}
          badge="1"
          badgeColor="bg-sky-600"
          active={!cloudBusy && !!sourceCloud}
          open={openSections.has("scan")}
          onToggle={() => toggleSection("scan")}
        >
          <div className="space-y-4">
            <SliderRow
              label="Punti nuvola"
              value={scanParams.pointCount}
              min={400}
              max={3000}
              step={100}
              unit=" pts"
              onChange={(v) =>
                setScanParams((p) => ({ ...p, pointCount: Math.round(v) }))
              }
            />

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sky-500">
                Nuvola demo sintetica
              </span>
              <p className="mt-1 leading-relaxed">
                Geometria piede generata proceduralmente — alluce, arco plantare, tallone e dita.
                Usata quando non è disponibile uno scan reale.
              </p>
              {cloudStats && (
                <div className="mt-2 font-mono text-sky-400">
                  {cloudStats.n} punti · spazio mm
                </div>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full border-sky-500/30 bg-sky-950/40 text-sky-300 hover:bg-sky-900/50 hover:text-sky-100"
              onClick={generateCloud}
              disabled={cloudBusy}
            >
              {cloudBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Rigenera nuvola
            </Button>
          </div>
        </PipelineSection>

        {/* ── 2. PARAMETRI ── */}
        <PipelineSection
          id="parametri"
          title="Parametri ricostruzione"
          subtitle="Marching cubes + metaball"
          badge="2"
          badgeColor="bg-violet-600"
          active={!baseBusy && !!baseGeometry}
          open={openSections.has("parametri")}
          onToggle={() => toggleSection("parametri")}
        >
          <div className="space-y-4">
            <SliderRow
              label="Risoluzione griglia"
              value={reconParams.resolution}
              min={20}
              max={64}
              step={2}
              onChange={(v) =>
                setReconParams((p) => ({ ...p, resolution: Math.round(v) }))
              }
            />
            <SliderRow
              label="Strength metaball"
              value={reconParams.strength}
              min={0.3}
              max={2.0}
              step={0.05}
              onChange={(v) => setReconParams((p) => ({ ...p, strength: v }))}
            />
            <SliderRow
              label="Subtract"
              value={reconParams.subtract}
              min={4}
              max={40}
              step={1}
              onChange={(v) =>
                setReconParams((p) => ({ ...p, subtract: Math.round(v) }))
              }
            />
            <SliderRow
              label="Isolevel"
              value={reconParams.isolation}
              min={20}
              max={80}
              step={1}
              onChange={(v) =>
                setReconParams((p) => ({ ...p, isolation: Math.round(v) }))
              }
            />
            <SliderRow
              label="Field blur passes"
              value={reconParams.fieldBlurPasses}
              min={0}
              max={6}
              step={1}
              onChange={(v) =>
                setReconParams((p) => ({
                  ...p,
                  fieldBlurPasses: Math.round(v),
                }))
              }
            />
          </div>
        </PipelineSection>

        {/* ── 3. MODELLO BASE ── */}
        <PipelineSection
          id="modello"
          title="Modello base"
          subtitle={
            baseBusy
              ? "Calcolo in corso…"
              : baseStats
              ? `${baseStats.vertices} vtx · ${Math.round(baseStats.triangles)} tri`
              : "In attesa"
          }
          badge="3"
          badgeColor="bg-emerald-600"
          active={!baseBusy && !!baseGeometry}
          open={openSections.has("modello")}
          onToggle={() => toggleSection("modello")}
        >
          {baseBusy ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
              Generazione isosuperficie…
            </div>
          ) : baseGeometry ? (
            <div className="space-y-3">
              <div className="h-[220px] overflow-hidden rounded-xl border border-zinc-800 bg-black/30">
                <Canvas
                  dpr={[1, 1.5]}
                  frameloop="always"
                  camera={{ position: [0.3, 0.2, 0.9], fov: 36 }}
                  gl={{ antialias: true, alpha: true }}
                >
                  <ambientLight intensity={0.6} />
                  <directionalLight intensity={1.1} position={[2, 3, 2]} />
                  <FootMeshViewerMemo geometry={baseGeometry} />
                  <OrbitControls enablePan={false} minDistance={0.4} maxDistance={3} />
                </Canvas>
              </div>
              {baseStats && (
                <div className="font-mono text-[10px] text-zinc-500">
                  {baseStats.vertices} vertici · {Math.round(baseStats.triangles)} triangoli · pre-deform
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-zinc-500">In attesa dei parametri.</div>
          )}
        </PipelineSection>

        {/* ── 4. DEFORMAZIONE ── */}
        <PipelineSection
          id="deformazione"
          title="Deformazione"
          subtitle="Morfologia parametrica del modello base"
          badge="4"
          badgeColor="bg-orange-600"
          active={
            deformParams.archFlatten !== 0 ||
            deformParams.forefootSpread !== 0 ||
            deformParams.elongation !== 0 ||
            deformParams.dorsalCamber !== 0
          }
          open={openSections.has("deformazione")}
          onToggle={() => toggleSection("deformazione")}
        >
          <div className="space-y-4">
            <SliderRow
              label="Piede piatto (arch flatten)"
              value={deformParams.archFlatten}
              min={0}
              max={1}
              step={0.02}
              onChange={(v) =>
                setDeformParams((p) => ({ ...p, archFlatten: v }))
              }
            />
            <SliderRow
              label="Allargamento avampiede"
              value={deformParams.forefootSpread}
              min={0}
              max={1}
              step={0.02}
              onChange={(v) =>
                setDeformParams((p) => ({ ...p, forefootSpread: v }))
              }
            />
            <SliderRow
              label="Allungamento longitudinale"
              value={deformParams.elongation}
              min={0}
              max={1}
              step={0.02}
              onChange={(v) =>
                setDeformParams((p) => ({ ...p, elongation: v }))
              }
            />
            <SliderRow
              label="Curvatura dorsale"
              value={deformParams.dorsalCamber}
              min={0}
              max={1}
              step={0.02}
              onChange={(v) =>
                setDeformParams((p) => ({ ...p, dorsalCamber: v }))
              }
            />

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-orange-400">
                Nota
              </span>
              <p className="mt-1 leading-relaxed">
                La deformazione è applicata ai vertici del modello base prima dello smoothing.
                Valori a 0 = geometria inalterata.
              </p>
            </div>
          </div>
        </PipelineSection>

        {/* ── 5. SMOOTHING ── */}
        <PipelineSection
          id="smoothing"
          title="Smoothing"
          subtitle="Laplaciano mesh post-deformazione"
          badge="5"
          badgeColor="bg-pink-600"
          active={smoothParams.smoothIterations > 0}
          open={openSections.has("smoothing")}
          onToggle={() => toggleSection("smoothing")}
        >
          <div className="space-y-4">
            <SliderRow
              label="Iterazioni Laplaciano"
              value={smoothParams.smoothIterations}
              min={0}
              max={16}
              step={1}
              onChange={(v) =>
                setSmoothParams((p) => ({
                  ...p,
                  smoothIterations: Math.round(v),
                }))
              }
            />
            <SliderRow
              label="Lambda (intensità)"
              value={smoothParams.lambda}
              min={0.01}
              max={0.95}
              step={0.01}
              onChange={(v) =>
                setSmoothParams((p) => ({ ...p, lambda: v }))
              }
            />

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-400">
              <p className="leading-relaxed">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-pink-400">
                  Smoothing Laplaciano
                </span>{" "}
                — ogni vertice si muove verso il baricentro dei vicini.
                Lambda alta + molte iterazioni = superficie molto morbida ma volume ridotto.
              </p>
            </div>
          </div>
        </PipelineSection>

        {/* ── 6. RENDER ── */}
        <PipelineSection
          id="render"
          title="Render"
          subtitle={
            finalBusy
              ? "Calcolo in corso…"
              : finalStats
              ? `${finalStats.vertices} vtx · ${Math.round(finalStats.triangles)} tri`
              : "In attesa"
          }
          badge="6"
          badgeColor="bg-blue-600"
          active={!finalBusy && !!finalGeometry}
          open={openSections.has("render")}
          onToggle={() => toggleSection("render")}
        >
          {finalBusy ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              Applicazione deformazione + smoothing…
            </div>
          ) : finalGeometry ? (
            <div className="space-y-3">
              <div className="h-[320px] overflow-hidden rounded-xl border border-white/10 bg-black/40">
                <Canvas
                  dpr={[1, 1.75]}
                  frameloop="always"
                  camera={{ position: [0.3, 0.22, 1.0], fov: 34 }}
                  gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                  shadows
                >
                  <ambientLight intensity={0.45} />
                  <directionalLight intensity={1.2} position={[2.4, 3.5, 2.8]} castShadow />
                  <directionalLight intensity={0.4} position={[-2, -1, -2]} />
                  <FootMeshViewerMemo geometry={finalGeometry} />
                  <OrbitControls
                    enablePan={false}
                    minDistance={0.4}
                    maxDistance={4}
                    minPolarAngle={0.3}
                    maxPolarAngle={Math.PI / 2 - 0.04}
                    enableDamping
                    dampingFactor={0.08}
                  />
                </Canvas>
              </div>

              {finalStats && (
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
                    {finalStats.vertices} vertici
                  </span>
                  <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
                    {Math.round(finalStats.triangles)} triangoli
                  </span>
                  <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
                    smooth ×{smoothParams.smoothIterations}
                  </span>
                  {Object.entries(deformParams).some(([, v]) => v !== 0) && (
                    <span className="rounded-lg border border-orange-800/50 bg-orange-950/40 px-2.5 py-1 font-mono text-[10px] text-orange-400">
                      deform attiva
                    </span>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-400">
                <p className="leading-relaxed">
                  Modello finale: pronto per il fitting calzatura.
                  Trascina per ruotare, pizzica per lo zoom.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500">
              Completa i passi precedenti per visualizzare il modello finale.
            </div>
          )}
        </PipelineSection>

        {/* Global busy indicator */}
        {anyBusy && (
          <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Aggiornamento pipeline…
          </div>
        )}
      </div>
    </div>
  );
}
