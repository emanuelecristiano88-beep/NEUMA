/**
 * ScanReviewOverlay — post-scan review screen.
 *
 * Shown immediately after the dome erasure completes.  The last camera frame
 * is frozen as a dimmed background; the captured 3D point cloud is rendered
 * interactively on a canvas.  Emanuele can drag with one finger to orbit the
 * cloud and verify coverage before confirming or re-scanning.
 *
 * Rendering pipeline
 * ──────────────────
 * 1. Dark overlay + frozen-frame ghost at 15 % opacity
 * 2. Dashed A4 sheet outline for spatial reference
 * 3. Faint dome-equator wireframe circle
 * 4. Dome observation points — sorted back-to-front, colour-coded by sector:
 *      cyan   (top)   · blue  (lateral/left)  · purple (arch/right)
 *    Depth fog: farther points are smaller and more transparent.
 *
 * Touch / mouse drag rotates around Y (yaw) and X (pitch).
 * Pitch is clamped to −70° … +15° to prevent flipping.
 */

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
} from "react";
import type { ObservationData } from "@/lib/aruco/poseEstimation";
import type { SectorProgress } from "@/hooks/useFootEraser";

// ─── Types ────────────────────────────────────────────────────────────────────

type V3 = [number, number, number];
type Sector = "top" | "left" | "right";

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function classifyPoint(wx: number, wy: number, wz: number): Sector {
  const r = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (r < 1e-9) return "top";
  return wy / r > 0.65 ? "top" : wz < 0 ? "left" : "right";
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const SECTOR_COLORS: Record<Sector, { core: string; glow: string }> = {
  top:   { core: "56, 218, 255",   glow: "56, 218, 255"   }, // cyan
  left:  { core: "138, 180, 248",  glow: "138, 180, 248"  }, // light blue
  right: { core: "199, 146, 234",  glow: "199, 146, 234"  }, // purple
};

const SECTOR_LABELS: Record<Sector, string> = {
  top:   "Vista Superiore",
  left:  "Lato Laterale",
  right: "Arco Plantare",
};

// ─── 3-D render function ──────────────────────────────────────────────────────

function render3D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  points: V3[],
  frozenImg: HTMLImageElement | null,
  rotX: number,
  rotY: number,
) {
  ctx.clearRect(0, 0, w, h);

  // ── 1. Background ──────────────────────────────────────────────────────────
  // Frozen frame at very low opacity (spatial context without distracting)
  if (frozenImg) {
    ctx.save();
    ctx.globalAlpha = 0.13;
    const iw = frozenImg.naturalWidth, ih = frozenImg.naturalHeight;
    if (iw > 0 && ih > 0) {
      const scale = Math.max(w / iw, h / ih);
      const ox = (w - iw * scale) / 2;
      const oy = (h - ih * scale) / 2;
      ctx.drawImage(frozenImg, ox, oy, iw * scale, ih * scale);
    }
    ctx.restore();
  }
  // Dark tint so the point cloud pops
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(4, 10, 28, 0.88)");
  bg.addColorStop(1, "rgba(2, 5, 18, 0.92)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // ── Camera parameters ──────────────────────────────────────────────────────
  const cx   = w / 2;
  const cy   = h * 0.42; // slightly above centre — buttons sit below
  const FOCAL = Math.min(w, h) * 2.1;
  const CAM_Z = 0.62;

  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

  // Helper: transform a world point → [screenX, screenY] | null
  const project = (wx: number, wy: number, wz: number): [number, number] | null => {
    const x1 =  cosY * wx + sinY * wz;
    const y1 = wy;
    const z1 = -sinY * wx + cosY * wz;
    const x2 = x1;
    const y2 = cosX * y1 - sinX * z1;
    const z2 = sinX * y1 + cosX * z1;
    const depth = z2 + CAM_Z;
    if (depth < 0.01) return null;
    return [cx + (x2 / depth) * FOCAL, cy - (y2 / depth) * FOCAL];
  };

  // ── 2. A4 sheet outline (spatial anchor) ──────────────────────────────────
  {
    const corners: V3[] = [
      [-0.148, 0, -0.105], [0.148, 0, -0.105],
      [0.148, 0,  0.105], [-0.148, 0,  0.105],
    ];
    const pc = corners.map(([wx, wy, wz]) => project(wx, wy, wz));
    if (pc.every(Boolean)) {
      ctx.save();
      ctx.strokeStyle = "rgba(0, 200, 255, 0.20)";
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(pc[0]![0], pc[0]![1]);
      ctx.lineTo(pc[1]![0], pc[1]![1]);
      ctx.lineTo(pc[2]![0], pc[2]![1]);
      ctx.lineTo(pc[3]![0], pc[3]![1]);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── 3. Dome equator wireframe (Y = 0 circle, r = 0.25 m) ──────────────────
  {
    const N = 64;
    ctx.save();
    ctx.strokeStyle = "rgba(0, 200, 255, 0.07)";
    ctx.lineWidth   = 0.8;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const p = project(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25);
      if (!p) { first = true; continue; }
      if (first) { ctx.moveTo(p[0], p[1]); first = false; }
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── 4. Project + sort observation points ──────────────────────────────────
  type Dot = { sx: number; sy: number; depth: number; sector: Sector };
  const dots: Dot[] = [];

  for (const [wx, wy, wz] of points) {
    const x1 =  cosY * wx + sinY * wz;
    const y1 = wy;
    const z1 = -sinY * wx + cosY * wz;
    const x2 = x1;
    const y2 = cosX * y1 - sinX * z1;
    const z2 = sinX * y1 + cosX * z1;
    const depth = z2 + CAM_Z;
    if (depth < 0.01) continue;
    const sx = cx + (x2 / depth) * FOCAL;
    const sy = cy - (y2 / depth) * FOCAL;
    if (sx < -70 || sx > w + 70 || sy < -70 || sy > h + 70) continue;
    dots.push({ sx, sy, depth, sector: classifyPoint(wx, wy, wz) });
  }

  // Back-to-front (painter's algorithm)
  dots.sort((a, b) => b.depth - a.depth);

  // ── 5. Draw dots ──────────────────────────────────────────────────────────
  for (const { sx, sy, depth, sector } of dots) {
    const df    = Math.max(0.20, 1.35 - depth); // depth factor
    const alpha = Math.min(0.95, df * 0.88);
    const size  = Math.max(2.0, 6.0 * df);
    const { core, glow } = SECTOR_COLORS[sector];

    // Halo
    ctx.beginPath();
    ctx.arc(sx, sy, size * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${glow}, ${alpha * 0.09})`;
    ctx.fill();
    // Core dot
    ctx.beginPath();
    ctx.arc(sx, sy, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${core}, ${alpha})`;
    ctx.fill();
  }

  // ── 6. Point-count badge (bottom-left of cloud area) ─────────────────────
  ctx.save();
  ctx.font            = "bold 13px ui-rounded, -apple-system, sans-serif";
  ctx.fillStyle       = "rgba(255,255,255,0.28)";
  ctx.textAlign       = "center";
  ctx.fillText(`${dots.length} pt catturati`, cx, cy + Math.min(w, h) * 0.42);
  ctx.restore();
}

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
  const isOk   = pct >= 0.80;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* label */}
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

      {/* bar track */}
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
            background: isOk ? color : `rgba(251,191,36,0.85)`, // amber if below 80 %
            transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </div>

      {/* pct + status */}
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

      {/* warning dot */}
      <span style={{ fontSize: 12, lineHeight: 1, opacity: isOk ? 0 : 1, transition: "opacity 300ms" }}>
        ⚠
      </span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** All ObservationData records captured during the scan. */
  observations: ObservationData[];
  /** JPEG dataURL of the last video frame (null if unavailable). */
  frozenFrameUrl: string | null;
  /** Per-sector capture statistics. */
  sectorProgress: SectorProgress;
  /** Called when the user taps "Rifai Scansione". */
  onRetry: () => void;
  /** Called when the user taps "Conferma Misure". */
  onConfirm: () => void;
  /** True while the upload/confirm action is in progress. */
  isSending: boolean;
  visible: boolean;
}

export function ScanReviewOverlay({
  observations,
  frozenFrameUrl,
  sectorProgress,
  onRetry,
  onConfirm,
  isSending,
  visible,
}: Props) {
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const rafRef            = useRef<number>(0);
  const rotXRef           = useRef(-0.52); // pitch: look down at dome
  const rotYRef           = useRef(0.42);  // yaw: slight angle for 3/4 view
  const touchRef          = useRef<{ x: number; y: number } | null>(null);
  const isDraggingMouse   = useRef(false);
  const frozenImgRef      = useRef<HTMLImageElement | null>(null);
  const [hasDragged, setHasDragged] = useState(false);

  // Build world-position array once from observations
  const points: V3[] = observations.map(o => o.dotWorldPos);

  // Load frozen frame image
  useEffect(() => {
    if (!frozenFrameUrl) return;
    const img = new Image();
    img.onload = () => { frozenImgRef.current = img; };
    img.src    = frozenFrameUrl;
  }, [frozenFrameUrl]);

  // RAF render loop
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const p = canvas.parentElement;
      if (!p) return;
      if (canvas.width !== p.clientWidth || canvas.height !== p.clientHeight) {
        canvas.width  = p.clientWidth;
        canvas.height = p.clientHeight;
      }
    };

    const loop = () => {
      resize();
      const ctx = canvas.getContext("2d");
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        render3D(ctx, canvas.width, canvas.height, points, frozenImgRef.current, rotXRef.current, rotYRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, observations]);

  // ── Touch handlers ────────────────────────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setHasDragged(true);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchRef.current) return;
    const dx = e.touches[0].clientX - touchRef.current.x;
    const dy = e.touches[0].clientY - touchRef.current.y;
    rotYRef.current += dx * 0.008;
    rotXRef.current  = Math.max(-1.20, Math.min(0.15, rotXRef.current + dy * 0.008));
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const onTouchEnd = useCallback(() => {
    touchRef.current = null;
  }, []);

  // Mouse (desktop / testing)
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingMouse.current = true;
    touchRef.current = { x: e.clientX, y: e.clientY };
    setHasDragged(true);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingMouse.current || !touchRef.current) return;
    const dx = e.clientX - touchRef.current.x;
    const dy = e.clientY - touchRef.current.y;
    rotYRef.current += dx * 0.008;
    rotXRef.current  = Math.max(-1.20, Math.min(0.15, rotXRef.current + dy * 0.008));
    touchRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseUp = useCallback(() => {
    isDraggingMouse.current = false;
    touchRef.current = null;
  }, []);

  if (!visible) return null;

  const FONT = "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif";

  return (
    <div
      style={{
        position:   "absolute",
        inset:      0,
        zIndex:     120,
        display:    "flex",
        flexDirection: "column",
        overflow:   "hidden",
        animation:  "sap-fade-in 380ms cubic-bezier(0.22,1,0.36,1) both",
      }}
    >
      {/* ── 3D canvas (full-screen background) ─────────────────────────── */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor: "grab",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position:        "relative",
          zIndex:          1,
          padding:         "max(18px, env(safe-area-inset-top)) 20px 12px",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "space-between",
        }}
      >
        <div>
          <div style={{
            fontFamily:    FONT,
            fontWeight:    700,
            fontSize:      "clamp(18px, 5vw, 22px)",
            color:         "#ffffff",
            letterSpacing: "-0.3px",
          }}>
            Revisione Scansione
          </div>
          <div style={{
            fontFamily: FONT,
            fontSize:   12,
            color:      "rgba(255,255,255,0.38)",
            marginTop:  2,
            fontWeight: 400,
          }}>
            {observations.length} punti catturati
          </div>
        </div>

        {/* Pulsing checkmark badge */}
        <div style={{
          width:           44,
          height:          44,
          borderRadius:    "50%",
          background:      "rgba(52, 211, 153, 0.16)",
          border:          "1.5px solid rgba(52, 211, 153, 0.45)",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          animation:       "sap-pulse 2.2s ease-in-out infinite",
        }}>
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

      {/* ── Drag hint ──────────────────────────────────────────────────── */}
      <div
        style={{
          position:   "absolute",
          top:        "50%",
          left:       "50%",
          transform:  "translate(-50%, -50%) translateY(60px)",
          zIndex:     1,
          pointerEvents: "none",
          opacity:    hasDragged ? 0 : 0.65,
          transition: "opacity 500ms ease",
          display:    "flex",
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
        <span style={{
          fontFamily:  FONT,
          fontSize:    12,
          color:       "#ffffff",
          letterSpacing: "0.04em",
          fontWeight:  500,
        }}>
          Trascina per ruotare
        </span>
      </div>

      {/* ── Bottom sheet: sector bars + buttons ────────────────────────── */}
      <div
        style={{
          position:         "absolute",
          bottom:           0,
          left:             0,
          right:            0,
          zIndex:           2,
          padding:          "18px 20px max(20px, env(safe-area-inset-bottom))",
          background:       "linear-gradient(to top, rgba(4,10,28,0.97) 70%, rgba(4,10,28,0))",
          display:          "flex",
          flexDirection:    "column",
          gap:              14,
        }}
      >
        {/* Sector coverage bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{
            fontFamily:    FONT,
            fontSize:      11,
            fontWeight:    600,
            color:         "rgba(255,255,255,0.35)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom:  2,
          }}>
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

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>

          {/* ── Rifai Scansione (destructive) ─────────────────────────── */}
          <button
            onClick={onRetry}
            disabled={isSending}
            style={{
              flex:            "0 0 auto",
              height:          50,
              paddingInline:   20,
              borderRadius:    14,
              border:          "1.5px solid rgba(239, 68, 68, 0.50)",
              background:      "rgba(239, 68, 68, 0.10)",
              color:           "rgba(239,68,68,0.92)",
              fontFamily:      FONT,
              fontWeight:      600,
              fontSize:        15,
              letterSpacing:   "-0.2px",
              cursor:          isSending ? "not-allowed" : "pointer",
              opacity:         isSending ? 0.45 : 1,
              display:         "flex",
              alignItems:      "center",
              gap:             6,
              transition:      "opacity 200ms, transform 120ms",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Repeat / redo icon */}
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 8A5.5 5.5 0 1 0 8 2.5"
                stroke="currentColor" strokeWidth={1.8}
                strokeLinecap="round"
              />
              <polyline
                points="2.5,4.5 2.5,8 6,8"
                stroke="currentColor" strokeWidth={1.8}
                strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
            Rifai
          </button>

          {/* ── Conferma Misure (primary, Apple green) ────────────────── */}
          <button
            onClick={onConfirm}
            disabled={isSending}
            style={{
              flex:            1,
              height:          50,
              borderRadius:    14,
              border:          "none",
              background:      isSending
                ? "rgba(52, 211, 153, 0.40)"
                : "linear-gradient(135deg, rgba(52,211,153,0.95) 0%, rgba(16,185,129,0.95) 100%)",
              color:           "#ffffff",
              fontFamily:      FONT,
              fontWeight:      700,
              fontSize:        16,
              letterSpacing:   "-0.3px",
              cursor:          isSending ? "not-allowed" : "pointer",
              opacity:         isSending ? 0.75 : 1,
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "center",
              gap:             8,
              boxShadow:       isSending
                ? "none"
                : "0 4px 20px rgba(52,211,153,0.35)",
              transition:      "opacity 200ms, box-shadow 200ms, transform 120ms",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {isSending ? (
              <>
                <svg
                  width={18} height={18}
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
                    stroke="white" strokeWidth={2.2}
                    strokeLinecap="round" strokeLinejoin="round"
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
