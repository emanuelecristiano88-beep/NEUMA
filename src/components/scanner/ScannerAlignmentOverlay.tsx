import React from "react";
import { cn } from "../../lib/utils";
import type { ScanAlignmentResult } from "../../hooks/useScanAlignmentAnalysis";

const ELECTRIC = "#2563eb";

export type ScannerAlignmentOverlayProps = {
  alignment: ScanAlignmentResult;
  className?: string;
};

/**
 * Overlay scansione: bounding box 2D centrale (60% viewport), mirino circolare che si riempie con ArUco rilevati.
 */
export default function ScannerAlignmentOverlay({ alignment, className }: ScannerAlignmentOverlayProps) {
  const { guide, markerCentersNorm, arucoEngine } = alignment;

  const borderWarning = guide === "too_close";

  /** Marker ArUco: detector pronto e ≥4 centri → mirino pieno */
  const arucoLocked = arucoEngine === "ready" && markerCentersNorm != null && markerCentersNorm.length >= 4;

  return (
    <div className={cn("pointer-events-none flex min-h-0 flex-1 flex-col", className)}>
      {/* Area centrale: bbox 2D + mirino (nessun prisma 3D) */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 pt-2">
        <div
          className={cn(
            "relative box-border rounded-3xl border-2 transition-colors duration-300",
            "h-[60dvh] w-[60vw] max-h-[min(80dvh,720px)] max-w-[min(92vw,520px)]",
            "bg-[#2563eb]/50",
            borderWarning
              ? "border-amber-400/80 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]"
              : "border-[#2563eb]/50 shadow-[0_0_40px_rgba(37,99,235,0.18)]"
          )}
          aria-hidden
        >
          {/* Mirino / target al centro dello schermo (centrato nel bbox) */}
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
              {/* anelli esterni */}
              <circle
                cx="70"
                cy="70"
                r="58"
                fill="none"
                stroke={ELECTRIC}
                strokeWidth="2.5"
                strokeOpacity={0.85}
              />
              <circle cx="70" cy="70" r="46" fill="none" stroke={ELECTRIC} strokeWidth="1.5" strokeOpacity={0.45} />
              <circle cx="70" cy="70" r="34" fill="none" stroke={ELECTRIC} strokeWidth="1" strokeOpacity={0.35} />
              {/* centro pieno quando ArUco OK */}
              {arucoLocked ? (
                <circle cx="70" cy="70" r="22" fill={ELECTRIC} fillOpacity={0.5} />
              ) : (
                <circle cx="70" cy="70" r="6" fill="none" stroke={ELECTRIC} strokeWidth="2" strokeOpacity={0.9} />
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
