"use client";

import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { cn } from "../lib/utils";
import type { ShoeCatalogItem } from "../data/shoeCatalog";

const TPU_SWATCHES = [
  { id: "nero", label: "Nero", rgb: [0.06, 0.06, 0.08] as const },
  { id: "blu", label: "Blu", rgb: [0.1, 0.32, 0.95] as const },
  { id: "grigio", label: "Grigio", rgb: [0.4, 0.43, 0.48] as const },
] as const;

function cloneSceneWithMaterials(scene: THREE.Object3D) {
  const root = scene.clone(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else {
      mesh.material = mesh.material.clone();
    }
  });
  return root;
}

function applyTpuColor(root: THREE.Object3D, rgb: readonly [number, number, number]) {
  const c = new THREE.Color(rgb[0], rgb[1], rgb[2]);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
        m.color.copy(c);
        m.needsUpdate = true;
      }
    }
  });
}

function TryOnShoe({
  glbSrc,
  tpuRgb,
}: {
  glbSrc: string;
  tpuRgb: readonly [number, number, number];
}) {
  const { scene } = useGLTF(glbSrc) as unknown as { scene: THREE.Object3D };
  const clone = useMemo(() => cloneSceneWithMaterials(scene), [glbSrc]);

  useLayoutEffect(() => {
    applyTpuColor(clone, tpuRgb);
  }, [clone, tpuRgb]);

  return <primitive object={clone} />;
}

function TryOnScene({
  glbSrc,
  tpuRgb,
}: {
  glbSrc: string;
  tpuRgb: readonly [number, number, number];
}) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2.5, 4, 2]} intensity={0.85} color="#ffffff" />
      <directionalLight position={[-2.2, 2, -1.2]} intensity={0.35} color="#38bdf8" />

      <Suspense
        fallback={
          <Html center>
            <div className="rounded-xl border border-sky-500/40 bg-zinc-950/80 px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-sky-300">
              Caricamento scarpa…
            </div>
          </Html>
        }
      >
        <Environment preset="studio" environmentIntensity={1} />
        <Bounds fit clip observe margin={1.15}>
          <Center>
            <TryOnShoe glbSrc={glbSrc} tpuRgb={tpuRgb} />
          </Center>
        </Bounds>
      </Suspense>

      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.75}
        panSpeed={0.65}
        zoomSpeed={0.85}
        minDistance={0.25}
        maxDistance={4}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI - 0.12}
        touches={{
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
      />
    </>
  );
}

export type VirtualTryOnViewerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shoe: ShoeCatalogItem | null;
  /** Chiude il viewer e avvia flusso scansione piede (es. tutorial + scanner). */
  onScanFoot: () => void;
};

type CameraStatus = "loading" | "ok" | "unavailable";

export default function VirtualTryOnViewer({
  open,
  onOpenChange,
  shoe,
  onScanFoot,
}: VirtualTryOnViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("loading");
  const [tpuId, setTpuId] = useState<(typeof TPU_SWATCHES)[number]["id"]>("nero");
  const [mountCanvas, setMountCanvas] = useState(false);

  const activeRgb = TPU_SWATCHES.find((s) => s.id === tpuId)?.rgb ?? TPU_SWATCHES[0].rgb;

  useEffect(() => {
    if (!open) {
      setCameraStatus("loading");
      setMountCanvas(false);
      return;
    }
    setTpuId("nero");
    const id = requestAnimationFrame(() => setMountCanvas(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open || !shoe) return;
    let cancelled = false;
    setCameraStatus("loading");

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("no api");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        if (!cancelled) setCameraStatus("ok");
      } catch {
        if (!cancelled) setCameraStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      const v = videoRef.current;
      const stream = v?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      if (v) v.srcObject = null;
    };
  }, [open, shoe]);

  const handleScan = useCallback(() => {
    onOpenChange(false);
    onScanFoot();
  }, [onOpenChange, onScanFoot]);

  if (!open) return null;
  if (!shoe) return null;

  const useWebcamBg = cameraStatus === "ok";
  const showHdFallback = cameraStatus === "unavailable";

  const canvasBlock = mountCanvas ? (
    <Canvas
      key={shoe.glbSrc}
      dpr={[1, typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 1.75) : 1]}
      frameloop="always"
      camera={{ position: [0.42, 0.35, 1.05], fov: 40, near: 0.05, far: 80 }}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "default",
        premultipliedAlpha: false,
        stencil: false,
        depth: true,
      }}
      className="h-full w-full touch-none"
      style={{ width: "100%", height: "100%", touchAction: "none" }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0);
        scene.background = null;
      }}
    >
      <TryOnScene glbSrc={shoe.glbSrc} tpuRgb={activeRgb} />
    </Canvas>
  ) : (
    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-sky-500/30 bg-zinc-950/60">
      <p className="font-mono text-[10px] uppercase tracking-wider text-sky-400/80">Preparazione viewer…</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className={cn(
          "fixed inset-0 left-0 top-0 z-[96] flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none",
          "data-[state=open]:slide-in-from-bottom-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:zoom-in-100"
        )}
      >
        <div className="relative min-h-0 flex-1 bg-black">
          <video
            ref={videoRef}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
              useWebcamBg ? "opacity-100" : "pointer-events-none opacity-0"
            )}
            playsInline
            muted
            autoPlay
          />

          {useWebcamBg ? (
            <div className="pointer-events-none absolute inset-0 bg-black/45" aria-hidden />
          ) : (
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-950 via-black to-black"
              aria-hidden
            />
          )}

          {showHdFallback ? (
            <div className="absolute left-0 right-0 top-0 z-[12] flex justify-center px-3 pt-14">
              <div
                className="max-w-lg rounded-xl border border-sky-500/45 bg-zinc-950/75 px-4 py-3 text-center shadow-[0_0_28px_rgba(56,189,248,0.12)] backdrop-blur-md"
                role="status"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-sky-400">Dispositivo</p>
                <p className="mt-1.5 text-sm font-medium leading-snug text-zinc-100">
                  AR non supportata — <span className="text-sky-300">Visualizzazione 3D HD</span> attivata
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                  L&apos;app si adatta al tuo telefono. Muovi e ruota la scarpa con due dita per allinearla al piede.
                </p>
              </div>
            </div>
          ) : null}

          <div
            className={cn(
              "absolute inset-0 z-[11] flex flex-col items-center justify-center px-3 pb-36 pt-14",
              showHdFallback && "pt-[7.5rem]"
            )}
          >
            <p className="pointer-events-none mb-2 max-w-md text-center font-mono text-[10px] uppercase tracking-[0.22em] text-sky-400/90">
              Prova virtuale · {shoe.name}
            </p>
            <p className="pointer-events-none mb-3 max-w-sm text-center text-[11px] text-zinc-500">
              {useWebcamBg
                ? "Trascina con un dito per ruotare, due dita per zoom e spostare — allinea la scarpa al tuo piede."
                : "Modalità studio HD: ruota, ingrandisci e sposta il modello 3D."}
            </p>

            <div
              className={cn(
                "h-[min(52dvh,440px)] w-full max-w-lg overflow-hidden",
                showHdFallback &&
                  "rounded-2xl border-2 border-sky-500/40 bg-zinc-950 shadow-[0_0_40px_rgba(56,189,248,0.08)] ring-1 ring-sky-500/20"
              )}
            >
              {canvasBlock}
            </div>
          </div>

          <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex justify-end p-3">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="pointer-events-auto h-11 w-11 rounded-full border border-sky-500/35 bg-black/50 text-white shadow-lg backdrop-blur-md hover:bg-black/70"
              onClick={() => onOpenChange(false)}
              aria-label="Chiudi prova virtuale"
            >
              <X className="h-6 w-6" strokeWidth={2} />
            </Button>
          </div>

          <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-sky-500/25 bg-black/55 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-md">
            <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400/85">
              Colore filamento TPU
            </p>
            <div className="mb-5 flex items-center justify-center gap-5">
              {TPU_SWATCHES.map((s) => {
                const active = s.id === tpuId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setTpuId(s.id)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                      active && "scale-105"
                    )}
                    aria-label={s.label}
                    aria-pressed={active}
                  >
                    <span
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-lg transition-transform",
                        active
                          ? "border-sky-400 shadow-sky-500/40 ring-2 ring-sky-500/50"
                          : "border-white/15 hover:border-sky-500/50"
                      )}
                      style={{
                        background:
                          s.id === "nero"
                            ? "linear-gradient(145deg,#1a1a1c,#0a0a0c)"
                            : s.id === "blu"
                              ? "linear-gradient(145deg,#2563eb,#1d4ed8)"
                              : "linear-gradient(145deg,#71717a,#52525b)",
                      }}
                    />
                    <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">{s.label}</span>
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              className="h-auto w-full rounded-xl border border-sky-400/30 bg-sky-500 py-5 font-mono text-sm font-bold uppercase tracking-[0.12em] text-white shadow-lg shadow-sky-500/35 hover:bg-sky-400 active:bg-sky-600"
              onClick={handleScan}
            >
              VOGLIO QUESTA! SCANSIONA IL PIEDE
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
