"use client";

import React, { useMemo, useState } from "react";
import type { ToeShapeClassification, ToeShapeKind } from "@/lib/biometry/classifyToeShapeFromObservations";
import { TOE_SHAPE_LABEL_IT } from "@/lib/biometry/classifyToeShapeFromObservations";

const FONT = "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif";

function ToeShapeIcon({ kind }: { kind: ToeShapeKind }) {
  const stroke = "rgba(255,255,255,0.88)";
  const dim = "rgba(255,255,255,0.22)";
  const w = 56;
  const h = 36;
  const baseY = 28;
  const bw = 5;
  const gap = 6;

  if (kind === "indeterminato") {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <line x1={10} y1={baseY} x2={46} y2={8} stroke={dim} strokeWidth={1.5} strokeLinecap="round" />
        <text x={28} y={22} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily={FONT}>
          ?
        </text>
      </svg>
    );
  }

  const x0 = 10;
  const x1 = x0 + bw + gap;
  const x2 = x1 + bw + gap;

  let h0: number;
  let h1: number;
  let h2: number;
  if (kind === "egizio") {
    h0 = 18;
    h1 = 12;
    h2 = 7;
  } else if (kind === "greco") {
    h0 = 10;
    h1 = 20;
    h2 = 9;
  } else {
    h0 = 14;
    h1 = 14;
    h2 = 14;
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <rect x={x0} y={baseY - h0} width={bw} height={h0} rx={1.5} fill={stroke} opacity={0.95} />
      <rect x={x1} y={baseY - h1} width={bw} height={h1} rx={1.5} fill={stroke} opacity={0.95} />
      <rect x={x2} y={baseY - h2} width={bw} height={h2} rx={1.5} fill={stroke} opacity={0.95} />
      <line x1={6} y1={baseY + 1} x2={w - 6} y2={baseY + 1} stroke={dim} strokeWidth={1} />
    </svg>
  );
}

const PICKABLE: ToeShapeKind[] = ["egizio", "greco", "romano"];

export type ToeShapeReviewPanelProps = {
  classification: ToeShapeClassification;
  disabled?: boolean;
  /** Chiamato quando l’utente conferma (automatico o dopo correzione). */
  onAcknowledge: (finalKind: ToeShapeKind) => void;
};

export function ToeShapeReviewPanel({ classification, disabled, onAcknowledge }: ToeShapeReviewPanelProps) {
  const [showPicker, setShowPicker] = useState(classification.kind === "indeterminato");
  const [manual, setManual] = useState<ToeShapeKind | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const displayKind = manual ?? classification.kind;

  const titleUpper = useMemo(() => {
    if (displayKind === "indeterminato") return "—";
    return TOE_SHAPE_LABEL_IT[displayKind].toUpperCase();
  }, [displayKind]);

  const handleConfirmAuto = () => {
    if (disabled || acknowledged) return;
    const k = classification.kind === "indeterminato" ? null : classification.kind;
    if (!k) return;
    setAcknowledged(true);
    onAcknowledge(k);
  };

  const handlePick = (k: ToeShapeKind) => {
    if (disabled || acknowledged) return;
    setManual(k);
    setShowPicker(false);
    setAcknowledged(true);
    onAcknowledge(k);
  };

  const handleCorreggi = () => {
    if (disabled || acknowledged) return;
    setShowPicker(true);
  };

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(8, 18, 42, 0.72)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        padding: "14px 16px 16px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            flexShrink: 0,
            width: 64,
            height: 44,
            borderRadius: 12,
            background: "rgba(56,189,248,0.08)",
            border: "1px solid rgba(56,189,248,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ToeShapeIcon kind={displayKind === "indeterminato" ? "indeterminato" : displayKind} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.1em",
              color: "rgba(255,255,255,0.42)",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Forma Dita Rilevata
          </div>
          <div
            style={{
              fontFamily: FONT,
              fontSize: "clamp(17px, 4.2vw, 20px)",
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: "0.04em",
              textShadow: "0 2px 16px rgba(56,189,248,0.25)",
            }}
          >
            {titleUpper}
          </div>
          {classification.kind !== "indeterminato" && classification.confidence < 0.72 ? (
            <div style={{ fontFamily: FONT, fontSize: 11, color: "rgba(251,191,36,0.85)", marginTop: 4 }}>
              Stima approssimativa — verifica visiva consigliata.
            </div>
          ) : null}
        </div>
      </div>

      {!acknowledged ? (
        <>
          <p
            style={{
              fontFamily: FONT,
              fontSize: 13,
              color: "rgba(255,255,255,0.62)",
              marginTop: 12,
              marginBottom: 12,
              lineHeight: 1.45,
            }}
          >
            {classification.kind === "indeterminato"
              ? "Non abbiamo potuto classificare in modo affidabile. Scegli la forma più simile al tuo piede."
              : "Confermi la forma delle tue dita?"}
          </p>

          {classification.kind === "indeterminato" && !showPicker ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowPicker(true)}
              style={{
                width: "100%",
                height: 44,
                borderRadius: 12,
                border: "1px solid rgba(56,189,248,0.35)",
                background: "rgba(56,189,248,0.12)",
                color: "rgba(224,249,255,0.95)",
                fontFamily: FONT,
                fontWeight: 600,
                fontSize: 14,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Scegli la forma
            </button>
          ) : null}

          {classification.kind !== "indeterminato" && !showPicker ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={disabled}
                onClick={handleConfirmAuto}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, rgba(56,189,248,0.35) 0%, rgba(14,165,233,0.45) 100%)",
                  color: "#ffffff",
                  fontFamily: FONT,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                Sì, confermo
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={handleCorreggi}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.85)",
                  fontFamily: FONT,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                Correggi
              </button>
            </div>
          ) : null}

          {showPicker ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: showPicker ? 4 : 0 }}>
              <div style={{ fontFamily: FONT, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                Seleziona la forma più simile al tuo piede
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {PICKABLE.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={disabled}
                    onClick={() => handlePick(k)}
                    style={{
                      flex: "1 1 28%",
                      minWidth: 88,
                      height: 48,
                      borderRadius: 12,
                      border:
                        manual === k
                          ? "1.5px solid rgba(56,189,248,0.65)"
                          : "1px solid rgba(255,255,255,0.14)",
                      background: manual === k ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.05)",
                      color: "#ffffff",
                      fontFamily: FONT,
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <ToeShapeIcon kind={k} />
                    {TOE_SHAPE_LABEL_IT[k]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div
          style={{
            marginTop: 12,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 500,
            color: "rgba(52,211,153,0.9)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 8 L6.5 11.5 L13 4.5"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Forma registrata: {TOE_SHAPE_LABEL_IT[manual ?? classification.kind]}
        </div>
      )}
    </div>
  );
}
