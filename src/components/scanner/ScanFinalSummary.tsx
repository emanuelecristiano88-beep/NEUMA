/**
 * ScanFinalSummary — Apple-style post-scan summary overlay.
 *
 * Displayed when the scan reaches 100 %.  Shows:
 *   • Estimated foot measurements (length, width, instep height, EU size, volume)
 *   • Scan quality metrics (observation count, texture frames, duration, score)
 *   • "Genera Modello 3D" CTA (primary action — triggers upload + render flow)
 *   • "Rifai Scansione" link (destructive retry)
 *
 * The sheet slides up from the bottom with a spring cubic-bezier animation,
 * over a blurred frozen video frame as background.
 */
"use client";

import React, { useEffect, useRef, useState } from "react";
import type { FinalizedScanData, FootMeasurements, ScanQuality } from "@/lib/scanner/finalizeScanData";

// ── Design tokens ─────────────────────────────────────────────────────────────

const T = {
  bg:         "rgba(10, 10, 12, 0.96)",
  card:       "rgba(255,255,255,0.055)",
  cardBorder: "rgba(255,255,255,0.09)",
  text:       "rgba(255,255,255,0.93)",
  muted:      "rgba(255,255,255,0.38)",
  label:      "rgba(255,255,255,0.58)",
  accent:     "#0A84FF",
  green:      "#30D158",
  amber:      "#FF9F0A",
  red:        "#FF453A",
  divider:    "rgba(255,255,255,0.07)",
  font:       "ui-rounded, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono:       "ui-monospace, 'SF Mono', 'Menlo', monospace",
} as const;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScanFinalSummaryProps {
  finalized:      FinalizedScanData;
  frozenFrameUrl: string | null;
  onConfirm:      () => void;
  onRetry:        () => void;
  isSending:      boolean;
  visible:        boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScanFinalSummary({
  finalized,
  frozenFrameUrl,
  onConfirm,
  onRetry,
  isSending,
  visible,
}: ScanFinalSummaryProps) {
  const [entered, setEntered] = useState(false);
  const prevVisible           = useRef(false);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      const t = setTimeout(() => setEntered(true), 40);
      prevVisible.current = true;
      return () => clearTimeout(t);
    }
    if (!visible) {
      setEntered(false);
      prevVisible.current = false;
    }
  }, [visible]);

  if (!visible) return null;

  const { measurements: m, quality: q } = finalized;
  const qColor =
    q.score >= 85 ? T.green
    : q.score >= 65 ? T.text
    : q.score >= 45 ? T.amber
    : T.red;

  return (
    <div
      aria-modal
      role="dialog"
      style={{
        position:       "absolute",
        inset:          0,
        zIndex:         200,
        display:        "flex",
        flexDirection:  "column",
        justifyContent: "flex-end",
        overflow:       "hidden",
      }}
    >
      {/* ── Blurred background ─────────────────────────────────────────── */}
      {frozenFrameUrl ? (
        <img
          src={frozenFrameUrl}
          alt=""
          aria-hidden
          style={{
            position:   "absolute",
            inset:      0,
            width:      "100%",
            height:     "100%",
            objectFit:  "cover",
            filter:     "blur(28px) brightness(0.28) saturate(1.2)",
            transform:  "scale(1.08)",
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            position:   "absolute",
            inset:      0,
            background: "linear-gradient(180deg, #0a0a0c 0%, #0f0f14 100%)",
          }}
        />
      )}

      {/* ── Sliding sheet ──────────────────────────────────────────────── */}
      <div
        style={{
          position:         "relative",
          zIndex:           1,
          background:       T.bg,
          borderRadius:     "22px 22px 0 0",
          borderTop:        `1px solid ${T.cardBorder}`,
          backdropFilter:   "blur(40px) saturate(180%)",
          WebkitBackdropFilter: "blur(40px) saturate(180%)",
          maxHeight:        "88vh",
          overflowY:        "auto",
          overflowX:        "hidden",
          padding:          "6px 20px 40px",
          boxSizing:        "border-box",
          transform:        entered ? "translateY(0)"    : "translateY(100%)",
          opacity:          entered ? 1                  : 0,
          transition:       "transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Drag handle */}
        <div style={{ display:"flex", justifyContent:"center", paddingTop:10, paddingBottom:6 }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.18)" }} />
        </div>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{ display:"flex", alignItems:"center", gap:14, paddingTop:10, paddingBottom:20 }}>
          {/* Animated checkmark circle */}
          <CheckCircle entered={entered} />
          <div>
            <p style={{
              margin:0, fontFamily:T.font,
              fontSize:"18px", fontWeight:700,
              color:T.text, letterSpacing:"-0.3px",
            }}>
              Scansione Completata
            </p>
            <p style={{
              margin:"3px 0 0", fontFamily:T.font,
              fontSize:"12px", fontWeight:400,
              color:T.muted,
            }}>
              Il piede è pronto per la modellazione
            </p>
          </div>
        </div>

        {/* ── Measurements card ───────────────────────────────────────── */}
        <GlassCard>
          <SectionHeader>MISURE RILEVATE</SectionHeader>

          <MeasRow label="Lunghezza"    value={`${m.lengthMm}`}        unit="mm" />
          <MeasRow label="Larghezza"    value={`${m.widthMm}`}         unit="mm" />
          <MeasRow label="Altezza Collo" value={`${m.instepHeightMm}`} unit="mm" />

          <Divider />

          {/* EU size — the most prominent value */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0 6px" }}>
            <span style={{ fontFamily:T.font, fontSize:"14px", color:T.label }}>
              Taglia EU Stimata
            </span>
            <span style={{
              fontFamily:T.mono, fontSize:"26px", fontWeight:700,
              color:T.accent, letterSpacing:"-0.5px",
            }}>
              {formatEu(m.euSize)}
            </span>
          </div>

          <MeasRow label="Volume"    value={m.volumeLabel} unit="" valueMono={false} />
          <MeasRow label="UK" value={formatEu(m.ukSize)} unit="" valueMono />
          <MeasRow label="US (M)"    value={formatEu(m.usSize)}  unit="" valueMono />
        </GlassCard>

        <Spacer h={12} />

        {/* ── Quality card ────────────────────────────────────────────── */}
        <GlassCard>
          <SectionHeader>QUALITÀ SCANSIONE</SectionHeader>

          <QualityRow
            label={`${q.observationCount} / ${q.maxPossible} punti catturati`}
            ok={q.observationCount >= 100}
          />
          <QualityRow
            label={`${q.textureFrameCount} snapshot HD`}
            ok={q.textureFrameCount >= 8}
          />
          {q.scanDurationMs !== null && (
            <QualityRow
              label={`Durata: ${formatDuration(q.scanDurationMs)}`}
              ok
            />
          )}

          {/* Score bar */}
          <div style={{ marginTop:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <span style={{ fontFamily:T.font, fontSize:"11px", color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                Indice di Qualità
              </span>
              <span style={{ fontFamily:T.mono, fontSize:"13px", fontWeight:600, color:qColor }}>
                {q.score}/100 — {q.label}
              </span>
            </div>
            <div style={{ height:5, background:"rgba(255,255,255,0.08)", borderRadius:3, overflow:"hidden" }}>
              <div style={{
                height:"100%",
                width:`${q.score}%`,
                borderRadius:3,
                background:qColor,
                transition:"width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }} />
            </div>
          </div>
        </GlassCard>

        <Spacer h={24} />

        {/* ── Primary CTA ─────────────────────────────────────────────── */}
        <button
          onClick={onConfirm}
          disabled={isSending}
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            gap:            10,
            width:          "100%",
            padding:        "17px 0",
            borderRadius:   "16px",
            border:         "none",
            cursor:         isSending ? "default" : "pointer",
            fontFamily:     T.font,
            fontSize:       "16px",
            fontWeight:     700,
            letterSpacing:  "-0.1px",
            color:          "#fff",
            background:     isSending
              ? "rgba(255,255,255,0.12)"
              : "linear-gradient(135deg, #0A84FF 0%, #005FCC 100%)",
            boxShadow:      isSending ? "none" : "0 4px 24px rgba(10,132,255,0.35)",
            transition:     "all 0.2s ease",
            userSelect:     "none",
            WebkitUserSelect: "none",
          }}
        >
          {isSending ? (
            <>
              <SpinnerIcon />
              Generazione in corso…
            </>
          ) : (
            <>
              <CubeIcon />
              Genera Modello 3D
            </>
          )}
        </button>

        <Spacer h={16} />

        {/* ── Retry link ──────────────────────────────────────────────── */}
        <button
          onClick={onRetry}
          disabled={isSending}
          style={{
            display:        "block",
            width:          "100%",
            padding:        "10px 0",
            background:     "transparent",
            border:         "none",
            cursor:         isSending ? "default" : "pointer",
            fontFamily:     T.font,
            fontSize:       "14px",
            fontWeight:     500,
            color:          isSending ? T.muted : T.label,
            textAlign:      "center",
            userSelect:     "none",
            WebkitUserSelect: "none",
          }}
        >
          Rifai Scansione
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background:   T.card,
      borderRadius: "16px",
      border:       `1px solid ${T.cardBorder}`,
      padding:      "14px 16px",
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      margin:        "0 0 12px",
      fontFamily:    T.font,
      fontSize:      "10.5px",
      fontWeight:    600,
      letterSpacing: "0.10em",
      textTransform: "uppercase",
      color:         T.muted,
    }}>
      {children}
    </p>
  );
}

interface MeasRowProps {
  label:      string;
  value:      string;
  unit:       string;
  valueMono?: boolean;
  highlight?: boolean;
}
function MeasRow({ label, value, unit, valueMono = true, highlight = false }: MeasRowProps) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 0" }}>
      <span style={{ fontFamily:T.font, fontSize:"13px", color:T.label }}>
        {label}
      </span>
      <span style={{
        fontFamily:  valueMono ? T.mono : T.font,
        fontSize:    "15px",
        fontWeight:  highlight ? 700 : 600,
        color:       highlight ? T.accent : T.text,
      }}>
        {value}
        {unit && (
          <span style={{ fontFamily:T.font, fontSize:"12px", fontWeight:400, color:T.muted, marginLeft:3 }}>
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

function QualityRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0" }}>
      <span style={{ fontSize:8, color: ok ? T.green : T.amber }}>●</span>
      <span style={{ fontFamily:T.font, fontSize:"13px", color: ok ? T.text : T.label }}>
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ height:1, background:T.divider, margin:"8px 0" }} />;
}

function Spacer({ h }: { h: number }) {
  return <div style={{ height:h }} />;
}

function CheckCircle({ entered }: { entered: boolean }) {
  return (
    <div style={{
      width:          44,
      height:         44,
      borderRadius:   "50%",
      background:     "rgba(48, 209, 88, 0.15)",
      border:         `2px solid ${T.green}`,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      flexShrink:     0,
      transform:      entered ? "scale(1)" : "scale(0.4)",
      opacity:        entered ? 1 : 0,
      transition:     "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s, opacity 0.4s ease 0.15s",
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12l5 5L19 7"
          stroke={T.green}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray:  28,
            strokeDashoffset: entered ? 0 : 28,
            transition:       "stroke-dashoffset 0.55s ease 0.35s",
          }}
        />
      </svg>
    </div>
  );
}

function CubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2 7l10 5m0 0l10-5m-10 5v10" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <div
      aria-hidden
      style={{
        width:  18, height:18,
        border: "2px solid rgba(255,255,255,0.25)",
        borderTopColor: "#fff",
        borderRadius: "50%",
        animation: "spin 0.9s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** Format EU/UK/US size: show ".0" only for round numbers, else show decimal */
function formatEu(size: number): string {
  return Number.isInteger(size) ? size.toFixed(1) : size.toFixed(1);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}
