"use client";

import React, { useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export type PhaseId = 0 | 1 | 2 | 3;
type FootId = "LEFT" | "RIGHT";

const PHASE_COPY: Record<
  PhaseId,
  { title: string; client: string; operator: string; hint: string }
> = {
  0: {
    title: "Frontale / tallone",
    client:
      "Piede nudo fermo sul foglio NEUMA, tallone nell’area indicata. Non spostare il piede durante la fase.",
    operator:
      "Posizionati dietro o di lato al tallone. Inclina il telefono verso la pianta mantenendo tutto il foglio e i 4 marker inquadrati.",
    hint: "Inquadra il tallone e inclina verso la pianta.",
  },
  1: {
    title: "Lato interno",
    client: "Resta fermo: il piede non deve ruotare sul foglio.",
    operator:
      "Sposta lentamente il telefono lungo il lato interno (arco plantare), a distanza costante (~15–20 cm). Evita ombre nette sul piede.",
    hint: "Muovi il telefono lentamente verso l’interno del piede.",
  },
  2: {
    title: "Lato esterno",
    client: "Stessa posizione del piede, nessun movimento.",
    operator:
      "Ripeti il movimento lento sul lato esterno del piede, parallelo al foglio. Mantieni il frame stabile tra uno scatto e l’altro.",
    hint: "Muovi il telefono verso l’esterno, mantieni la distanza.",
  },
  3: {
    title: "Punta / vista superiore",
    client: "Le dita restano naturali, senza sollevarle dal foglio.",
    operator:
      "Porta il telefono sopra le dita e il collo del piede: vista quasi dall’alto. Copri punta e avampiede nello stesso piano focale.",
    hint: "Inquadra le dita e la parte dorsale dall’alto.",
  },
};

/** Illustrazioni SVG schematiche (sostituibili con immagini in public/scan-guides/) */
function PhaseIllustration({ phaseId }: { phaseId: PhaseId }) {
  if (phaseId === 0) {
    return (
      <svg viewBox="0 0 320 200" className="h-auto w-full max-h-[200px]" fill="none" aria-hidden>
        <rect x="20" y="10" width="280" height="180" rx="6" fill="#18181b" stroke="#2563eb" strokeWidth="2" opacity={0.9} />
        <rect x="100" y="50" width="120" height="90" rx="8" fill="#3f3f46" stroke="#a1a1aa" />
        <ellipse cx="160" cy="95" rx="28" ry="38" fill="#d4d4d8" />
        <g transform="translate(248 120) rotate(-25)">
          <rect x="-12" y="-28" width="24" height="56" rx="4" fill="#27272a" stroke="#2563eb" strokeWidth="1.5" />
          <rect x="-9" y="-20" width="18" height="32" rx="2" fill="#0ea5e9" opacity={0.3} />
        </g>
        <path d="M 200 85 L 235 70" stroke="#2563eb" strokeWidth="2" strokeDasharray="4 3" markerEnd="url(#arr)" />
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0, 6 3, 0 6" fill="#2563eb" />
          </marker>
        </defs>
        <text x="160" y="188" textAnchor="middle" fill="#a1a1aa" fontSize="10" fontFamily="system-ui">
          Vista schema: tallone + telefono inclinato verso la pianta
        </text>
      </svg>
    );
  }
  if (phaseId === 1) {
    return (
      <svg viewBox="0 0 320 200" className="h-auto w-full max-h-[200px]" fill="none" aria-hidden>
        <rect x="20" y="10" width="280" height="180" rx="6" fill="#18181b" stroke="#2563eb" strokeWidth="2" />
        <ellipse cx="160" cy="95" rx="32" ry="42" fill="#d4d4d8" stroke="#71717a" />
        <path d="M 130 95 Q 160 75 190 95" stroke="#71717a" fill="none" />
        <g transform="translate(95 95) rotate(15)">
          <rect x="-12" y="-28" width="24" height="56" rx="4" fill="#27272a" stroke="#2563eb" strokeWidth="1.5" />
        </g>
        <path d="M 200 85 L 250 95" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 4" opacity={0.8} />
        <text x="160" y="188" textAnchor="middle" fill="#a1a1aa" fontSize="10" fontFamily="system-ui">
          Telefono lungo il lato interno del piede
        </text>
      </svg>
    );
  }
  if (phaseId === 2) {
    return (
      <svg viewBox="0 0 320 200" className="h-auto w-full max-h-[200px]" fill="none" aria-hidden>
        <rect x="20" y="10" width="280" height="180" rx="6" fill="#18181b" stroke="#2563eb" strokeWidth="2" />
        <ellipse cx="160" cy="95" rx="32" ry="42" fill="#d4d4d8" stroke="#71717a" />
        <g transform="translate(225 95) rotate(-15)">
          <rect x="-12" y="-28" width="24" height="56" rx="4" fill="#27272a" stroke="#2563eb" strokeWidth="1.5" />
        </g>
        <path d="M 120 95 L 70 95" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 4" opacity={0.8} />
        <text x="160" y="188" textAnchor="middle" fill="#a1a1aa" fontSize="10" fontFamily="system-ui">
          Telefono lungo il lato esterno
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 200" className="h-auto w-full max-h-[200px]" fill="none" aria-hidden>
      <rect x="20" y="10" width="280" height="180" rx="6" fill="#18181b" stroke="#2563eb" strokeWidth="2" />
      <ellipse cx="160" cy="100" rx="30" ry="40" fill="#d4d4d8" stroke="#71717a" />
      <g transform="translate(160 45) rotate(0)">
        <rect x="-18" y="-22" width="36" height="44" rx="4" fill="#27272a" stroke="#2563eb" strokeWidth="1.5" />
          <rect x="-14" y="-16" width="28" height="34" rx="2" fill="#0ea5e9" opacity={0.25} />
      </g>
      <text x="160" y="188" textAnchor="middle" fill="#a1a1aa" fontSize="10" fontFamily="system-ui">
        Vista dall’alto: punta e collo del piede
      </text>
    </svg>
  );
}

export type ScannerPhaseGuidePanelProps = {
  phaseId: PhaseId;
  foot: FootId;
  onContinue: () => void;
};

/**
 * Schermata prima di ogni fase: posizione cliente + operatore.
 * Opzionale: `public/scan-guides/phase-0.png` … `phase-3.png` sostituiscono lo SVG se presenti.
 */
export default function ScannerPhaseGuidePanel({ phaseId, foot, onContinue }: ScannerPhaseGuidePanelProps) {
  const [rasterFailed, setRasterFailed] = useState(false);
  const imgSrc = `/scan-guides/phase-${phaseId}.png`;
  const copy = PHASE_COPY[phaseId];

  return (
    <div className="fixed inset-0 z-[96] flex flex-col bg-zinc-950/97">
      <div className="shrink-0 border-b border-white/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#2563eb]">
          Fase {phaseId + 1}/4 · {foot === "LEFT" ? "Piede sinistro" : "Piede destro"}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">{copy.title}</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-white/10 bg-zinc-900/80">
          {!rasterFailed ? (
            <img
              src={imgSrc}
              alt=""
              className="h-auto w-full object-contain"
              onError={() => setRasterFailed(true)}
            />
          ) : (
            <div className="p-3">
              <PhaseIllustration phaseId={phaseId} />
            </div>
          )}
        </div>

        <div className="mx-auto mt-4 max-w-md space-y-3 text-left text-sm leading-relaxed text-zinc-300">
          <div>
            <span className="text-xs font-bold uppercase tracking-wide text-zinc-500">Cliente</span>
            <p className="mt-1.5">{copy.client}</p>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wide text-[#2563eb]">Operatore</span>
            <p className="mt-1.5">{copy.operator}</p>
          </div>
          <p className={cn("rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-400")}>
            Obiettivo acquisizione: {copy.hint}
          </p>
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-zinc-950 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="mb-3 text-center text-[11px] text-zinc-500">
          Il rettangolo blu in camera seguirà l’inclinazione del telefono. Allinea il foglio A4 prima di avviare.
        </p>
        <Button
          type="button"
          className="h-14 w-full rounded-xl bg-[#2563eb] text-base font-bold uppercase tracking-wide text-white shadow-lg hover:brightness-110"
          onClick={onContinue}
        >
          Ho capito — inizia la fase
        </Button>
      </div>
    </div>
  );
}
