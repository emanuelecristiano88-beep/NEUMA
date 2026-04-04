/**
 * ScanReviewOverlay — post-scan review (fase Render / Revisione).
 *
 * Visualizzatore 3D con avatar piede perfetto (feet.obj), morph verso misure
 * biometriche + pianta dal point cloud, look ologramma premium.
 */

import React, { useMemo, useState } from "react";
import type { ObservationData } from "@/lib/aruco/poseEstimation";
import type { FootMeasurements } from "@/lib/scanner/finalizeScanData";
import type { SectorProgress } from "@/hooks/useFootEraser";
import { classifyToeShapeFromObservations } from "@/lib/biometry/classifyToeShapeFromObservations";
import type { ToeShapeKind } from "@/lib/biometry/classifyToeShapeFromObservations";
import { ScanReviewModelViewer } from "./ScanReviewModelViewer";
import { ToeShapeReviewPanel } from "./ToeShapeReviewPanel";

// ─── Sector coverage bar ──────────────────────────────────────────────────────

function SectorBar({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number;
  color: string;
}) {
  const pctInt = Math.round(pct * 100);
  const isOk = pct >= 0.8;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          fontFamily: "ui-rounded, -apple-system, sans-serif",
          fontSize: 11,
          fontWeight: 500,
          color: "rgba(255,255,255,0.55)",
          width: 94,
          flexShrink: 0,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>

      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          background: "rgba(255,255,255,0.10)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pctInt}%`,
            borderRadius: 3,
            background: isOk ? color : `rgba(251,191,36,0.85)`,
            transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </div>

      <span
        style={{
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          fontSize: 11,
          fontWeight: 600,
          color: isOk ? "rgba(255,255,255,0.55)" : "rgba(251,191,36,0.90)",
          width: 36,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {pctInt}%
      </span>

      <span style={{ fontSize: 12, lineHeight: 1, opacity: isOk ? 0 : 1, transition: "opacity 300ms" }}>
        ⚠
      </span>
    </div>
  );
}

const SECTOR_LABELS = {
  top: "Vista Superiore",
  left: "Lato Laterale",
  right: "Arco Plantare",
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  observations: ObservationData[];
  /** Da finalizeScan; se assente il viewer stima da `observations`. */
  measurements: FootMeasurements | null;
  sectorProgress: SectorProgress;
  onRetry: () => void;
  onConfirm: () => void;
  isSending: boolean;
  visible: boolean;
  /** Dopo conferma forma dita (opzionale, es. analytics / payload). */
  onToeShapeAcknowledged?: (kind: ToeShapeKind) => void;
}

export function ScanReviewOverlay({
  observations,
  measurements,
  sectorProgress,
  onRetry,
  onConfirm,
  isSending,
  visible,
  onToeShapeAcknowledged,
}: Props) {
  const [hasInteracted, setHasInteracted] = useState(false);
  const [toeShapeAcknowledged, setToeShapeAcknowledged] = useState(false);

  const toeClassification = useMemo(() => classifyToeShapeFromObservations(observations), [observations]);

  const handleToeAck = (kind: ToeShapeKind) => {
    setToeShapeAcknowledged(true);
    onToeShapeAcknowledged?.(kind);
  };

  if (!visible) return null;

  const FONT = "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 120,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "sap-fade-in 380ms cubic-bezier(0.22,1,0.36,1) both",
      }}
    >
      <ScanReviewModelViewer
        observations={observations}
        measurements={measurements}
        onInteractionStart={() => setHasInteracted(true)}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "max(18px, env(safe-area-inset-top)) 20px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pointerEvents: "none",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: "clamp(18px, 5vw, 22px)",
              color: "#ffffff",
              letterSpacing: "-0.3px",
              textShadow: "0 2px 24px rgba(0,0,0,0.45)",
            }}
          >
            Revisione Scansione
          </div>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              marginTop: 2,
              fontWeight: 400,
              textShadow: "0 1px 16px rgba(0,0,0,0.4)",
            }}
          >
            {observations.length} punti catturati
          </div>
        </div>

        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "rgba(52, 211, 153, 0.16)",
            border: "1.5px solid rgba(52, 211, 153, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "sap-pulse 2.2s ease-in-out infinite",
          }}
        >
          <svg width={20} height={20} viewBox="0 0 20 20" fill="none">
            <polyline
              points="4,10 8,14 16,6"
              stroke="rgba(52,211,153,1)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={24}
              strokeDashoffset={0}
              style={{ animation: "sap-check-draw 400ms 200ms cubic-bezier(0.22,1,0.36,1) both" }}
            />
          </svg>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) translateY(60px)",
          zIndex: 1,
          pointerEvents: "none",
          opacity: hasInteracted ? 0 : 0.65,
          transition: "opacity 500ms ease",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
          <circle cx={14} cy={14} r={11} stroke="white" strokeWidth={1.5} opacity={0.6} />
          <path d="M9 12 L14 7 L19 12" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 16 L14 21 L19 16" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          style={{
            fontFamily: FONT,
            fontSize: 12,
            color: "#ffffff",
            letterSpacing: "0.04em",
            fontWeight: 500,
            textShadow: "0 2px 20px rgba(0,0,0,0.5)",
          }}
        >
          Ruota · pizzica per zoom · trascina due dita per spostare
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          padding: "18px 20px max(20px, env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, rgba(4,10,28,0.97) 70%, rgba(4,10,28,0))",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <ToeShapeReviewPanel
          classification={toeClassification}
          disabled={isSending}
          onAcknowledge={handleToeAck}
        />

        <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.35)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            Copertura per zona
          </div>

          <SectorBar
            label={SECTOR_LABELS.top}
            pct={sectorProgress.top.pct}
            color="rgba(56, 218, 255, 0.85)"
          />
          <SectorBar
            label={SECTOR_LABELS.left}
            pct={sectorProgress.left.pct}
            color="rgba(138, 180, 248, 0.85)"
          />
          <SectorBar
            label={SECTOR_LABELS.right}
            pct={sectorProgress.right.pct}
            color="rgba(199, 146, 234, 0.85)"
          />
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onRetry}
            disabled={isSending}
            style={{
              flex: "0 0 auto",
              height: 50,
              paddingInline: 20,
              borderRadius: 14,
              border: "1.5px solid rgba(239, 68, 68, 0.50)",
              background: "rgba(239, 68, 68, 0.10)",
              color: "rgba(239,68,68,0.92)",
              fontFamily: FONT,
              fontWeight: 600,
              fontSize: 15,
              letterSpacing: "-0.2px",
              cursor: isSending ? "not-allowed" : "pointer",
              opacity: isSending ? 0.45 : 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "opacity 200ms, transform 120ms",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 8A5.5 5.5 0 1 0 8 2.5"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
              />
              <polyline
                points="2.5,4.5 2.5,8 6,8"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Rifai
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isSending || !toeShapeAcknowledged}
            style={{
              flex: 1,
              height: 50,
              borderRadius: 14,
              border: "none",
              background: isSending
                ? "rgba(52, 211, 153, 0.40)"
                : "linear-gradient(135deg, rgba(52,211,153,0.95) 0%, rgba(16,185,129,0.95) 100%)",
              color: "#ffffff",
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: "-0.3px",
              cursor: isSending || !toeShapeAcknowledged ? "not-allowed" : "pointer",
              opacity: isSending ? 0.75 : !toeShapeAcknowledged ? 0.42 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: isSending ? "none" : "0 4px 20px rgba(52,211,153,0.35)",
              transition: "opacity 200ms, box-shadow 200ms, transform 120ms",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {isSending ? (
              <>
                <svg
                  width={18}
                  height={18}
                  viewBox="0 0 18 18"
                  fill="none"
                  style={{ animation: "spin 0.8s linear infinite" }}
                >
                  <circle cx={9} cy={9} r={7} stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
                  <path d="M9 2 A 7 7 0 0 1 16 9" stroke="white" strokeWidth={2} strokeLinecap="round" />
                </svg>
                Invio in corso…
              </>
            ) : (
              <>
                <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
                  <polyline
                    points="3,9 7,13 15,5"
                    stroke="white"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Conferma Misure
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
