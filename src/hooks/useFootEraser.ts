/**
 * useFootEraser — "Eraser" UX for foot scan.
 *
 * Public API surface:
 *   generateGoldenSpiralDome(pointsCount, radius) — pure function, exported.
 *   useFootEraser(enabled) — React hook; returns remainingPoints with live
 *     per-point status, tick() for RAF integration, and progress helpers.
 *
 * Point status lifecycle:
 *   'idle'     — point is on-screen but not near the eraser.
 *   'scanning' — point has drifted into the outer proximity ring (90 px).
 *   'done'     — point was consumed (inside 50 px zone) and removed from
 *                remainingPoints; its screen position is returned in
 *                TickResult.consumed for the canvas fade animation.
 *
 * Coordinate system:
 *   Origin = centre of the ArUco A4 sheet (foot reference centre).
 *   Y-up (vertical), X-right, Z-forward. All coordinates in metres.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanFrameTilt } from "./useScanFrameOrientation";

// ─── Public types ────────────────────────────────────────────────────────────

export type DomePointStatus = "idle" | "scanning" | "done";

/**
 * Hemisphere sector classification.
 *
 * The dome is divided into three roughly equal sectors (~50 points each with
 * the default 150-point dome):
 *
 *   'top'   — points with sin(elevation) > 0.65  (elevation > ~41°).
 *             Camera looks steeply downward → top-of-foot coverage.
 *   'left'  — low-elevation points with wz < 0.
 *             Camera views from the lateral / heel side of the foot.
 *   'right' — low-elevation points with wz ≥ 0.
 *             Camera views from the medial / arch side of the foot.
 *
 * The Z axis is the short axis of the A4 sheet (= foot-width direction).
 * The foot is assumed to lie lengthwise along the long (X) axis.
 */
export type DomeSector = "top" | "left" | "right";

export interface EraserPoint {
  /** Unique index 0…(N-1). */
  id: number;
  /** World-space X (metres) — right relative to ArUco sheet centre. */
  wx: number;
  /** World-space Y (metres) — up (vertical above sheet). */
  wy: number;
  /** World-space Z (metres) — forward relative to ArUco sheet centre. */
  wz: number;
  /**
   * Current lifecycle state.
   * React state only ever holds 'idle' | 'scanning'; a 'done' point is
   * removed from `remainingPoints` immediately and its screen coords are
   * forwarded to the canvas for a 200 ms fade-out animation.
   */
  status: DomePointStatus;
  /** Hemisphere sector this point belongs to (set once at generation time). */
  sector: DomeSector;
}

/**
 * Per-sector capture statistics, updated on every React render.
 * Used to gate the completion condition and drive guidance messages.
 */
export interface SectorStats {
  /** Total points initially generated in this sector. */
  count: number;
  /** Points consumed (status: 'done') so far. */
  consumed: number;
  /** Fraction consumed, 0.0 → 1.0. */
  pct: number;
}

export interface SectorProgress {
  top:   SectorStats;
  left:  SectorStats;
  right: SectorStats;
}

export interface ProjectedDot {
  id: number;
  sx: number;           // screen X (px)
  sy: number;           // screen Y (px)
  status: DomePointStatus;
}

export interface TickResult {
  /** Still-remaining projected dots (idle + scanning), coloured by status. */
  live: ProjectedDot[];
  /** Dots consumed THIS frame — pass to canvas for the death animation. */
  consumed: ProjectedDot[];
}

export interface FootEraserState {
  /** React state: all remaining (not yet done) points with current status. */
  remainingPoints: EraserPoint[];
  /**
   * Tilt-based tick: use when ArUco tracking is unavailable.
   * Projects via device orientation and erases dots near screen centre.
   */
  tick: (tilt: ScanFrameTilt, screenW: number, screenH: number) => TickResult;
  /**
   * ArUco-based consume: called by FootEraserCanvas after cv.projectPoints
   * projection detects which dots fall inside the eraser zones.
   * @param doneIds     IDs to mark 'done' and remove from remainingPoints.
   * @param scanningIds (optional) IDs currently in the outer scanning ring.
   */
  consume: (doneIds: number[], scanningIds?: number[]) => void;
  /** 0–100 integer overall percentage (drives the ring fill). */
  progress: number;
  /**
   * Per-sector capture statistics.
   * Updated each render; used to gate completion and drive guidance hints.
   */
  sectorProgress: SectorProgress;
  /**
   * True when every sector has reached SECTOR_MIN_PCT (80%) consumed.
   * The ring shows "✓ Completo" only when this is true.
   */
  isComplete: boolean;
  totalConsumed: number;
  reset: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_COUNT = 150;
const DEFAULT_RADIUS_M = 0.25;

/** Inner zone: points here are immediately consumed ('done'). */
const DONE_RADIUS_PX = 50;
/** Outer zone: points here get 'scanning' status (visual warm-up). */
const SCAN_RADIUS_PX = 90;

const MAX_TILT_X_DEG = 22;
const MAX_TILT_Z_DEG = 28;
const MAX_PHI_DEG = 75;

/**
 * Minimum fraction of points in each sector that must be consumed before
 * `isComplete` becomes true.  Setting to 0.80 means the user must cover at
 * least 80 % of the top, left, and right views — ensuring the 3D point cloud
 * has full lateral coverage even if the user lingers on a single angle.
 */
const SECTOR_MIN_PCT = 0.80;

// ─── Pure utilities ───────────────────────────────────────────────────────────

/**
 * Classify a dome point into one of the three scan sectors based on its
 * hemisphere position.
 *
 * Threshold: sin(elevation) = wy / r
 *   wy/r > 0.65  (elevation ≈ 40.5°) → 'top'     (~35 % of hemisphere area)
 *   wy/r ≤ 0.65, wz < 0              → 'left'    (~32.5 % each side)
 *   wy/r ≤ 0.65, wz ≥ 0              → 'right'
 *
 * With 150 Vogel points the threshold gives ≈ 50 / 50 / 50 per sector.
 */
function getSector(wx: number, wy: number, wz: number): DomeSector {
  void wx; // wx intentionally unused — sector split is along the Z axis only
  const r = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (r < 1e-9) return "top";
  const sinEl = wy / r; // sin(elevation above horizontal)
  if (sinEl > 0.65) return "top";
  return wz < 0 ? "left" : "right";
}

function deg2rad(d: number) { return (d * Math.PI) / 180; }

/**
 * generateGoldenSpiralDome — Vogel / golden-spiral hemisphere distribution.
 *
 * Uses the sunflower-seed formula:
 *   azimuth  θ = i × φ_golden         (where φ_golden ≈ 137.508°)
 *   elevation y = 1 − i / (N − 0.5)   (uniform in solid angle)
 *
 * This is mathematically optimal for sphere packing — the same pattern
 * used by sunflower seeds, pine cones, and the Fibonacci lattice.
 *
 * @param pointsCount  Number of points to generate (default 150).
 * @param radius       Hemisphere radius in metres (default 0.25 = 25 cm).
 *
 * Coordinates are relative to the ArUco sheet centre (foot reference origin):
 *   Y = up (vertical),  X = right,  Z = forward.
 * All points have Y ≥ 0 (upper hemisphere only).
 */
export function generateGoldenSpiralDome(
  pointsCount: number = DEFAULT_COUNT,
  radius: number = DEFAULT_RADIUS_M,
): EraserPoint[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.399 rad ≈ 137.508°
  const pts: EraserPoint[] = [];

  for (let i = 0; i < pointsCount; i++) {
    // y ∈ (1, ~0]: linear in cos(polar angle) → uniform surface density
    const y = 1 - i / (pointsCount - 0.5);
    const sinPhi = Math.sqrt(Math.max(0, 1 - y * y)); // sin of polar angle
    const theta = goldenAngle * i;                     // azimuthal angle

    const wx = Math.cos(theta) * sinPhi * radius;
    const wy = Math.max(0, y) * radius;
    const wz = Math.sin(theta) * sinPhi * radius;
    pts.push({
      id: i,
      wx,
      wy,
      wz,
      status: "idle",
      sector: getSector(wx, wy, wz),
    });
  }

  return pts;
}

// ─── Private projection helpers ───────────────────────────────────────────────

/**
 * Map device tilt → unit-vector on the hemisphere the camera is "pointing at".
 *
 * useScanFrameOrientation convention:
 *   rotateX = (beta − 90) × k  → forward/back tilt from portrait-vertical
 *   rotateZ = gamma × k        → left/right roll
 *
 * No tilt (0, 0) → phone level → camera faces straight down → Y = 1 (top).
 */
function getCamViewDir(tilt: ScanFrameTilt): [number, number, number] {
  const maxPhi = deg2rad(MAX_PHI_DEG);
  const fx = (tilt.rotateX / MAX_TILT_X_DEG) * Math.sin(maxPhi); // forward → +Z
  const fz = (tilt.rotateZ / MAX_TILT_Z_DEG) * Math.sin(maxPhi); // right   → +X
  const fy = Math.sqrt(Math.max(0, 1 - fx * fx - fz * fz));       // always up
  const len = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  return [fz / len, fy / len, fx / len]; // [X, Y, Z]
}

/**
 * Equidistant spherical projection centred on the camera direction.
 * The point directly "in front of" the camera projects to screen centre.
 */
function projectPoint(
  pt: EraserPoint,
  viewDir: [number, number, number],
  sw: number,
  sh: number,
): { sx: number; sy: number } | null {
  const r = Math.sqrt(pt.wx * pt.wx + pt.wy * pt.wy + pt.wz * pt.wz) || 1;
  const px = pt.wx / r, py = pt.wy / r, pz = pt.wz / r;

  const cosDot = px * viewDir[0] + py * viewDir[1] + pz * viewDir[2];
  if (cosDot < 0.04) return null; // behind camera / far horizon

  const angOff  = Math.acos(Math.min(1, cosDot));
  const focal   = sw / (2 * Math.tan(deg2rad(30))); // ~60° FOV
  const screenR = Math.tan(angOff) * focal;

  const [vx, vy, vz] = viewDir;

  // Camera right: perpendicular to viewDir in the xz-plane
  let crx = -Math.sin(Math.atan2(vz, vx)), cry = 0, crz = Math.cos(Math.atan2(vz, vx));
  const crLen = Math.sqrt(crx * crx + crz * crz) || 1;
  crx /= crLen; crz /= crLen;

  // Camera up: cross(right, viewDir)
  const cux = cry * vz - crz * vy;
  const cuy = crz * vx - crx * vz;
  const cuz = crx * vy - cry * vx;

  const offX = px - cosDot * vx;
  const offY = py - cosDot * vy;
  const offZ = pz - cosDot * vz;
  const offLen = Math.sqrt(offX * offX + offY * offY + offZ * offZ) || 1;

  const sR = (offX * crx + offY * cry + offZ * crz) / offLen;
  const sU = (offX * cux + offY * cuy + offZ * cuz) / offLen;

  const sx = sw / 2 + sR * screenR;
  const sy = sh / 2 - sU * screenR; // Y-flip

  if (sx < -80 || sx > sw + 80 || sy < -80 || sy > sh + 80) return null;

  return { sx, sy };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/** Helper: compute sector totals from a fresh dome array. */
function computeSectorTotals(pts: EraserPoint[]): Record<DomeSector, number> {
  const t: Record<DomeSector, number> = { top: 0, left: 0, right: 0 };
  for (const p of pts) t[p.sector]++;
  return t;
}

export function useFootEraser(enabled: boolean): FootEraserState {
  const [remainingPoints, setRemainingPoints] = useState<EraserPoint[]>(() =>
    generateGoldenSpiralDome(DEFAULT_COUNT, DEFAULT_RADIUS_M),
  );

  // Fast mutable refs — avoid stale closures in the RAF tick function
  const pointsRef    = useRef<EraserPoint[]>(remainingPoints);
  const consumedRef  = useRef<Set<number>>(new Set());
  /** IDs currently in 'scanning' state (previous frame's snapshot). */
  const prevScanRef  = useRef<Set<number>>(new Set());
  /**
   * Total points per sector — computed once at dome generation and updated on
   * reset().  Used to derive sector consumed count = total − remaining.
   */
  const sectorTotalsRef = useRef<Record<DomeSector, number>>(
    computeSectorTotals(remainingPoints),
  );

  useEffect(() => { pointsRef.current = remainingPoints; }, [remainingPoints]);

  const totalConsumed = DEFAULT_COUNT - remainingPoints.length;
  const progress      = Math.round((totalConsumed / DEFAULT_COUNT) * 100);

  // ── Sector progress ──────────────────────────────────────────────────────
  // Count remaining points per sector from React state; consumed = total − remaining.
  const sectorRemaining: Record<DomeSector, number> = { top: 0, left: 0, right: 0 };
  for (const p of remainingPoints) sectorRemaining[p.sector]++;

  const totals = sectorTotalsRef.current;
  const mkStats = (s: DomeSector): SectorStats => {
    const count    = totals[s];
    const consumed = count - sectorRemaining[s];
    return { count, consumed, pct: count > 0 ? consumed / count : 0 };
  };
  const sectorProgress: SectorProgress = {
    top:   mkStats("top"),
    left:  mkStats("left"),
    right: mkStats("right"),
  };

  /**
   * isComplete fires only when every sector has reached SECTOR_MIN_PCT.
   * This ensures the 3D point cloud has adequate lateral coverage — not just
   * a top-down view — before triggering the "Scansione Completata" overlay.
   */
  const isComplete =
    sectorProgress.top.pct   >= SECTOR_MIN_PCT &&
    sectorProgress.left.pct  >= SECTOR_MIN_PCT &&
    sectorProgress.right.pct >= SECTOR_MIN_PCT;

  /**
   * tick() — called every animation frame by FootEraserCanvas.
   *
   * Performance contract:
   *  • Never calls setRemainingPoints unless (a) at least one point is newly
   *    consumed OR (b) the set of 'scanning' IDs has changed since last call.
   *  • All other per-frame work is purely mutable (no React overhead).
   */
  const tick = useCallback(
    (tilt: ScanFrameTilt, screenW: number, screenH: number): TickResult => {
      if (!enabled || screenW === 0 || screenH === 0) {
        return { live: [], consumed: [] };
      }

      const viewDir = getCamViewDir(tilt);
      const cx = screenW / 2, cy = screenH / 2;
      const doneR2 = DONE_RADIUS_PX * DONE_RADIUS_PX;
      const scanR2 = SCAN_RADIUS_PX * SCAN_RADIUS_PX;

      const live: ProjectedDot[]     = [];
      const consumed: ProjectedDot[] = [];
      const currentScanIds           = new Set<number>();
      const newlyConsumedIds: number[]= [];

      for (const pt of pointsRef.current) {
        const proj = projectPoint(pt, viewDir, screenW, screenH);
        if (!proj) continue;

        const { sx, sy } = proj;
        const d2 = (sx - cx) ** 2 + (sy - cy) ** 2;

        if (d2 <= doneR2) {
          // ── Done: mark for consumption
          if (!consumedRef.current.has(pt.id)) {
            consumedRef.current.add(pt.id);
            newlyConsumedIds.push(pt.id);
            consumed.push({ id: pt.id, sx, sy, status: "done" });
          }
        } else if (d2 <= scanR2) {
          // ── Scanning proximity
          currentScanIds.add(pt.id);
          live.push({ id: pt.id, sx, sy, status: "scanning" });
        } else {
          // ── Idle
          live.push({ id: pt.id, sx, sy, status: "idle" });
        }
      }

      // Check whether the scanning set has actually changed
      const prevScan  = prevScanRef.current;
      let scanChanged =
        currentScanIds.size !== prevScan.size ||
        [...currentScanIds].some((id) => !prevScan.has(id));

      if (newlyConsumedIds.length > 0 || scanChanged) {
        prevScanRef.current = currentScanIds;

        setRemainingPoints((prev) => {
          const next = prev
            .filter((p) => !consumedRef.current.has(p.id))
            .map((p) => ({
              ...p,
              status: currentScanIds.has(p.id)
                ? ("scanning" as DomePointStatus)
                : ("idle" as DomePointStatus),
            }));
          pointsRef.current = next;
          return next;
        });
      }

      if (newlyConsumedIds.length > 0) {
        try { window.navigator.vibrate?.(10); } catch { /* ignore */ }
      }

      return { live, consumed };
    },
    [enabled],
  );

  /**
   * consume() — called by FootEraserCanvas when ArUco-based projectPoints
   * has already determined which dome points fall inside the eraser zones.
   * Bypasses the tilt-based tick() projection entirely.
   */
  const consume = useCallback(
    (doneIds: number[], scanningIds: number[] = []) => {
      if (doneIds.length === 0 && scanningIds.length === 0) return;

      // Filter out IDs already consumed to avoid duplicate haptics
      const newlyDone = doneIds.filter((id) => !consumedRef.current.has(id));
      if (newlyDone.length > 0) {
        for (const id of newlyDone) consumedRef.current.add(id);
        try { window.navigator.vibrate?.(10); } catch { /* ignore */ }
      }

      const scanSet = new Set(scanningIds);
      const scanChanged =
        scanSet.size !== prevScanRef.current.size ||
        [...scanSet].some((id) => !prevScanRef.current.has(id));

      if (newlyDone.length > 0 || scanChanged) {
        prevScanRef.current = scanSet;
        setRemainingPoints((prev) => {
          const next = prev
            .filter((p) => !consumedRef.current.has(p.id))
            .map((p) => ({
              ...p,
              status: scanSet.has(p.id)
                ? ("scanning" as DomePointStatus)
                : ("idle" as DomePointStatus),
            }));
          pointsRef.current = next;
          return next;
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    const pts = generateGoldenSpiralDome(DEFAULT_COUNT, DEFAULT_RADIUS_M);
    pointsRef.current        = pts;
    prevScanRef.current      = new Set();
    consumedRef.current.clear();
    sectorTotalsRef.current  = computeSectorTotals(pts);
    setRemainingPoints(pts);
  }, []);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  return { remainingPoints, tick, consume, progress, sectorProgress, isComplete, totalConsumed, reset };
}
