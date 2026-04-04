/**
 * Plantar arch (arco plantare) — isthmus height from multi-view triangulation.
 *
 * World space: A4 sheet at Y = 0 (suolo di riferimento).  Height = Y del punto
 * sulla superficie stimata (mm sopra il foglio).
 *
 * La "zona istmo" è una fascia medio-piede lato mediale (navicolare / arco
 * longitudinale), dipendente da LEFT / RIGHT per il segno di Z.
 */

import type { ObservationData } from "@/lib/aruco/poseEstimation";
import type { FootId } from "@/types/scan";

// ─── Medial isthmus zone on the sheet plane (XZ, metres) ─────────────────────
// X: da tallone (negativo) verso avampiede — fascia centrale del piede.
const ARCH_X_MIN = -0.095;
const ARCH_X_MAX =  0.035;
// Medial offset from centre (m); placement guide: RIGHT → big toe Z−, LEFT → Z+
const ARCH_MEDIAL_MIN = 0.018;

/**
 * True if (mx, mz) lies in the medial midfoot band (isthmus / arco interno).
 */
export function isInPlantarArchZone(mx: number, mz: number, foot: FootId): boolean {
  if (mx < ARCH_X_MIN || mx > ARCH_X_MAX) return false;
  if (foot === "RIGHT") return mz < -ARCH_MEDIAL_MIN;
  return mz > ARCH_MEDIAL_MIN;
}

// ─── Triangulation (shared filters with FootEraserCanvas height pass) ───────

export interface HeightTriangulationMetrics {
  /** Max height (mm) anywhere valid on the sheet. */
  globalMaxMm: number;
  /** Max height (mm) only inside the medial arch zone. */
  archMaxMm:   number;
}

/**
 * Same ray-ray midpoint logic as the foot height estimator, but tracks both
 * global max and arch-zone max in one pass.
 */
export function triangulateHeightMetrics(
  newObs:  ObservationData,
  prevObs: ObservationData[],
  foot:    FootId,
): HeightTriangulationMetrics {
  const A4_HALF_X  = 0.157;
  const A4_HALF_Z  = 0.113;
  const MIN_H      = 0.002;
  const MAX_H      = 0.155;
  const MAX_RESID  = 0.060;

  let globalMaxMm = 0;
  let archMaxMm   = 0;

  const [c1x, c1y, c1z] = newObs.cameraWorldPos;
  const [d1x, d1y, d1z] = newObs.lookDirWorld;

  for (const o2 of prevObs) {
    const [c2x, c2y, c2z] = o2.cameraWorldPos;
    const [d2x, d2y, d2z] = o2.lookDirWorld;

    const dotDD = d1x * d2x + d1y * d2y + d1z * d2z;
    if (Math.abs(dotDD) > 0.970) continue;

    const wx = c1x - c2x, wy2 = c1y - c2y, wz = c1z - c2z;
    const b   = dotDD;
    const d   = d1x * wx + d1y * wy2 + d1z * wz;
    const e   = d2x * wx + d2y * wy2 + d2z * wz;
    const den = 1 - b * b;
    if (den < 1e-8) continue;

    const t1 = (b * e - d) / den;
    const t2 = (e - b * d) / den;
    if (t1 < 0.01 || t2 < 0.01) continue;

    const p1x = c1x + t1 * d1x, p1y = c1y + t1 * d1y, p1z = c1z + t1 * d1z;
    const p2x = c2x + t2 * d2x, p2y = c2y + t2 * d2y, p2z = c2z + t2 * d2z;

    const rdx = p1x - p2x, rdy = p1y - p2y, rdz = p1z - p2z;
    if (rdx * rdx + rdy * rdy + rdz * rdz > MAX_RESID * MAX_RESID) continue;

    const my = (p1y + p2y) * 0.5;
    if (my < MIN_H || my > MAX_H) continue;

    const mx = (p1x + p2x) * 0.5;
    const mz = (p1z + p2z) * 0.5;
    if (Math.abs(mx) > A4_HALF_X || Math.abs(mz) > A4_HALF_Z) continue;

    const hMm = my * 1000;
    if (hMm > globalMaxMm) globalMaxMm = hMm;
    if (isInPlantarArchZone(mx, mz, foot) && hMm > archMaxMm) archMaxMm = hMm;
  }

  return { globalMaxMm, archMaxMm };
}

// ─── Comfort / TPU support category ───────────────────────────────────────────

export type PlantarArchCategory = "insufficient" | "low" | "neutral" | "high";

export interface PlantarArchUi {
  category: PlantarArchCategory;
  /** Primary line — Apple-style title */
  title:    string;
  /** Secondary line — mm + hint for insole */
  subtitle: string;
}

/**
 * Classify arch from isthmus height (mm above Y=0).  Uses foot length (mm) when
 * available to scale thresholds (ratio ~ navicular height / foot length).
 */
export function categorizePlantarArch(
  archIsthmusMm:   number,
  footLengthMm:    number | null,
): PlantarArchUi {
  if (archIsthmusMm < 4) {
    return {
      category: "insufficient",
      title:    "Arco: in misura…",
      subtitle: "Copri l'arco con la camera",
    };
  }

  let lowTh  = 14;
  let highTh = 32;
  if (footLengthMm != null && footLengthMm >= 200 && footLengthMm <= 320) {
    lowTh  = footLengthMm * 0.11;
    highTh = footLengthMm * 0.24;
  }

  const h = Math.round(archIsthmusMm);

  if (archIsthmusMm < lowTh) {
    return {
      category: "low",
      title:    "Arco Basso (Piatto)",
      subtitle: `${h} mm · più supporto TPU 95A`,
    };
  }
  if (archIsthmusMm > highTh) {
    return {
      category: "high",
      title:    "Arco Alto (Cavo)",
      subtitle: `${h} mm · ammortizzazione`,
    };
  }
  return {
    category: "neutral",
    title:    "Arco Neutro",
    subtitle: `${h} mm · supporto bilanciato`,
  };
}
