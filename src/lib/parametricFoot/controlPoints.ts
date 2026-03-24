/**
 * Generates the array of FootBlob control-points that define the parametric foot shape.
 *
 * The foot is modelled as a set of anatomical regions, each represented by one or
 * more metaballs.  All coordinates are expressed in a normalised [0,1]³ bounding box;
 * the actual world-space stretch is applied later via the mesh builder.
 *
 * Anatomy layout (all in normalised space):
 *   X: 0 = lateral (pinky side), 1 = medial (big-toe side)
 *   Y: 0 = plantar (sole), 1 = dorsal (top)
 *   Z: 0 = heel, 1 = toe tips
 *
 * The neutral baseline was tuned to produce a visually plausible adult foot at
 * MarchingCubes resolution ≈ 46.
 */

import type { FootBlob, FootParameters } from "./types";

// ─── Volume category multipliers ─────────────────────────────────────────────

function volumeWidthMult(vol: FootParameters["footVolume"]): number {
  return vol === "slim" ? 0.84 : vol === "wide" ? 1.16 : 1.0;
}

function volumeHeightMult(vol: FootParameters["footVolume"]): number {
  // Slim feet tend to have less vertical girth; wide feet more
  return vol === "slim" ? 0.93 : vol === "wide" ? 1.08 : 1.0;
}

// ─── Arch parameters ─────────────────────────────────────────────────────────

function archLift(arch: FootParameters["archHeight"]): number {
  return arch === "low" ? 0.02 : arch === "high" ? 0.12 : 0.06;
}

// ─── Toe-shape helpers ────────────────────────────────────────────────────────

/**
 * Returns normalised Z offsets for toes 1–5 (big toe = index 0).
 *  Egyptian: big toe longest, gradual step-down.
 *  Roman:    first three toes roughly equal, then step-down.
 *  Greek:    second toe longest.
 */
function toeZOffsets(shape: FootParameters["toeShape"]): number[] {
  switch (shape) {
    case "roman":
      return [0.0, 0.0, -0.005, -0.018, -0.038];
    case "greek":
      return [-0.012, 0.012, 0.0, -0.016, -0.036];
    case "egyptian":
    default:
      return [0.0, -0.010, -0.022, -0.036, -0.052];
  }
}

/**
 * Returns the normalised X position of each toe (0 = lateral, 1 = medial).
 * Index 0 = hallux (big toe).
 */
function toeXPositions(): number[] {
  // From medial to lateral: big toe at ~0.82, pinky at ~0.18
  return [0.82, 0.67, 0.52, 0.36, 0.21];
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generates the list of FootBlobs for the given parameter set.
 * The blobs are designed to be fed directly to MarchingCubes.addBall().
 */
export function generateControlPoints(params: FootParameters): FootBlob[] {
  const blobs: FootBlob[] = [];

  const {
    lengthScale,
    widthScale,
    heightScale,
    archHeight,
    footVolume,
    heelWidth,
    toeShape,
  } = params;

  // Derived multipliers
  const volW = volumeWidthMult(footVolume) * widthScale;
  const volH = volumeHeightMult(footVolume) * heightScale;
  const liftY = archLift(archHeight);

  // ─── Heel ──────────────────────────────────────────────────────────────────
  // Two overlapping blobs: main mass + posterior rounding
  const heelStr = 0.88 * heelWidth;
  blobs.push({
    x: 0.5,
    y: 0.30 * volH,
    z: 0.09 * lengthScale,
    strength: heelStr,
    subtract: 18,
  });
  blobs.push({
    x: 0.50,
    y: 0.22 * volH,
    z: 0.04 * lengthScale,
    strength: heelStr * 0.65,
    subtract: 20,
  });

  // ─── Midfoot / arch ────────────────────────────────────────────────────────
  // Medial arch is raised according to archHeight; lateral column is flatter
  const archZ = 0.42;
  // Lateral column (plantar)
  blobs.push({
    x: 0.26 * volW + 0.24,
    y: 0.18 * volH,
    z: archZ * lengthScale,
    strength: 0.60,
    subtract: 18,
  });
  // Medial arch — lifted by liftY
  blobs.push({
    x: 0.72 * volW + 0.08,
    y: (0.22 + liftY) * volH,
    z: (archZ - 0.03) * lengthScale,
    strength: 0.55,
    subtract: 20,
  });

  // ─── Forefoot / metatarsal heads ──────────────────────────────────────────
  const ffZ = 0.74 * lengthScale;
  // Broad medial metatarsal head
  blobs.push({
    x: 0.74 * volW + 0.10,
    y: 0.26 * volH,
    z: ffZ,
    strength: 0.78,
    subtract: 16,
  });
  // Central metatarsal
  blobs.push({
    x: 0.50,
    y: 0.28 * volH,
    z: ffZ + 0.01 * lengthScale,
    strength: 0.72,
    subtract: 16,
  });
  // Lateral metatarsal head (5th)
  blobs.push({
    x: 0.22 * volW + 0.15,
    y: 0.24 * volH,
    z: ffZ - 0.01 * lengthScale,
    strength: 0.70,
    subtract: 17,
  });
  // Dorsal forefoot bulk
  blobs.push({
    x: 0.50,
    y: (0.52 + liftY * 0.5) * volH,
    z: (ffZ - 0.04) * lengthScale,
    strength: 0.55,
    subtract: 20,
  });

  // ─── Dorsum (instep) ──────────────────────────────────────────────────────
  blobs.push({
    x: 0.54,
    y: (0.60 + liftY * 0.3) * volH,
    z: 0.55 * lengthScale,
    strength: 0.50,
    subtract: 22,
  });

  // ─── Toes ─────────────────────────────────────────────────────────────────
  const zOffsets = toeZOffsets(toeShape);
  const xPos = toeXPositions();

  // Toe base lengths from heel (big toe longest, pinky shortest)
  const toeBaseZ = [0.88, 0.87, 0.86, 0.84, 0.82];
  // Relative radii (big toe thickest, pinky smallest)
  const toeRadius = [0.80, 0.72, 0.68, 0.62, 0.55];
  // Toe tip Z offsets (separate from base)
  const toeTipDz = [0.07, 0.065, 0.060, 0.055, 0.046];

  for (let ti = 0; ti < 5; ti++) {
    const bz = toeBaseZ[ti] * lengthScale + zOffsets[ti];
    const tx = xPos[ti] * volW * 0.72 + (1 - volW * 0.72) * 0.5;
    const ty = 0.28 * volH;
    const str = toeRadius[ti];

    // Base of toe
    blobs.push({ x: tx, y: ty, z: bz, strength: str, subtract: 18 });

    // Toe tip
    blobs.push({
      x: tx,
      y: ty - 0.02,
      z: bz + toeTipDz[ti] * lengthScale,
      strength: str * 0.72,
      subtract: 20,
    });

    // Dorsal toe ridge
    blobs.push({
      x: tx,
      y: ty + 0.14 * volH,
      z: bz + 0.015 * lengthScale,
      strength: str * 0.42,
      subtract: 22,
    });
  }

  return blobs;
}
