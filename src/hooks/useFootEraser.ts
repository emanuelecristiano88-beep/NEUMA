/**
 * useFootEraser — "Eraser" UX for foot scan.
 *
 * Generates 150 points on a hemisphere using Vogel's golden-spiral method
 * (most uniform distribution known for a sphere surface). The caller passes
 * current device tilt + canvas size to `tick()` which:
 *   1. Projects every remaining point to 2-D screen coordinates.
 *   2. Marks any dot landing within ERASER_RADIUS_PX of screen centre as
 *      consumed (with haptic micro-pulse).
 *   3. Returns { live, consumed } so the canvas can animate fading particles.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanFrameTilt } from "./useScanFrameOrientation";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EraserPoint {
  id: number;
  wx: number; wy: number; wz: number; // world space, metres, Y-up
}

export interface ProjectedDot {
  id: number;
  sx: number; sy: number; // screen coords (px)
}

export interface TickResult {
  live: ProjectedDot[];     // still-remaining dots to draw
  consumed: ProjectedDot[]; // newly erased this frame (for fade animation)
}

export interface FootEraserState {
  remaining: EraserPoint[];
  /** Call from RAF loop; returns live + consumed dots. */
  tick: (tilt: ScanFrameTilt, screenW: number, screenH: number) => TickResult;
  progress: number;    // 0-100
  isComplete: boolean;
  totalConsumed: number;
  reset: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL = 150;
const RADIUS_M = 0.25;
const ERASER_RADIUS_PX = 50;
/** Max tilt angle reported by useScanFrameOrientation (degrees). */
const MAX_TILT_X_DEG = 22;
const MAX_TILT_Z_DEG = 28;
/** When fully tilted (rotateX = MAX_TILT_X_DEG), camera sweeps to this polar angle. */
const MAX_PHI_DEG = 75;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deg2rad(d: number) { return (d * Math.PI) / 180; }

/**
 * Vogel / golden-spiral hemisphere.
 * Uses the sunflower-seed formula: azimuth = i * golden_angle,
 * y (elevation) = 1 − i / (n − 0.5) which gives a perfectly uniform
 * distribution on the upper hemisphere surface — the same organic pattern
 * seen in sunflower heads.
 */
function buildHemisphere(n: number): EraserPoint[] {
  const golden = Math.PI * (3 - Math.sqrt(5)); // golden angle ≈ 137.5°
  const pts: EraserPoint[] = [];
  for (let i = 0; i < n; i++) {
    // y ∈ (1, ~0]: ensures every point stays in the upper hemisphere
    const y = 1 - i / (n - 0.5);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({
      id: i,
      wx: Math.cos(theta) * r * RADIUS_M,
      wy: Math.max(0, y) * RADIUS_M,
      wz: Math.sin(theta) * r * RADIUS_M,
    });
  }
  return pts;
}

/**
 * Map device tilt → unit-vector on the hemisphere the camera is "pointing at".
 *
 * From useScanFrameOrientation:
 *   rotateX = (beta − 90) * k  → forward/back tilt from portrait-vertical
 *   rotateZ = gamma * k        → left/right roll
 *
 * When both are 0 the phone is level, camera faces straight down → the TOP of
 * the hemisphere (y = 1) is centred in the frame.
 */
function getCamViewDir(tilt: ScanFrameTilt): [number, number, number] {
  const maxPhi = deg2rad(MAX_PHI_DEG);
  // Normalise tilt → fraction of max tilt, then convert to spherical offset
  const fx = (tilt.rotateX / MAX_TILT_X_DEG) * Math.sin(maxPhi); // forward  → +z
  const fz = (tilt.rotateZ / MAX_TILT_Z_DEG) * Math.sin(maxPhi); // right    → +x
  const fy = Math.sqrt(Math.max(0, 1 - fx * fx - fz * fz));       // always up
  const len = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  return [fz / len, fy / len, fx / len]; // [x, y, z]
}

/**
 * Equidistant spherical projection centred on the current camera direction.
 * Points directly "in front of" the camera land at screen centre; the
 * displacement from centre grows linearly with angular offset.
 */
function projectPoint(
  pt: EraserPoint,
  viewDir: [number, number, number],
  sw: number,
  sh: number,
): ProjectedDot | null {
  const r = Math.sqrt(pt.wx * pt.wx + pt.wy * pt.wy + pt.wz * pt.wz) || 1;
  const px = pt.wx / r, py = pt.wy / r, pz = pt.wz / r;

  // Cosine of angle from camera direction (1 = centre, 0 = 90°, <0 = behind)
  const cosDot = px * viewDir[0] + py * viewDir[1] + pz * viewDir[2];
  if (cosDot < 0.04) return null; // cull behind-camera / far-horizon points

  // Angular distance from camera centre (radians)
  const angOff = Math.acos(Math.min(1, cosDot));

  // Approximate focal length from ~60° FOV
  const focal = sw / (2 * Math.tan(deg2rad(30)));

  // Screen-plane radius
  const screenR = Math.tan(angOff) * focal;

  // ── Screen-plane axes (orthonormal basis perpendicular to viewDir) ──────
  const [vx, vy, vz] = viewDir;

  // Camera "right" axis: always perpendicular to viewDir in the xz-plane
  let crx = -Math.sin(Math.atan2(vz, vx));
  let cry = 0;
  let crz = Math.cos(Math.atan2(vz, vx));
  const crLen = Math.sqrt(crx * crx + cry * cry + crz * crz) || 1;
  crx /= crLen; cry /= crLen; crz /= crLen;

  // Camera "up" axis: cross(right, viewDir)
  const cux = cry * vz - crz * vy;
  const cuy = crz * vx - crx * vz;
  const cuz = crx * vy - cry * vx;

  // Perpendicular offset of point from camera direction
  const offX = px - cosDot * vx;
  const offY = py - cosDot * vy;
  const offZ = pz - cosDot * vz;
  const offLen = Math.sqrt(offX * offX + offY * offY + offZ * offZ) || 1;

  // Project offset onto screen axes
  const screenDirR = (offX * crx + offY * cry + offZ * crz) / offLen;
  const screenDirU = (offX * cux + offY * cuy + offZ * cuz) / offLen;

  const sx = sw / 2 + screenDirR * screenR;
  const sy = sh / 2 - screenDirU * screenR; // Y-flip (screen Y grows downward)

  // Allow a generous clamp — dots just off-screen are still trackable
  if (sx < -60 || sx > sw + 60 || sy < -60 || sy > sh + 60) return null;

  return { id: pt.id, sx, sy };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFootEraser(enabled: boolean): FootEraserState {
  const [remaining, setRemaining] = useState<EraserPoint[]>(() => buildHemisphere(TOTAL));
  const remainingRef = useRef<EraserPoint[]>(remaining);
  const consumedRef = useRef<Set<number>>(new Set());

  const totalConsumed = TOTAL - remaining.length;
  const progress = Math.round((totalConsumed / TOTAL) * 100);
  const isComplete = remaining.length === 0;

  useEffect(() => { remainingRef.current = remaining; }, [remaining]);

  /**
   * Called every animation frame from FootEraserCanvas.
   * Returns { live: dots to draw, consumed: dots erased this frame }.
   * Mutates consumedRef synchronously; schedules React state update
   * asynchronously (batched) so it never blocks the RAF.
   */
  const tick = useCallback(
    (tilt: ScanFrameTilt, screenW: number, screenH: number): TickResult => {
      if (!enabled || screenW === 0 || screenH === 0) return { live: [], consumed: [] };

      const viewDir = getCamViewDir(tilt);
      const cx = screenW / 2;
      const cy = screenH / 2;
      const r2 = ERASER_RADIUS_PX * ERASER_RADIUS_PX;

      const live: ProjectedDot[] = [];
      const consumed: ProjectedDot[] = [];

      for (const pt of remainingRef.current) {
        const dot = projectPoint(pt, viewDir, screenW, screenH);
        if (!dot) continue;

        const dx = dot.sx - cx;
        const dy = dot.sy - cy;
        if (dx * dx + dy * dy <= r2) {
          if (!consumedRef.current.has(pt.id)) {
            consumedRef.current.add(pt.id);
            consumed.push(dot);
          }
        } else {
          live.push(dot);
        }
      }

      if (consumed.length > 0) {
        try { window.navigator.vibrate?.(10); } catch { /* ignore */ }
        const updated = remainingRef.current.filter((p) => !consumedRef.current.has(p.id));
        remainingRef.current = updated;
        setRemaining(updated);
      }

      return { live, consumed };
    },
    [enabled],
  );

  const reset = useCallback(() => {
    const pts = buildHemisphere(TOTAL);
    remainingRef.current = pts;
    consumedRef.current.clear();
    setRemaining(pts);
  }, []);

  // Auto-reset when scanner goes inactive
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  return { remaining, tick, progress, isComplete, totalConsumed, reset };
}
