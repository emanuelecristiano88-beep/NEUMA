"use client";

import React from "react";

/**
 * Schema A4 (210×297 mm): griglia leggera, incrocio al centro, sagoma piede.
 * Messaggio: allineare il tallone (o il punto indicato) al centro del foglio.
 */
const W = 210;
const H = 297;
const CX = W / 2;
const CY = H / 2;

/** Sagoma piede vista dall’alto (mm), centrata sul foglio come in ScannerTarget */
function FootOutline() {
  return (
    <g
      fill="none"
      stroke="#94a3b8"
      strokeWidth={0.45}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="2 1.5"
      opacity={0.95}
    >
      <path d="M 105 102 c -24 2 -40 22 -38 48 c 2 28 14 52 38 62 c 24 -10 36 -34 38 -62 c 2 -26 -14 -46 -38 -48 z" />
    </g>
  );
}

function GridTenMm() {
  const lines: React.ReactNode[] = [];
  for (let x = 0; x <= W; x += 10) {
    lines.push(
      <line
        key={`vx-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={H}
        stroke={x === 0 || x === W ? "#cbd5e1" : "#e2e8f0"}
        strokeWidth={0.15}
      />
    );
  }
  for (let y = 0; y <= H; y += 10) {
    lines.push(
      <line
        key={`hy-${y}`}
        x1={0}
        y1={y}
        x2={W}
        y2={y}
        stroke={y === 0 || y === H ? "#cbd5e1" : "#e2e8f0"}
        strokeWidth={0.15}
      />
    );
  }
  return <g aria-hidden>{lines}</g>;
}

export type FootPlacementGuideVisualProps = {
  className?: string;
  /** Mostra didascalie extra (ruoli cliente / operatore) sotto lo schema */
  showRoleCaptions?: boolean;
};

export default function FootPlacementGuideVisual({ className, showRoleCaptions = true }: FootPlacementGuideVisualProps) {
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-blue-200/80 bg-white shadow-sm">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mx-auto block h-auto w-full max-w-md"
          role="img"
          aria-label="Foglio A4: centro foglio con croce; posiziona il piede con il tallone vicino al centro"
        >
          <title>Foglio A4 NEUMA — posizione piede al centro</title>
          <rect width={W} height={H} fill="#ffffff" />
          <GridTenMm />

          {/* Croce centrale */}
          <line x1={CX} y1={0} x2={CX} y2={H} stroke="#2563eb" strokeWidth={0.35} strokeDasharray="4 3" opacity={0.55} />
          <line x1={0} y1={CY} x2={W} y2={CY} stroke="#2563eb" strokeWidth={0.35} strokeDasharray="4 3" opacity={0.55} />
          <circle cx={CX} cy={CY} r={3.2} fill="none" stroke="#2563eb" strokeWidth={0.6} />

          <FootOutline />

          {/* Etichetta centro */}
          <g transform={`translate(${CX}, ${CY - 18})`}>
            <rect x={-38} y={-8} width={76} height={16} rx={3} fill="#2563eb" opacity={0.92} />
            <text
              x={0}
              y={4}
              textAnchor="middle"
              fill="white"
              fontSize={4.2}
              fontFamily="system-ui, sans-serif"
              fontWeight={600}
            >
              CENTRO FOGLIO
            </text>
          </g>

          <text
            x={CX}
            y={CY + 22}
            textAnchor="middle"
            fill="#475569"
            fontSize={3.8}
            fontFamily="system-ui, sans-serif"
          >
            Tallone ≈ qui
          </text>

          <text x={CX} y={H - 8} textAnchor="middle" fill="#64748b" fontSize={3.2} fontFamily="system-ui, sans-serif">
            A4 · griglia a cm · marker agli angoli (foglio stampato NEUMA)
          </text>
        </svg>
      </div>

      {showRoleCaptions ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            <span className="font-semibold text-zinc-900">Cliente</span> — piede nudo, fermo sul foglio. Non spostare il
            piede fino a fine scansione.
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-zinc-700">
            <span className="font-semibold text-blue-800">Operatore</span> — tiene il telefono e inquadra foglio +
            piede; si muove lentamente attorno (orbita).
          </div>
        </div>
      ) : null}
    </div>
  );
}
