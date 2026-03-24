/**
 * Parametric foot model — type definitions.
 *
 * All length units in normalised world space (≈ 1 = adult male foot length).
 * Millimetre values are converted from scan measurements before building the model.
 */

// ─── Discrete parameter enums ────────────────────────────────────────────────

/** Arch height category */
export type ArchHeight = "low" | "medium" | "high";

/** Overall volume / width category */
export type FootVolume = "slim" | "normal" | "wide";

/** Toe shape (longest-toe classification) */
export type ToeShape = "egyptian" | "roman" | "greek";

// ─── Main parameter set ───────────────────────────────────────────────────────

/**
 * All parameters that drive the procedural foot mesh.
 *
 * Continuous scales are relative multipliers around a neutral baseline (1.0).
 * Valid ranges are documented inline.
 */
export type FootParameters = {
  /** Overall foot length scale — 0.70 … 1.30 */
  lengthScale: number;

  /** Forefoot width scale — 0.70 … 1.30 */
  widthScale: number;

  /** Dorsal height scale (instep prominence) — 0.70 … 1.30 */
  heightScale: number;

  /** Arch height: low flat arch → high pronounced arch */
  archHeight: ArchHeight;

  /** Foot volume: slim narrow → wide broad */
  footVolume: FootVolume;

  /** Heel width scale — 0.70 … 1.30 */
  heelWidth: number;

  /** Toe shape type */
  toeShape: ToeShape;
};

export const DEFAULT_FOOT_PARAMETERS: FootParameters = {
  lengthScale: 1.0,
  widthScale: 1.0,
  heightScale: 1.0,
  archHeight: "medium",
  footVolume: "normal",
  heelWidth: 1.0,
  toeShape: "egyptian",
};

// ─── Scan measurements that drive parameter extraction ────────────────────────

/**
 * Physical measurements (mm) extracted from scan data.
 * Not every field is mandatory; missing values fall back to population averages.
 */
export type ScanMeasurements = {
  /** Total foot length heel-to-hallux tip (mm) */
  footLengthMm?: number;

  /** Forefoot width at the metatarsal heads (mm) */
  forefootWidthMm?: number;

  /** Foot height at the instep (mm) */
  instepHeightMm?: number;

  /** Heel width (mm) */
  heelWidthMm?: number;

  /** Arch height estimated from lateral contour or point cloud (mm) */
  archHeightMm?: number;

  /** Ball girth (mm) */
  ballGirthMm?: number;
};

// ─── Internal blob descriptor for MarchingCubes ──────────────────────────────

/** One metaball contribution in normalised [0,1]³ space. */
export type FootBlob = {
  /** Position in [0,1] × [0,1] × [0,1] (grid-normalised after bounding-box padding) */
  x: number;
  y: number;
  z: number;
  /** Metaball strength (larger = broader influence) */
  strength: number;
  /** Subtract parameter for MarchingCubes.addBall */
  subtract: number;
};

// ─── Build output ─────────────────────────────────────────────────────────────

import type * as THREE from "three";

/** Result returned by buildParametricFootGeometry */
export type ParametricFootResult = {
  geometry: THREE.BufferGeometry;
  /** Parameters that were used to build this geometry */
  parameters: FootParameters;
};
