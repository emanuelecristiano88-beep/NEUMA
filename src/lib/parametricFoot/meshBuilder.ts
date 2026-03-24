/**
 * Builds a THREE.BufferGeometry foot mesh from a FootParameters set.
 *
 * Pipeline:
 *  1. Generate anatomical blob control points (generateControlPoints)
 *  2. Feed blobs into MarchingCubes (isosurface polygonisation)
 *  3. Optional scalar-field blur to reduce blocky artefacts
 *  4. Rescale geometry to real-world proportions using lengthScale / widthScale / heightScale
 *  5. Apply Laplacian smoothing passes (reuses existing laplacianSmoothGeometry)
 *  6. Apply post-mesh FFD arch deformation
 *  7. Re-centre and normalise to visual unit size
 */

import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { generateControlPoints } from "./controlPoints";
import { applyArchDeformation } from "./deform";
import type { FootParameters, FootBlob, ParametricFootResult } from "./types";

// ─── Options ──────────────────────────────────────────────────────────────────

export type MeshBuilderOptions = {
  /** MarchingCubes grid resolution (higher = more detail, heavier). Default: 46 */
  resolution: number;
  /** Max poly count passed to MarchingCubes. Default: 200 000 */
  maxPolyCount: number;
  /** Isosurface threshold. Default: 40 */
  isolation: number;
  /** Scalar-field blur passes before polygonisation. Default: 2 */
  fieldBlurPasses: number;
  /** Laplacian smoothing iterations after mesh construction. Default: 6 */
  smoothIterations: number;
  /** Laplacian lambda (0–1). Default: 0.40 */
  lambda: number;
};

export const DEFAULT_MESH_BUILDER_OPTIONS: MeshBuilderOptions = {
  resolution: 46,
  maxPolyCount: 200_000,
  isolation: 40,
  fieldBlurPasses: 2,
  smoothIterations: 6,
  lambda: 0.40,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAD = 1e-4;

function clamp01(v: number): number {
  return Math.max(PAD, Math.min(1 - PAD, v));
}

/**
 * Lightweight Laplacian smooth (tri mesh).
 * Adapted from footSurfaceMesh.ts to work standalone in this module.
 */
function laplacianSmooth(
  geometry: THREE.BufferGeometry,
  iterations: number,
  lambda: number
): THREE.BufferGeometry {
  if (iterations <= 0) {
    geometry.computeVertexNormals();
    return geometry;
  }

  // Merge duplicate vertices for correct neighbourhood topology
  const merged = mergeVertices(geometry, 1e-5);
  if (merged !== geometry) geometry.dispose();

  const indexAttr = merged.index;
  if (!indexAttr) {
    merged.computeVertexNormals();
    return merged;
  }

  const vc = merged.attributes.position.count;
  const neighbors: Set<number>[] = Array.from({ length: vc }, () => new Set());
  const idxArr = indexAttr.array as ArrayLike<number>;
  for (let i = 0; i < indexAttr.count; i += 3) {
    const a = idxArr[i], b = idxArr[i + 1], c = idxArr[i + 2];
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }

  const pos = merged.attributes.position.array as Float32Array;
  const tmp = new Float32Array(pos.length);

  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < vc; v++) {
      const nbr = neighbors[v];
      if (nbr.size === 0) {
        tmp[v * 3] = pos[v * 3];
        tmp[v * 3 + 1] = pos[v * 3 + 1];
        tmp[v * 3 + 2] = pos[v * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      nbr.forEach((j) => { sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; });
      const k = nbr.size;
      tmp[v * 3]     = (1 - lambda) * pos[v * 3]     + lambda * (sx / k);
      tmp[v * 3 + 1] = (1 - lambda) * pos[v * 3 + 1] + lambda * (sy / k);
      tmp[v * 3 + 2] = (1 - lambda) * pos[v * 3 + 2] + lambda * (sz / k);
    }
    pos.set(tmp);
  }

  merged.attributes.position.needsUpdate = true;
  merged.computeVertexNormals();
  return merged;
}

/**
 * Stretches geometry to match length / width / height ratios derived from
 * FootParameters.  The MarchingCubes output is in [−0.5, 0.5]³ centred space;
 * we apply per-axis non-uniform scaling before smoothing so the Laplacian
 * operates on plausible proportions.
 */
function stretchGeometryToProportions(
  geometry: THREE.BufferGeometry,
  params: FootParameters
): void {
  const arr = geometry.attributes.position.array as Float32Array;
  const lx = params.widthScale;
  const ly = params.heightScale;
  const lz = params.lengthScale;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i]     *= lx;
    arr[i + 1] *= ly;
    arr[i + 2] *= lz;
  }
  geometry.attributes.position.needsUpdate = true;
}

/**
 * Re-centres geometry at origin and scales so the longest dimension equals
 * targetSize (default 0.85) — matches the visual unit used by FootPointCloudPreview.
 */
function centreAndNormalise(geometry: THREE.BufferGeometry, targetSize = 0.85): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);

  const arr = geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i]     -= center.x;
    arr[i + 1] -= center.y;
    arr[i + 2] -= center.z;
  }

  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox!.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = targetSize / maxDim;
  for (let i = 0; i < arr.length; i++) {
    arr[i] *= scale;
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Builds a parametric foot mesh from the given parameters.
 *
 * @returns ParametricFootResult with a fully constructed, smoothed geometry
 *          ready for use in a Three.js scene, or `null` if the mesh is degenerate.
 */
export function buildParametricFootGeometry(
  params: FootParameters,
  options?: Partial<MeshBuilderOptions>
): ParametricFootResult | null {
  const opt = { ...DEFAULT_MESH_BUILDER_OPTIONS, ...options };

  const blobs: FootBlob[] = generateControlPoints(params);

  // ── 1. Polygonise ──────────────────────────────────────────────────────────
  const dummyMat = new THREE.MeshBasicMaterial({ visible: false });
  const mc = new MarchingCubes(opt.resolution, dummyMat, false, false, opt.maxPolyCount);
  mc.isolation = opt.isolation;
  mc.reset();

  for (const b of blobs) {
    mc.addBall(clamp01(b.x), clamp01(b.y), clamp01(b.z), b.strength, b.subtract);
  }

  for (let i = 0; i < opt.fieldBlurPasses; i++) {
    mc.blur(1.15);
  }

  mc.update();
  const raw = mc.geometry.clone();
  dummyMat.dispose();
  mc.geometry.dispose();

  if (!raw.attributes.position || raw.attributes.position.count < 9) {
    raw.dispose();
    return null;
  }

  // ── 2. Stretch to target proportions ──────────────────────────────────────
  stretchGeometryToProportions(raw, params);

  // ── 3. First smoothing pass (pre-deformation, moderate) ───────────────────
  let geom = laplacianSmooth(raw, Math.max(2, Math.floor(opt.smoothIterations * 0.5)), opt.lambda);

  // ── 4. Arch FFD deformation ───────────────────────────────────────────────
  geom = applyArchDeformation(geom, params);

  // ── 5. Second smoothing pass (post-deformation, finer) ────────────────────
  geom = laplacianSmooth(geom, Math.max(1, Math.ceil(opt.smoothIterations * 0.5)), opt.lambda * 0.85);

  // ── 6. Normalise to visual unit ───────────────────────────────────────────
  centreAndNormalise(geom);

  return { geometry: geom, parameters: params };
}
