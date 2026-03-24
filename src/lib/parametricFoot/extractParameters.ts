/**
 * Derives FootParameters from physical scan measurements.
 *
 * Uses population reference values for a European adult foot to map raw mm
 * values to normalised scales and discrete categories.
 *
 * Reference averages (European adult, both genders pooled):
 *   Foot length:      262 mm
 *   Forefoot width:    92 mm
 *   Instep height:     68 mm
 *   Heel width:        65 mm
 *   Arch height:       16 mm  (navicular drop proxy)
 *   Ball girth:       245 mm
 *
 * All scales are clamped to [0.70, 1.30] to prevent extreme deformations.
 */

import {
  DEFAULT_FOOT_PARAMETERS,
  type ArchHeight,
  type FootParameters,
  type FootVolume,
  type ScanMeasurements,
  type ToeShape,
} from "./types";

// ─── Population reference values ─────────────────────────────────────────────

const REF = {
  footLengthMm:      262,
  forefootWidthMm:    92,
  instepHeightMm:     68,
  heelWidthMm:        65,
  archHeightMm:       16,
  ballGirthMm:       245,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampScale(v: number): number {
  return Math.max(0.70, Math.min(1.30, v));
}

function scaleFrom(measured: number | undefined, reference: number): number {
  if (measured === undefined || measured <= 0) return 1.0;
  return clampScale(measured / reference);
}

// ─── Discrete category classifiers ───────────────────────────────────────────

function classifyArchHeight(archMm?: number): ArchHeight {
  if (archMm === undefined) return DEFAULT_FOOT_PARAMETERS.archHeight;
  if (archMm < 10)  return "low";
  if (archMm > 22)  return "high";
  return "medium";
}

function classifyFootVolume(
  forefootWidthMm?: number,
  ballGirthMm?: number,
  footLengthMm?: number
): FootVolume {
  // Use width-to-length ratio as the primary discriminant; fall back on ball girth
  if (forefootWidthMm !== undefined && footLengthMm !== undefined && footLengthMm > 0) {
    const ratio = forefootWidthMm / footLengthMm;
    // Typical range: slim ≈ 0.32–0.34, normal ≈ 0.34–0.37, wide ≈ 0.37–0.40
    if (ratio < 0.335) return "slim";
    if (ratio > 0.375) return "wide";
    return "normal";
  }
  if (ballGirthMm !== undefined) {
    const gr = ballGirthMm / REF.ballGirthMm;
    if (gr < 0.96) return "slim";
    if (gr > 1.04) return "wide";
  }
  return DEFAULT_FOOT_PARAMETERS.footVolume;
}

/**
 * Toe shape cannot currently be measured automatically from the available scan
 * outputs, so we return the default (egyptian) unless the caller overrides it.
 * Future integration with a contour-keypoint analysis could improve this.
 */
function classifyToeShape(_measurements: ScanMeasurements): ToeShape {
  return DEFAULT_FOOT_PARAMETERS.toeShape;
}

// ─── Main extraction function ─────────────────────────────────────────────────

/**
 * Maps raw scan measurements to FootParameters.
 *
 * Any measurement that is absent or zero falls back to the population average,
 * resulting in a scale of 1.0 for that dimension.
 *
 * @param measurements  Physical measurements extracted from scan data
 * @param overrides     Optional manual overrides (e.g. toeShape from user selection)
 */
export function extractFootParameters(
  measurements: ScanMeasurements,
  overrides?: Partial<FootParameters>
): FootParameters {
  const lengthScale  = scaleFrom(measurements.footLengthMm,    REF.footLengthMm);
  const widthScale   = scaleFrom(measurements.forefootWidthMm, REF.forefootWidthMm);
  const heightScale  = scaleFrom(measurements.instepHeightMm,  REF.instepHeightMm);
  const heelWidth    = scaleFrom(measurements.heelWidthMm,     REF.heelWidthMm);

  const archHeight   = classifyArchHeight(measurements.archHeightMm);
  const footVolume   = classifyFootVolume(
    measurements.forefootWidthMm,
    measurements.ballGirthMm,
    measurements.footLengthMm
  );
  const toeShape     = classifyToeShape(measurements);

  return {
    lengthScale,
    widthScale,
    heightScale,
    archHeight,
    footVolume,
    heelWidth,
    toeShape,
    ...overrides,
  };
}

/**
 * Converts NeumaBiometry keypoint data to ScanMeasurements.
 *
 * Accepts the exportPayload.points array from a NeumaBiometryResult and derives
 * physical measurements.  Point IDs match NeumaKeypointId values.
 */
export function measurementsFromBiometryPoints(
  points: { id: string; x: number; y: number; z: number; confidence: number }[]
): ScanMeasurements {
  const find = (id: string) => points.find((p) => p.id === id);

  const hallux      = find("hallux_tip");
  const heelCenter  = find("heel_center");
  const metMedial   = find("metatarsal_medial");
  const metLateral  = find("metatarsal_lateral");
  const heelLeft    = find("heel_curve_left");
  const heelRight   = find("heel_curve_right");

  const measurements: ScanMeasurements = {};

  // Foot length: heel_center → hallux_tip
  if (hallux && heelCenter) {
    const dx = hallux.x - heelCenter.x;
    const dy = hallux.y - heelCenter.y;
    measurements.footLengthMm = Math.sqrt(dx * dx + dy * dy);
  }

  // Forefoot width: metatarsal_lateral → metatarsal_medial
  if (metMedial && metLateral) {
    const dx = metMedial.x - metLateral.x;
    const dy = metMedial.y - metLateral.y;
    measurements.forefootWidthMm = Math.sqrt(dx * dx + dy * dy);
  }

  // Heel width: heel_curve_left → heel_curve_right
  if (heelLeft && heelRight) {
    const dx = heelLeft.x - heelRight.x;
    const dy = heelLeft.y - heelRight.y;
    measurements.heelWidthMm = Math.sqrt(dx * dx + dy * dy);
  }

  return measurements;
}
