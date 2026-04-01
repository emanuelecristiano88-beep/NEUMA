/**
 * ScannerAppleProgress — WatchOS-style activity ring for foot-scan progress.
 *
 * Positioned top-right over the video feed.
 * • Circular arc fills clockwise as progress 0→100%.
 * • Arc stroke animates smoothly via CSS transition (no JS timer needed).
 * • Percentage number counts up with a lightweight RAF counter.
 * • Glass-morphism pill background (blur + translucent dark).
 */
import React, { useEffect, useRef, useState } from "react";

interface Props {
  /** 0-100 */
  progress: number;
  remaining: number;
  visible: boolean;
}

const RING_SIZE = 72;          // overall SVG size (px)
const STROKE = 6;              // ring stroke width
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CX = RING_SIZE / 2;
const CY = RING_SIZE / 2;

/** Animated integer counter — smoothly follows the target value. */
function useAnimatedCount(target: number, durationMs = 350) {
  const [displayed, setDisplayed] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    startRef.current = performance.now();
    const diff = target - from;

    const animate = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + diff * eased);
      setDisplayed(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current = target;
      }
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return displayed;
}

export function ScannerAppleProgress({ progress, remaining, visible }: Props) {
  const displayedPct = useAnimatedCount(progress, 320);

  // stroke-dashoffset: full circle = CIRCUMFERENCE (empty), 0 = full
  const dashOffset = CIRCUMFERENCE * (1 - Math.min(1, progress / 100));

  if (!visible) return null;

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
        background: "rgba(0, 0, 0, 0.46)",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 999,
        padding: "6px 14px 6px 6px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
      }}
    >
      {/* ── Activity ring ─────────────────────────────────────────────────── */}
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden
      >
        {/* Subtle glow backdrop */}
        <defs>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track ring */}
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
          stroke="rgb(34, 211, 238)"          /* cyan-400, matches Starlink theme */
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${CX} ${CY})`}
          filter="url(#ring-glow)"
          style={{
            transition: "stroke-dashoffset 400ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />

        {/* Tiny completion dot — lights up at 100% */}
        {progress >= 100 && (
          <circle cx={CX} cy={STROKE / 2} r={STROKE / 2} fill="rgb(34,211,238)" />
        )}
      </svg>

      {/* ── Text block ────────────────────────────────────────────────────── */}
      <div style={{ minWidth: 36 }}>
        <div
          style={{
            fontFamily: "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif",
            fontWeight: 700,
            fontSize: 20,
            lineHeight: 1,
            color: "#ffffff",
            letterSpacing: "-0.5px",
          }}
        >
          {displayedPct}%
        </div>
        <div
          style={{
            fontFamily: "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif",
            fontWeight: 500,
            fontSize: 10,
            color: "rgba(255,255,255,0.45)",
            marginTop: 3,
            letterSpacing: "0.02em",
          }}
        >
          {remaining} rimasti
        </div>
      </div>
    </div>
  );
}
