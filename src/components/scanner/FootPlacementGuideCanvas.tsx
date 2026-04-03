/**
 * FootPlacementGuideCanvas — pre-scan positioning overlay.
 *
 * Shows a thin dashed foot silhouette projected onto the A4 sheet (ArUco-
 * tracked), a heel reference line with L-bracket corner marks, and an
 * instruction pill.  A segmented-control lets the user switch between
 * "Sinistro" and "Destro" foot.
 *
 * Visibility contract (managed by parent):
 *   visible=true  → eraser not yet started (totalConsumed === 0)
 *   visible=false → scan has begun; component fades out via CSS transition
 *
 * Coordinate system (world, Y=0 = A4 plane):
 *   X axis → long side of A4 in landscape (±148.5mm).  Heel at X ≈ −0.110,
 *             toes at X ≈ +0.100.
 *   Z axis → short side of A4 (±105mm), i.e. lateral / medial foot width.
 *   Right foot: little-toe side at Z+, big-toe at Z−.
 *   Left  foot: mirror Z (sz = −1).
 */
"use client";

import React, { useEffect, useRef } from "react";
import type { OpenCvArucoQuad } from "@/hooks/useOpenCvArucoAnalysis";
import type { FootId } from "@/types/scan";
import {
  estimateCameraIntrinsics,
  estimatePoseFromQuads,
  projectPoint3D,
  type CameraPose,
} from "@/lib/aruco/poseEstimation";

// ── Foot-outline geometry ──────────────────────────────────────────────────────

function makeFootOutline(foot: FootId): Array<[number, number, number]> {
  const sz = foot === "RIGHT" ? 1 : -1;
  // Clockwise from heel, Y=0, all metres.
  // sz > 0 → right foot  (little toe at Z+, big toe at Z−)
  // sz < 0 → left  foot  (big toe at Z+, little toe at Z−)
  return [
    [-0.110, 0, sz *  0.000],  // heel centre
    [-0.106, 0, sz *  0.024],  // heel lateral edge
    [-0.075, 0, sz *  0.038],  // outer side, upper
    [-0.020, 0, sz *  0.044],  // outer side, mid
    [ 0.010, 0, sz *  0.043],  // 5th metatarsal head
    [ 0.058, 0, sz *  0.040],  // little-toe outer
    [ 0.072, 0, sz *  0.034],  // little toe
    [ 0.082, 0, sz *  0.022],  // 4th toe
    [ 0.095, 0, sz *  0.008],  // 3rd (middle) toe
    [ 0.100, 0, sz * -0.003],  // 2nd (index) toe — longest
    [ 0.096, 0, sz * -0.014],  // between index and big toe
    [ 0.086, 0, sz * -0.024],  // big-toe lateral side
    [ 0.070, 0, sz * -0.034],  // big-toe tip
    [ 0.046, 0, sz * -0.038],  // 1st metatarsal head
    [ 0.000, 0, sz * -0.040],  // medial mid-foot
    [-0.055, 0, sz * -0.028],  // arch (narrow)
    [-0.085, 0, sz * -0.025],  // inner heel side
    [-0.108, 0, sz * -0.018],  // inner heel
    [-0.110, 0, sz *  0.000],  // close → heel centre
  ] as Array<[number, number, number]>;
}

// Heel reference line — perpendicular to foot axis, at the heel
const HEEL_A: [number, number, number] = [-0.118, 0, -0.062];
const HEEL_B: [number, number, number] = [-0.118, 0,  0.062];

// L-bracket corner segments at each end of the heel line
const HEEL_SEGS: Array<[[number, number, number], [number, number, number]]> = [
  [[-0.118, 0, -0.062], [-0.096, 0, -0.062]],  // bottom  — horizontal arm
  [[-0.118, 0, -0.062], [-0.118, 0, -0.044]],  // bottom  — vertical arm
  [[-0.118, 0,  0.062], [-0.096, 0,  0.062]],  // top     — horizontal arm
  [[-0.118, 0,  0.062], [-0.118, 0,  0.044]],  // top     — vertical arm
];

// ── Component ──────────────────────────────────────────────────────────────────

export interface FootPlacementGuideProps {
  markerQuads:  OpenCvArucoQuad[];
  videoRef:     React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  foot:         FootId;
  onFootChange: (f: FootId) => void;
  /** True while no point has been erased yet (totalConsumed === 0). */
  visible:      boolean;
}

export function FootPlacementGuideCanvas({
  markerQuads,
  videoRef,
  containerRef,
  foot,
  onFootChange,
  visible,
}: FootPlacementGuideProps) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const rafRef        = useRef<number>(0);
  const quadsRef      = useRef(markerQuads);
  const footRef       = useRef(foot);
  const lastPoseRef   = useRef<CameraPose | null>(null);
  const lastPoseAtRef = useRef<number>(0);

  useEffect(() => { quadsRef.current = markerQuads; }, [markerQuads]);
  useEffect(() => { footRef.current  = foot; },        [foot]);

  // Resize canvas to match container dimensions
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const sync = () => {
      const r = container.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        canvas.width  = r.width;
        canvas.height = r.height;
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef]);

  // RAF draw loop — starts / stops with `visible`
  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const canvas = canvasRef.current;
    const ctx    = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const GHOST_MS = 900; // hold last pose this long after marker loss

    const draw = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) { rafRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, w, h);

      // ── 1. Tracking state ──────────────────────────────────────────────────
      const quads  = quadsRef.current;
      const video  = videoRef.current;
      const videoW = video?.videoWidth  ?? 0;
      const videoH = video?.videoHeight ?? 0;
      const isLive = quads.length >= 4 && videoW > 0 && videoH > 0;

      const K = estimateCameraIntrinsics(w, h);

      if (isLive) {
        const raw = estimatePoseFromQuads(quads, videoW, videoH, w, h, K);
        if (raw) {
          lastPoseRef.current   = raw;
          lastPoseAtRef.current = now;
        }
      }

      const poseAge = now - lastPoseAtRef.current;
      const pose: CameraPose | null =
        isLive
          ? lastPoseRef.current
          : poseAge < GHOST_MS
            ? lastPoseRef.current
            : null;

      // Breathing pulse: 0.50 → 1.00 → 0.50 at ~0.44 Hz
      const pulse = 0.50 + 0.50 * Math.sin(now * 0.00276);

      // ── 2. Projected silhouette ────────────────────────────────────────────
      if (pose) {
        const outline = makeFootOutline(footRef.current);
        const pts2d   = outline.map(p => projectPoint3D(p, pose, K));

        // Dashed outline
        ctx.save();
        ctx.strokeStyle = `rgba(255,255,255,${isLive ? 0.58 : 0.22})`;
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 8]);
        ctx.lineCap     = "round";
        ctx.lineJoin    = "round";
        ctx.beginPath();
        let started = false;
        for (const p of pts2d) {
          if (!p) continue;
          if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
          else          ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // Subtle fill tint when tracking is live
        if (isLive) {
          ctx.save();
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.beginPath();
          started = false;
          for (const p of pts2d) {
            if (!p) continue;
            if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
            else          ctx.lineTo(p[0], p[1]);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // ── 3. Heel reference line ─────────────────────────────────────────
        const pHA = projectPoint3D(HEEL_A, pose, K);
        const pHB = projectPoint3D(HEEL_B, pose, K);

        if (pHA && pHB) {
          // Soft glow when live
          if (isLive) {
            ctx.save();
            ctx.strokeStyle = `rgba(255,255,255,${pulse * 0.30})`;
            ctx.lineWidth   = 10;
            ctx.filter      = "blur(5px)";
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(pHA[0], pHA[1]);
            ctx.lineTo(pHB[0], pHB[1]);
            ctx.stroke();
            ctx.restore();
          }

          // Crisp line
          ctx.save();
          ctx.strokeStyle = isLive
            ? `rgba(255,255,255,${0.60 + pulse * 0.35})`
            : "rgba(255,255,255,0.38)";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(pHA[0], pHA[1]);
          ctx.lineTo(pHB[0], pHB[1]);
          ctx.stroke();
          ctx.restore();
        }

        // ── 4. L-bracket corner marks ──────────────────────────────────────
        for (const [sA, sB] of HEEL_SEGS) {
          const pA = projectPoint3D(sA, pose, K);
          const pB = projectPoint3D(sB, pose, K);
          if (!pA || !pB) continue;
          ctx.save();
          ctx.strokeStyle = isLive
            ? `rgba(255,255,255,${0.65 + pulse * 0.30})`
            : "rgba(255,255,255,0.38)";
          ctx.lineWidth = 2;
          ctx.lineCap   = "square";
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(pA[0], pA[1]);
          ctx.lineTo(pB[0], pB[1]);
          ctx.stroke();
          ctx.restore();
        }
      }

      // ── 5. Instruction pill ────────────────────────────────────────────────
      const nMarkers = quads.length;
      const mainMsg =
        !pose
          ? nMarkers === 0
            ? "Inquadra il foglio A4"
            : `Inquadra tutti i marker (${nMarkers}/4)`
          : isLive
            ? "Posiziona il tallone sulla linea tratteggiata"
            : "Tieni fermo il telefono…";

      const subMsg: string | null =
        isLive && pose
          ? "Poi avvicina lentamente la fotocamera"
          : null;

      const dotColor = isLive ? "#30D158" : "#FF9F0A";
      drawPill(ctx, w / 2, h * 0.79, mainMsg, subMsg, dotColor);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, containerRef, videoRef]);

  return (
    <>
      {/* Silhouette canvas */}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position:      "absolute",
          inset:         0,
          width:         "100%",
          height:        "100%",
          pointerEvents: "none",
          zIndex:        22,
          opacity:       visible ? 1 : 0,
          transition:    "opacity 0.45s ease",
        }}
      />

      {/* Foot selector — Apple-style segmented control */}
      <div
        style={{
          position:        "absolute",
          bottom:          "13%",
          left:            "50%",
          transform:       "translateX(-50%)",
          zIndex:          26,
          display:         "flex",
          alignItems:      "center",
          gap:             0,
          backgroundColor: "rgba(22,22,24,0.76)",
          backdropFilter:  "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          borderRadius:    "15px",
          padding:         "3px",
          border:          "1px solid rgba(255,255,255,0.11)",
          opacity:         visible ? 1 : 0,
          pointerEvents:   visible ? "auto" : "none",
          transition:      "opacity 0.45s ease",
        }}
      >
        {(["LEFT", "RIGHT"] as FootId[]).map((id) => {
          const label  = id === "LEFT" ? "Sinistro" : "Destro";
          const active = foot === id;
          return (
            <button
              key={id}
              onClick={() => onFootChange(id)}
              style={{
                padding:         "8px 22px",
                borderRadius:    "12px",
                border:          "none",
                cursor:          "pointer",
                fontFamily:      "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif",
                fontSize:        "13px",
                fontWeight:      active ? 600 : 400,
                letterSpacing:   "0.01em",
                color:           active ? "#000000" : "rgba(255,255,255,0.50)",
                backgroundColor: active ? "#ffffff" : "transparent",
                transition:      "background-color 0.22s ease, color 0.22s ease",
                userSelect:      "none",
                WebkitUserSelect: "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── Canvas helper ──────────────────────────────────────────────────────────────

function drawPill(
  ctx: CanvasRenderingContext2D,
  cx:      number,
  cy:      number,
  main:    string,
  sub:     string | null,
  dotColor: string,
) {
  ctx.save();

  const FONT_MAIN  = "600 13.5px ui-rounded, -apple-system, sans-serif";
  const FONT_SUB   = "400 11px ui-rounded, -apple-system, sans-serif";
  const PAD_H      = 15;    // horizontal inner padding
  const PAD_V      = 10;    // vertical inner padding
  const DOT_R      = 3.5;
  const DOT_GAP    = 8;
  const LINE_SPACE = 6;

  // Measure text widths
  ctx.font = FONT_MAIN;
  const mainW = ctx.measureText(main).width;
  ctx.font = FONT_SUB;
  const subW  = sub ? ctx.measureText(sub).width : 0;

  const contentW = Math.max(mainW, subW) + DOT_R * 2 + DOT_GAP;
  const pillW    = contentW + PAD_H * 2;
  const pillH    = sub ? 44 : 36;
  const rx       = 12;
  const x0       = cx - pillW / 2;
  const y0       = cy - pillH / 2;

  // Background pill
  ctx.beginPath();
  ctx.roundRect(x0, y0, pillW, pillH, rx);
  ctx.fillStyle   = "rgba(14,14,16,0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth   = 1;
  ctx.setLineDash([]);
  ctx.stroke();

  // Status dot
  const dotX = x0 + PAD_H + DOT_R;
  const mainLineY = sub ? y0 + PAD_V + 4 : cy;
  ctx.beginPath();
  ctx.arc(dotX, mainLineY, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();

  // Main text
  ctx.font         = FONT_MAIN;
  ctx.fillStyle    = "rgba(255,255,255,0.92)";
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(main, dotX + DOT_R + DOT_GAP, mainLineY);

  // Sub text
  if (sub) {
    ctx.font      = FONT_SUB;
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.textBaseline = "middle";
    ctx.fillText(sub, x0 + PAD_H, mainLineY + 16 + LINE_SPACE);
  }

  ctx.restore();
}
