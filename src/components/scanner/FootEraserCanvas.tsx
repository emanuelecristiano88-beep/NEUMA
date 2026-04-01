/**
 * FootEraserCanvas — hemisphere eraser overlay rendered on top of the
 * live video feed.
 *
 * Drawing order each frame:
 *  1. Dashed white eraser ring at screen centre (50 px radius).
 *  2. Live hemisphere dots: small red filled circles.
 *  3. Dying/fading particles: red circles that shrink + fade in 200 ms.
 *
 * The canvas manages its own RAF loop and calls `eraser.tick()` which
 * both projects dots AND returns newly consumed ones for fade animation.
 */
import React, { useEffect, useRef } from "react";
import type { ScanFrameTilt } from "@/hooks/useScanFrameOrientation";
import type { FootEraserState } from "@/hooks/useFootEraser";

// ─── Constants ────────────────────────────────────────────────────────────────

const ERASER_RADIUS_PX = 50;
const DOT_RADIUS = 4;
const DYING_DURATION_MS = 200;
const DOT_COLOR = "rgba(220, 38, 38, 0.9)"; // Tailwind red-600

// ─── Types ────────────────────────────────────────────────────────────────────

interface DyingParticle {
  id: number;
  sx: number;
  sy: number;
  diedAt: number; // performance.now() timestamp
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  eraser: FootEraserState;
  tiltRef: React.MutableRefObject<ScanFrameTilt>;
  visible: boolean;
}

export function FootEraserCanvas({ eraser, tiltRef, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dyingRef = useRef<DyingParticle[]>([]);

  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(rafRef.current);
      dyingRef.current = [];
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) { rafRef.current = requestAnimationFrame(draw); return; }

      // Keep canvas pixel-perfect to its container
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const cx = w / 2;
      const cy = h / 2;

      // ── 1. Run eraser tick: project dots + collect newly consumed ────────
      const { live, consumed } = eraser.tick(tiltRef.current, w, h);

      // Add freshly consumed dots to the dying queue
      for (const c of consumed) {
        dyingRef.current.push({ id: c.id, sx: c.sx, sy: c.sy, diedAt: now });
      }

      // Evict expired dying particles
      dyingRef.current = dyingRef.current.filter(
        (p) => now - p.diedAt < DYING_DURATION_MS,
      );

      // ── 2. Eraser ring (dashed white circle at screen centre) ─────────────
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.50)";
      ctx.beginPath();
      ctx.arc(cx, cy, ERASER_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── 3. Live dots ──────────────────────────────────────────────────────
      ctx.fillStyle = DOT_COLOR;
      for (const dot of live) {
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 4. Dying particles: fade out + scale down ─────────────────────────
      for (const p of dyingRef.current) {
        const elapsed = now - p.diedAt;
        const t = 1 - elapsed / DYING_DURATION_MS; // 1 → 0 (fresh → gone)
        // ease-in-quad so the pop feels snappy
        const eased = t * t;
        const alpha = eased;
        const scale = eased * (DOT_RADIUS + 3); // grows slightly then shrinks

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, scale, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(251, 113, 133, 1)"; // rose-400 — different tint on death
        ctx.fill();
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible, eraser, tiltRef]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 25,
      }}
    />
  );
}
