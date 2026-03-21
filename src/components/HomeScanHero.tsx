"use client";

import React from "react";
import { motion } from "framer-motion";
import { Button } from "./ui/button";
import { HoneycombLatticeVisual } from "./HoneycombLatticeVisual";
import { ChevronDown, ScanLine } from "lucide-react";
import BarefootBenefitsSection from "./BarefootBenefitsSection";

/** Immagine piedi 3D + mesh — su pannello chiaro per contrasto (no mix-blend: altrimenti troppo scura) */
const FEET_MESH_IMG = "/images/feet-mesh-modeling.png";

export type HomeScanHeroProps = {
  onOpenScanner: () => void;
};

/**
 * Home hero: immagine reference scan-to-print + effetto modellazione (scan + pulse).
 */
export default function HomeScanHero({ onOpenScanner }: HomeScanHeroProps) {
  return (
    <section
      className="relative -mx-5 mb-8 overflow-hidden border-y border-zinc-800/90 bg-zinc-950 sm:mx-0 sm:rounded-2xl sm:border"
      aria-label="Home: scan-to-print con piedi e mesh"
    >
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[0.18]">
        <HoneycombLatticeVisual />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_35%,rgba(59,130,246,0.2),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-zinc-950 via-zinc-950/40 to-zinc-950" />

      <div className="relative z-10 flex min-h-[min(62dvh,560px)] flex-col items-center justify-center px-4 pb-6 pt-8 sm:min-h-[min(58dvh,520px)] sm:px-8">
        <motion.div
          className="relative w-full max-w-4xl"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {/*
            Un solo effetto “scanner”: fascio blu morbido (niente seconda linea esterna + niente griglia animata).
            Pannello: grigio‑chiaro + alone blu, meno “foglio bianco” rispetto a zinc‑100 pieno.
          */}
          <div className="relative isolate mx-auto overflow-hidden rounded-2xl border border-zinc-600/50 bg-gradient-to-br from-slate-200/95 via-zinc-100 to-slate-300/90 p-[2px] shadow-[0_24px_60px_-12px_rgba(15,23,42,0.45)] ring-1 ring-blue-500/15">
            <div className="relative overflow-hidden rounded-[14px] bg-[linear-gradient(165deg,rgba(255,255,255,0.92)_0%,rgba(228,232,240,0.98)_45%,rgba(203,213,225,0.95)_100%)]">
              <div className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-32px_48px_rgba(15,23,42,0.06)]" />

              <div className="relative flex items-center justify-center">
                {/* Unico fascio di scansione (largo, sfocato) */}
                <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[14px]">
                  <div className="hero-feet-scan-sweep absolute left-[-5%] right-[-5%] top-0 h-[52%] bg-gradient-to-b from-transparent via-sky-400/28 to-transparent blur-md" />
                </div>

                {/* Griglia CAD statica (nessuna animazione di opacità) */}
                <div
                  className="pointer-events-none absolute inset-0 z-10 opacity-[0.2]"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(59,130,246,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.3) 1px, transparent 1px)",
                    backgroundSize: "14px 14px",
                  }}
                />

                <img
                  src={FEET_MESH_IMG}
                  alt="Modello 3D di piedi con mesh di scansione digitale"
                  width={1200}
                  height={800}
                  className="relative z-[1] h-auto w-full max-h-[min(52vh,420px)] object-contain object-center brightness-[1.05] contrast-[1.1] saturate-[1.03]"
                  decoding="async"
                />

                <div className="pointer-events-none absolute inset-0 z-[2] rounded-[14px] shadow-[inset_0_0_70px_rgba(59,130,246,0.1)]" />
              </div>
            </div>
          </div>
        </motion.div>

        <p className="relative z-10 mt-4 max-w-lg px-2 text-center text-xs font-medium leading-relaxed text-zinc-100 [text-shadow:0_1px_12px_rgba(0,0,0,0.85)]">
          Mesh e piedi su pannello chiaro; un solo fascio blu animato simula la scansione.
        </p>
      </div>

      <div className="relative z-20 border-t border-zinc-800/80 bg-zinc-950/95 px-5 py-8 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/35 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
              <ScanLine className="h-3.5 w-3.5" strokeWidth={2} />
              Scan-to-print
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl sm:leading-tight">
              Dalla scansione alla stampa 3D su misura
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
              Due piedi, geometria che si compone e reticolo pronto per il TPU — esperienza home in stile{" "}
              <span className="text-zinc-300">footwear digitale</span>.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <Button
              type="button"
              size="lg"
              className="w-full bg-blue-600 px-8 text-base text-white shadow-lg shadow-blue-600/35 hover:bg-blue-700 sm:w-auto"
              onClick={onOpenScanner}
            >
              Scansiona ora
            </Button>
            <span className="text-center text-[11px] text-zinc-600 sm:text-right">TPU · stampa additiva · Alpino</span>
            <a
              href="#benefici-piede"
              className="inline-flex items-center justify-center gap-1 text-center text-sm font-medium text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline sm:text-right"
            >
              Scopri i benefici
              <ChevronDown className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>
      </div>

      <BarefootBenefitsSection className="rounded-b-2xl border-t border-zinc-800/90" />
    </section>
  );
}
