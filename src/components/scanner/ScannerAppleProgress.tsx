/**
 * ScannerAppleProgress — WatchOS-style activity ring for foot-scan progress.
 *
 * Positioned top-right over the video feed.
 *
 * States
 * ──────
 * scanning  : ring fills clockwise (cyan) as 0 → 100 %
 * isComplete: ring snaps white, number swaps to ✓, subtitle "Completo!"
 *
 * The progress arc animates purely via CSS transition — no JS timers.
 * The percentage counter uses a lightweight RAF-driven ease-out animation.
 */
import React, { useEffect, useRef, useState } from "react";

// ─── Geometry ────────────────────────────────────────────────────────────────
const RING_SIZE    = 72;
const STROKE       = 6;
const RADIUS       = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CX = RING_SIZE / 2;
const CY = RING_SIZE / 2;

// ─── Colors ───────────────────────────────────────────────────────────────────
const COLOR_PROGRESS = "rgb(34,211,238)";   // cyan-400
const COLOR_DONE     = "rgb(255,255,255)";  // pure white at 100%

// ─── Keyframes injected once ─────────────────────────────────────────────────
const STYLE_ID = "sap-keyframes";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes sap-pulse {
      0%,100% { transform: scale(1);    opacity: 1;    }
      50%      { transform: scale(1.06); opacity: 0.85; }
    }
    @keyframes sap-check-draw {
      from { stroke-dashoffset: 40; }
      to   { stroke-dashoffset: 0;  }
    }
    @keyframes sap-fade-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
    @keyframes shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
  `;
  document.head.appendChild(s);
}

// ─── Animated integer counter ─────────────────────────────────────────────────
function useAnimatedCount(target: number, durationMs = 340) {
  const [displayed, setDisplayed] = useState(target);
  const fromRef  = useRef(target);
  const rafRef   = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    startRef.current = performance.now();
    const diff = target - from;

    const tick = (now: number) => {
      const t     = Math.min(1, (now - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      setDisplayed(Math.round(from + diff * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return displayed;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
  /** 0–100 */
  progress: number;
  remaining: number;
  visible: boolean;
  /** Set to true when all points have been consumed */
  isComplete?: boolean;
}

export function ScannerAppleProgress({
  progress,
  remaining,
  visible,
  isComplete = false,
}: Props) {
  const displayedPct = useAnimatedCount(isComplete ? 100 : progress, 320);

  // CSS stroke animation: full circle offset → 0 (filled)
  const dashOffset = CIRCUMFERENCE * (1 - Math.min(1, progress / 100));

  if (!visible) return null;

  const ringColor = isComplete ? COLOR_DONE : COLOR_PROGRESS;

  return (
    <div
      style={{
        position: "absolute",
        top: "max(14px, env(safe-area-inset-top))",
        right: 14,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: isComplete
          ? "rgba(255,255,255,0.12)"
          : "rgba(0,0,0,0.46)",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        border: isComplete
          ? "1px solid rgba(255,255,255,0.30)"
          : "1px solid rgba(255,255,255,0.10)",
        borderRadius: 999,
        padding: "6px 14px 6px 6px",
        boxShadow: isComplete
          ? "0 4px 24px rgba(255,255,255,0.18)"
          : "0 4px 24px rgba(0,0,0,0.35)",
        animation: isComplete ? "sap-pulse 1.8s ease-in-out infinite" : "none",
        transition: "background 600ms, border 600ms, box-shadow 600ms",
      }}
    >
      {/* ── Activity ring ───────────────────────────────────────────────── */}
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden
      >
        <defs>
          <filter id="sap-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={isComplete ? "4" : "2.5"} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <circle
          cx={CX} cy={CY} r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={STROKE}
        />

        {/* Progress arc */}
        <circle
          cx={CX} cy={CY} r={RADIUS}
          fill="none"
          stroke={ringColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={isComplete ? 0 : dashOffset}
          transform={`rotate(-90 ${CX} ${CY})`}
          filter="url(#sap-glow)"
          style={{
            transition: isComplete
              ? "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1), stroke 400ms ease"
              : "stroke-dashoffset 400ms cubic-bezier(0.22,1,0.36,1), stroke 400ms ease",
          }}
        />

        {/* Checkmark — visible only when complete */}
        {isComplete && (
          <polyline
            points={`${CX - 11},${CY} ${CX - 3},${CY + 8} ${CX + 12},${CY - 9}`}
            fill="none"
            stroke="white"
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={40}
            strokeDashoffset={0}
            style={{ animation: "sap-check-draw 380ms cubic-bezier(0.22,1,0.36,1) forwards" }}
          />
        )}
      </svg>

      {/* ── Text block ──────────────────────────────────────────────────── */}
      <div
        style={{
          minWidth: 36,
          animation: isComplete ? "sap-fade-in 300ms ease both" : "none",
        }}
      >
        <div
          style={{
            fontFamily:
              "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif",
            fontWeight: 700,
            fontSize: isComplete ? 17 : 20,
            lineHeight: 1,
            color: "#ffffff",
            letterSpacing: "-0.5px",
            transition: "font-size 300ms ease",
          }}
        >
          {isComplete ? "✓  Completo" : `${displayedPct}%`}
        </div>

        <div
          style={{
            fontFamily:
              "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif",
            fontWeight: 500,
            fontSize: 10,
            color: isComplete
              ? "rgba(255,255,255,0.70)"
              : "rgba(255,255,255,0.45)",
            marginTop: 3,
            letterSpacing: "0.02em",
            transition: "color 400ms ease",
          }}
        >
          {isComplete ? "Elaborazione…" : `${remaining} rimasti`}
        </div>
      </div>
    </div>
  );
}
