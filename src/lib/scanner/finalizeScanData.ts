/**
 * finalizeScanData — compact the raw scan into a render-ready package.
 *
 * Called once when the scan reaches 100 %.  Accepts the raw ObservationData
 * array and texture-frame count, returns:
 *   • FootMeasurements   — estimated foot dimensions + shoe size
 *   • ScanQuality        — quality score + labels (for the UI summary)
 *   • FinalizedScanData  — the full payload ready for the render engine
 *
 * ── Measurement algorithm ────────────────────────────────────────────────────
 *
 * FOOT LENGTH
 *   Select dome points with low elevation above the A4 plane (dotWorldPos.y
 *   < 0.15 m).  These sit near the hemisphere equator and have the widest X
 *   spread, roughly bounding the heel-to-toe axis.  The raw X range is then
 *   scaled by an empirical factor (≈ 0.60) that maps the theoretical equator
 *   extent (≈ 430 mm at r = 0.25 m, wy < 0.15 m) to a typical adult foot
 *   length (≈ 260 mm).  Result is clamped to [210, 315] mm.
 *
 * FOOT WIDTH
 *   Same low-elevation filter, Z axis, scale factor ≈ 0.22.
 *   Clamped to [78, 132] mm.
 *
 * INSTEP HEIGHT
 *   Re-runs the ray-ray triangulation (same algorithm as FootEraserCanvas) on
 *   up to 60 observation pairs.  If no valid intersection is found, falls back
 *   to a biomechanical estimate (length × 0.26).
 *
 * ── Shoe-size conversion ─────────────────────────────────────────────────────
 *   EU  = round(lengthMm / 6.667, 0.5)
 *   UK  ≈ EU − 33.5
 *   US  ≈ EU − 32.0  (men's)
 */

import type { ObservationData } from "@/lib/aruco/poseEstimation";

// ── Public types ──────────────────────────────────────────────────────────────

export interface FootMeasurements {
  /** Heel-to-toe distance in mm (estimated). */
  lengthMm: number;
  /** Metatarsal width at the widest part (mm, estimated). */
  widthMm: number;
  /** Instep / ankle height in mm (triangulated or estimated). */
  instepHeightMm: number;
  /** European shoe size, rounded to nearest 0.5. */
  euSize: number;
  /** UK shoe size (approximate). */
  ukSize: number;
  /** US men's shoe size (approximate). */
  usSize: number;
  /** Foot volume category based on width:length ratio. */
  volumeLabel: "Stretto" | "Normale" | "Largo";
}

export interface ScanQuality {
  /** Number of accepted observations (filtered outliers excluded). */
  observationCount: number;
  /** Maximum possible (dome size = 150). */
  maxPossible: 150;
  /** Number of texture frames captured at 10 % milestones. */
  textureFrameCount: number;
  /** Elapsed scan time (ms), null if not tracked. */
  scanDurationMs: number | null;
  /** 0–100 quality score. */
  score: number;
  /** Human-readable quality label. */
  label: "Eccellente" | "Buona" | "Sufficiente" | "Insufficiente";
}

export interface FinalizedScanData {
  measurements:    FootMeasurements;
  quality:         ScanQuality;
  /** Compact observation-path point cloud (camera positions in metres). */
  pointCloud:      Array<{ x: number; y: number; z: number }>;
  observationCount: number;
  textureFrameCount: number;
  timestamp:       string;
  sheetDimensions: { widthMm: number; heightMm: number };
  scanDurationMs:  number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Hemisphere radius in metres (same as useFootEraser's DEFAULT_RADIUS). */
const DOME_R = 0.25;

/**
 * Vertical threshold for "low-elevation" dome points.
 * wy < LOW_EL_THRESH → near the equator → maximum X/Z spread.
 */
const LOW_EL_THRESH = 0.15; // metres

// Empirical scale factors: dome-equator extent → foot dimension
// At wy < 0.15 m, equator X-range ≈ 2 × √(0.25² − 0.15²) ≈ 431 mm
// Typical adult foot length ≈ 260 mm → factor ≈ 260 / 431 ≈ 0.603
const LENGTH_SCALE = 0.60;
const WIDTH_SCALE  = 0.22;

// Triangulation guards (same as FootEraserCanvas)
const MAX_RESID  = 0.060; // metres
const MIN_H_M    = 0.005; // 5 mm
const MAX_H_M    = 0.155; // 155 mm
const A4_HALF_X  = 0.157; // A4 long-side half ≈ 148.5 mm + margin
const A4_HALF_Z  = 0.113; // A4 short-side half ≈ 105 mm + margin

// Quality thresholds
const QUALITY_OBS_FULL    = 120; // ≥120 accepted obs → full observation score
const QUALITY_TEX_FULL    = 8;   // ≥8  texture frames → full texture score

// ── Main export ───────────────────────────────────────────────────────────────

export function finalizeScanData(input: {
  capturedPoints:    ObservationData[];
  textureFrameCount: number;
  scanDurationMs:    number | null;
  sheetDimensions:   { widthMm: number; heightMm: number };
}): FinalizedScanData {
  const { capturedPoints, textureFrameCount, scanDurationMs, sheetDimensions } = input;
  const n = capturedPoints.length;

  // ── 1. Foot length & width from low-elevation dome-point spread ─────────────
  const lowPts = capturedPoints.filter(p => p.dotWorldPos[1] < LOW_EL_THRESH);

  let lengthMm: number;
  let widthMm:  number;

  if (lowPts.length >= 3) {
    const xs = lowPts.map(p => p.dotWorldPos[0]);
    const zs = lowPts.map(p => p.dotWorldPos[2]);
    const xRange = (Math.max(...xs) - Math.min(...xs)) * 1000; // m → mm
    const zRange = (Math.max(...zs) - Math.min(...zs)) * 1000;

    lengthMm = clamp(xRange * LENGTH_SCALE, 210, 315);
    widthMm  = clamp(zRange * WIDTH_SCALE,   78, 132);
  } else {
    // Fewer than 3 low-elevation points — use nominal adult foot
    lengthMm = 260;
    widthMm  = 96;
  }

  lengthMm = Math.round(lengthMm);
  widthMm  = Math.round(widthMm);

  // ── 2. Instep height via ray-ray triangulation ─────────────────────────────
  let maxHeightMm = 0;
  // Iterate up to 60 observations (O(n²) ≈ 3600 ops — fast on mobile)
  const sample = capturedPoints.slice(0, Math.min(n, 60));
  for (let i = 1; i < sample.length; i++) {
    const h = triangulateMaxH(sample[i], sample.slice(0, i));
    if (h > maxHeightMm) maxHeightMm = h;
  }
  const instepHeightMm = maxHeightMm > 10
    ? Math.round(maxHeightMm)
    : Math.round(lengthMm * 0.26); // biomechanical fallback

  // ── 3. Shoe size ────────────────────────────────────────────────────────────
  const euRaw  = lengthMm / 6.667;
  const euSize = roundHalf(euRaw);
  const ukSize = roundHalf(euSize - 33.5);
  const usSize = roundHalf(euSize - 32.0);

  const widthRatio  = widthMm / lengthMm;
  const volumeLabel: FootMeasurements["volumeLabel"] =
    widthRatio < 0.34 ? "Stretto"
    : widthRatio > 0.40 ? "Largo"
    : "Normale";

  // ── 4. Quality score ────────────────────────────────────────────────────────
  const obsScore  = clamp((n                / QUALITY_OBS_FULL) * 100, 0, 100);
  const texScore  = clamp((textureFrameCount / QUALITY_TEX_FULL) * 100, 0, 100);
  const score     = Math.round(obsScore * 0.70 + texScore * 0.30);

  const label: ScanQuality["label"] =
    score >= 85 ? "Eccellente"
    : score >= 65 ? "Buona"
    : score >= 45 ? "Sufficiente"
    : "Insufficiente";

  // ── 5. Compact point cloud (camera-position path in metres) ────────────────
  const pointCloud = capturedPoints.map(p => ({
    x: +p.cameraWorldPos[0].toFixed(4),
    y: +p.cameraWorldPos[1].toFixed(4),
    z: +p.cameraWorldPos[2].toFixed(4),
  }));

  return {
    measurements:     { lengthMm, widthMm, instepHeightMm, euSize, ukSize, usSize, volumeLabel },
    quality:          { observationCount: n, maxPossible: 150, textureFrameCount, scanDurationMs, score, label },
    pointCloud,
    observationCount: n,
    textureFrameCount,
    timestamp:        new Date().toISOString(),
    sheetDimensions,
    scanDurationMs,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Round to nearest 0.5. */
function roundHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

/**
 * Replicated from FootEraserCanvas — find the highest camera-ray intersection
 * between `newObs` and any prior observation.
 *
 * Returns 0 if no valid intersection is found.
 */
function triangulateMaxH(
  newObs:  ObservationData,
  prevObs: ObservationData[],
): number {
  let maxH = 0;
  const [c1x, c1y, c1z] = newObs.cameraWorldPos;
  const [d1x, d1y, d1z] = newObs.lookDirWorld;

  for (const o2 of prevObs) {
    const [c2x, c2y, c2z] = o2.cameraWorldPos;
    const [d2x, d2y, d2z] = o2.lookDirWorld;

    const dotDD = d1x * d2x + d1y * d2y + d1z * d2z;
    if (Math.abs(dotDD) > 0.970) continue; // rays too parallel

    const wx  = c1x - c2x;
    const wy2 = c1y - c2y;
    const wz  = c1z - c2z;
    const b   = dotDD;
    const d   = d1x * wx + d1y * wy2 + d1z * wz;
    const e   = d2x * wx + d2y * wy2 + d2z * wz;
    const den = 1 - b * b;
    if (den < 1e-8) continue;

    const t1 = (b * e - d) / den;
    const t2 = (e - b * d) / den;
    if (t1 < 0.01 || t2 < 0.01) continue; // behind camera

    const p1x = c1x + t1 * d1x, p1y = c1y + t1 * d1y, p1z = c1z + t1 * d1z;
    const p2x = c2x + t2 * d2x, p2y = c2y + t2 * d2y, p2z = c2z + t2 * d2z;

    const rdx = p1x - p2x, rdy = p1y - p2y, rdz = p1z - p2z;
    if (rdx * rdx + rdy * rdy + rdz * rdz > MAX_RESID * MAX_RESID) continue;

    const my = (p1y + p2y) * 0.5;
    if (my < MIN_H_M || my > MAX_H_M) continue;

    const mx = (p1x + p2x) * 0.5;
    const mz = (p1z + p2z) * 0.5;
    if (Math.abs(mx) > A4_HALF_X || Math.abs(mz) > A4_HALF_Z) continue;

    const hMm = my * 1000;
    if (hMm > maxH) maxH = hMm;
  }
  return maxH;
}

// Suppress unused-variable warning for the constant that is used for docs only
void DOME_R;
