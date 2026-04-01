/**
 * FootEraserCanvas — hemisphere eraser overlay rendered on top of the
 * live video feed.
 *
 * Projection strategy:
 *   PRIMARY  (≥ 4 ArUco markers)  — cv.projectPoints equivalent:
 *     estimatePoseFromQuads → projectPoint3D for every remaining dome point.
 *     Dots "follow" the A4 sheet perfectly when the phone moves.
 *   FALLBACK (0–3 markers)        — hide all dots immediately.
 *     This avoids the "flying dots" artefact when tracking is lost.
 *
 * Drawing style: white translucent filled circles (Apple / SF aesthetic).
 * Scanning zone dots (90 px from centre) pulse in a warm amber.
 * Dying particles fade out over 200 ms.
 */
import React, { useEffect, useRef } from "react";
import type { OpenCvArucoQuad } from "@/hooks/useOpenCvArucoAnalysis";
import type { FootEraserState } from "@/hooks/useFootEraser";
import type { ScanFrameTilt } from "@/hooks/useScanFrameOrientation";
import {
  estimateCameraIntrinsics,
  estimatePoseFromQuads,
  projectDomePoints,
} from "@/lib/aruco/poseEstimation";

// ─── Visual constants ─────────────────────────────────────────────────────────

const DONE_RADIUS_PX = 50;
const SCAN_RADIUS_PX = 90;
const DOT_R_IDLE     = 4.5;
const DOT_R_SCAN     = 6;
const DYING_MS       = 200;

// Apple-style: white at different opacities
const COLOR_IDLE     = "rgba(255, 255, 255, 0.62)";
const COLOR_SCAN     = "rgba(251, 191, 36,  0.90)"; // amber warm-up
const COLOR_SCAN_GLOW= "rgba(251, 191, 36,  0.20)";
const COLOR_DYING    = "rgba(255, 255, 255, 1)";

// How long (ms) without a marker before we fully hide the dots
const HIDE_AFTER_LOST_MS = 400;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DyingParticle { id: number; sx: number; sy: number; diedAt: number; }

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  eraser: FootEraserState;
  /** Tilt ref used ONLY as fallback when ArUco tracking is lost. */
  tiltRef: React.MutableRefObject<ScanFrameTilt>;
  /** Detected ArUco quads from useOpenCvArucoAnalysis snapshot. */
  markerQuads: OpenCvArucoQuad[];
  /** The <video> element — needed for videoWidth / videoHeight. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** The scanner container element — needed for display width / height. */
  containerRef: React.RefObject<HTMLElement | null>;
  visible: boolean;
}

export function FootEraserCanvas({
  eraser,
  tiltRef: _tiltRef, // kept in API for tilt-fallback future use
  markerQuads,
  videoRef,
  containerRef,
  visible,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const dyingRef  = useRef<DyingParticle[]>([]);
  const lastSeenMarkersRef = useRef<number>(0); // performance.now() of last good tracking

  // Keep a stable ref to the latest markerQuads without triggering effect re-runs
  const quadsRef = useRef<OpenCvArucoQuad[]>(markerQuads);
  useEffect(() => { quadsRef.current = markerQuads; }, [markerQuads]);

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
      const parent = containerRef.current ?? canvas.parentElement;
      if (!parent) { rafRef.current = requestAnimationFrame(draw); return; }

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
      }
      if (w === 0 || h === 0) { rafRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, w, h);
      const now   = performance.now();
      const cx    = w / 2;
      const cy    = h / 2;

      // ── 1. Try ArUco-based projection ─────────────────────────────────────
      const quads   = quadsRef.current;
      const video   = videoRef.current;
      const videoW  = video?.videoWidth  ?? 0;
      const videoH  = video?.videoHeight ?? 0;
      const hasTracking = quads.length >= 4 && videoW > 0 && videoH > 0;

      if (hasTracking) lastSeenMarkersRef.current = now;
      const trackingAge = now - lastSeenMarkersRef.current;

      // Hide immediately when tracking is lost (no "flying" artefacts)
      if (trackingAge > HIDE_AFTER_LOST_MS) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Estimate camera pose + project dome points
      const K    = estimateCameraIntrinsics(w, h);
      const pose = hasTracking
        ? estimatePoseFromQuads(quads, videoW, videoH, w, h, K)
        : null;

      const projectedAll = pose
        ? projectDomePoints(eraser.remainingPoints, pose, K, w, h)
        : [];

      // ── 2. Classify projected dots → done / scanning / idle ───────────────
      const doneIds: number[]     = [];
      const scanIds: number[]     = [];
      const idleDots: typeof projectedAll  = [];
      const scanDots: typeof projectedAll  = [];

      for (const dot of projectedAll) {
        const d2 = (dot.sx - cx) ** 2 + (dot.sy - cy) ** 2;
        if (d2 <= DONE_RADIUS_PX ** 2) {
          doneIds.push(dot.id);
        } else if (d2 <= SCAN_RADIUS_PX ** 2) {
          scanIds.push(dot.id);
          scanDots.push(dot);
        } else {
          idleDots.push(dot);
        }
      }

      // Consume newly done dots (ArUco path)
      if (doneIds.length > 0 || scanIds.length > 0) {
        // Provide the screen coords for dying animation before consuming
        for (const dot of projectedAll) {
          if (doneIds.includes(dot.id)) {
            // Only add if not already dying (avoid duplicates)
            if (!dyingRef.current.some((d) => d.id === dot.id)) {
              dyingRef.current.push({ id: dot.id, sx: dot.sx, sy: dot.sy, diedAt: now });
            }
          }
        }
        eraser.consume(doneIds, scanIds);
      }

      // Evict expired dying particles
      dyingRef.current = dyingRef.current.filter((p) => now - p.diedAt < DYING_MS);

      // ── 3. Draw outer scanning ring (faint amber) ─────────────────────────
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth   = 1;
      ctx.strokeStyle = "rgba(251, 191, 36, 0.22)";
      ctx.beginPath();
      ctx.arc(cx, cy, SCAN_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── 4. Draw inner eraser ring (white dashed) ─────────────────────────
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth   = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.42)";
      ctx.beginPath();
      ctx.arc(cx, cy, DONE_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── 5. Idle dots — white translucent (Apple style) ───────────────────
      ctx.fillStyle = COLOR_IDLE;
      for (const dot of idleDots) {
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_IDLE, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 6. Scanning dots — amber with glow ───────────────────────────────
      for (const dot of scanDots) {
        // Outer glow
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_SCAN + 5, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_SCAN_GLOW;
        ctx.fill();
        // Core
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_SCAN, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_SCAN;
        ctx.fill();
      }

      // ── 7. Dying particles — white shrink + fade ─────────────────────────
      for (const p of dyingRef.current) {
        const t     = 1 - (now - p.diedAt) / DYING_MS; // 1 → 0
        const eased = t * t;
        ctx.save();
        ctx.globalAlpha = eased;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, eased * (DOT_R_IDLE + 5), 0, Math.PI * 2);
        ctx.fillStyle = COLOR_DYING;
        ctx.fill();
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, eraser, containerRef, videoRef]);

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
