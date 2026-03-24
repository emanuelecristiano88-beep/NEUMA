/**
 * Post-mesh deformations applied after MarchingCubes polygonisation.
 *
 * Currently implements:
 *   • Arch deformation — lifts / depresses the medial midfoot area using a
 *     radial Gaussian weight function.  High arch → midfoot raised; low arch →
 *     midfoot held flat / slightly sunken.
 *
 * All operations mutate the passed geometry in-place and return it for chaining.
 */

import * as THREE from "three";
import type { FootParameters } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Normalised space lift magnitudes per arch category.
 * Sign is positive = lift upward (Y+), applied to the midfoot.
 */
const ARCH_LIFT: Record<FootParameters["archHeight"], number> = {
  low:    -0.025,
  medium:  0.000,
  high:    0.055,
};

/**
 * Gaussian sigma controlling the spatial spread of the arch influence.
 * Larger = affects more of the midfoot; smaller = sharper lift.
 */
const ARCH_SIGMA_Z = 0.12; // along foot length
const ARCH_SIGMA_X = 0.08; // across foot width (medial bias)

/** Z position (normalised) of the arch apex — roughly mid-foot. */
const ARCH_Z_CENTRE = 0.0;

/** X position (normalised) of the medial arch — biased toward big-toe side. */
const ARCH_X_CENTRE = 0.12;

// ─── Helper ───────────────────────────────────────────────────────────────────

function gaussian2D(
  x: number, z: number,
  cx: number, cz: number,
  sx: number, sz: number
): number {
  const dx = (x - cx) / sx;
  const dz = (z - cz) / sz;
  return Math.exp(-0.5 * (dx * dx + dz * dz));
}

// ─── Arch deformation ─────────────────────────────────────────────────────────

/**
 * Modifies vertex Y positions to create or flatten an arch.
 *
 * The deformation is proportional to the arch lift magnitude and a Gaussian
 * weight centred on the medial midfoot.  The geometry bounding box is recomputed
 * afterwards; the caller is responsible for re-running vertex normals if needed
 * (the mesh builder calls a Laplacian pass after this, which does so).
 */
export function applyArchDeformation(
  geometry: THREE.BufferGeometry,
  params: FootParameters
): THREE.BufferGeometry {
  const lift = ARCH_LIFT[params.archHeight];
  if (Math.abs(lift) < 1e-6) return geometry;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;

  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const pos = geometry.attributes.position.array as Float32Array;
  const n = geometry.attributes.position.count;

  // Scale lift to world size: use the Y extent so the lift is always relative
  const worldLift = lift * Math.max(size.y, 1e-6);

  for (let i = 0; i < n; i++) {
    const ix = i * 3;
    const vx = pos[ix];
    const vz = pos[ix + 2];

    // Normalise X and Z relative to bounding box
    const nx = (vx - center.x) / Math.max(size.x, 1e-6);
    const nz = (vz - center.z) / Math.max(size.z, 1e-6);

    // Gaussian weight — peaks at the medial midfoot
    const w = gaussian2D(nx, nz, ARCH_X_CENTRE, ARCH_Z_CENTRE, ARCH_SIGMA_X, ARCH_SIGMA_Z);

    pos[ix + 1] += worldLift * w;
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.computeBoundingBox();
  return geometry;
}

// ─── Heel roundness deformation ──────────────────────────────────────────────

const HEEL_Z_CENTRE = -0.38;  // normalised Z of the heel region
const HEEL_SIGMA_Z  = 0.09;
const HEEL_SIGMA_X  = 0.14;

/**
 * Pinches or fattens the heel plantar face based on heelWidth parameter.
 * heelWidth > 1 → broader (flatten bottom); heelWidth < 1 → narrower (round more).
 */
export function applyHeelDeformation(
  geometry: THREE.BufferGeometry,
  params: FootParameters
): THREE.BufferGeometry {
  const delta = params.heelWidth - 1.0;
  if (Math.abs(delta) < 1e-4) return geometry;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;

  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const pos = geometry.attributes.position.array as Float32Array;
  const n = geometry.attributes.position.count;

  // We deform in X (width direction) only for the heel region
  const worldWidthDelta = delta * Math.max(size.x, 1e-6) * 0.18;

  for (let i = 0; i < n; i++) {
    const ix = i * 3;
    const vx = pos[ix];
    const vz = pos[ix + 2];
    const nx = (vx - center.x) / Math.max(size.x, 1e-6);
    const nz = (vz - center.z) / Math.max(size.z, 1e-6);

    const w = gaussian2D(nx, nz, 0, HEEL_Z_CENTRE, HEEL_SIGMA_X, HEEL_SIGMA_Z);
    // Push vertices outward from centre-line proportionally to their X offset
    pos[ix] += worldWidthDelta * w * Math.sign(nx);
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.computeBoundingBox();
  return geometry;
}
