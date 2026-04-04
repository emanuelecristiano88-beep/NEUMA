/**
 * Trasformazione nuvola → forma calzatura / plantare:
 * - offset comfort sul perimetro (espansione nel piano foglio)
 * - appoggio sul piano del foglio: in NEUMA il foglio A4 è **Y = 0** (Y-up, piano XZ).
 *   Per slicer / CAD con **Z = 0** come piano di stampa, usa `verticalConvention: "z_up_sheet_z0"`.
 * - smoothing locale anti-asperità (TPU)
 */

import * as THREE from "three";

export type FootwearVerticalConvention = "y_up_sheet_y0" | "z_up_sheet_z0";

export type FootwearPrepOptions = {
  /** Se false, nessuna modifica. */
  enabled: boolean;
  /**
   * Distanza di comfort sul contorno: espansione nel piano orizzontale (mm × linearUnitToMm → unità posizioni).
   * Default +2 mm.
   */
  comfortOffsetMm: number;
  /**
   * 1 = coordinate già in mm; 0.001 = coordinate in metri (moltiplica mm per passare in metri).
   * comfortOffsetMm * linearUnitToMm = delta applicato in unità del buffer.
   */
  linearUnitToMm: number;
  /** Valore del piano foglio / piatto stampa sull’asse verticale (dopo convenzione). */
  sheetPlane: number;
  verticalConvention: FootwearVerticalConvention;
  /** Passate smoothing Laplaciano-like sulla nuvola. */
  skinSmoothIterations: number;
  /** 0..1 — blend verso baricentro dei vicini. */
  skinSmoothLambda: number;
  /** Lato cella hash spaziale per vicini (mm × linearUnitToMm). */
  skinSmoothCellMm: number;
  /** Max vicini per media (escluso sé stesso). */
  skinSmoothMaxNeighbors: number;
};

export const DEFAULT_FOOTWEAR_PREP_OPTIONS: FootwearPrepOptions = {
  enabled: true,
  comfortOffsetMm: 2,
  linearUnitToMm: 1,
  sheetPlane: 0,
  verticalConvention: "y_up_sheet_y0",
  skinSmoothIterations: 2,
  skinSmoothLambda: 0.38,
  skinSmoothCellMm: 4.5,
  skinSmoothMaxNeighbors: 14,
};

export type FootwearMeshBedOptions = {
  verticalConvention: FootwearVerticalConvention;
  sheetPlane: number;
  /** Vertici con coordinata verticale sotto questa frazione dell’altezza vengono portati al piano. */
  bottomSnapHeightFraction: number;
  /** Scala finale come preview (0.85 / maxDim). */
  targetMaxExtent: number;
};

export const DEFAULT_FOOTWEAR_MESH_BED_OPTIONS: FootwearMeshBedOptions = {
  verticalConvention: "y_up_sheet_y0",
  sheetPlane: 0,
  bottomSnapHeightFraction: 0.012,
  targetMaxExtent: 0.85,
};

function axisIndices(conv: FootwearVerticalConvention): { v: number; h0: number; h1: number } {
  return conv === "y_up_sheet_y0"
    ? { v: 1, h0: 0, h1: 2 }
    : { v: 2, h0: 0, h1: 1 };
}

function cellKey(x: number, y: number, z: number, inv: number): string {
  return `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)}`;
}

/**
 * Smoothing locale: ogni punto si avvicina al baricentro dei vicini entro raggio ~2 celle.
 */
function smoothPointCloudOnce(
  positions: Float32Array,
  count: number,
  cellSize: number,
  lambda: number,
  maxNeigh: number,
): void {
  if (count < 4 || cellSize <= 0) return;
  const inv = 1 / cellSize;
  const r2 = (cellSize * 2.2) * (cellSize * 2.2);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const k = cellKey(positions[o]!, positions[o + 1]!, positions[o + 2]!, inv);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(i);
  }

  const next = new Float32Array(positions.length);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o]!;
    const y = positions[o + 1]!;
    const z = positions[o + 2]!;
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);

    const neighIdx: number[] = [];
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const oj = j * 3;
            const ddx = positions[oj]! - x;
            const ddy = positions[oj + 1]! - y;
            const ddz = positions[oj + 2]! - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) neighIdx.push(j);
            if (neighIdx.length >= maxNeigh) break outer;
          }
        }
      }
    }

    if (neighIdx.length === 0) {
      next[o] = x;
      next[o + 1] = y;
      next[o + 2] = z;
      continue;
    }

    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const j of neighIdx) {
      const oj = j * 3;
      sx += positions[oj]!;
      sy += positions[oj + 1]!;
      sz += positions[oj + 2]!;
    }
    const k = neighIdx.length;
    const mx = sx / k;
    const my = sy / k;
    const mz = sz / k;
    const β = lambda;
    next[o] = (1 - β) * x + β * mx;
    next[o + 1] = (1 - β) * y + β * my;
    next[o + 2] = (1 - β) * z + β * mz;
  }
  positions.set(next);
}

/**
 * Applica comfort (espansione radiale nel piano foglio), piano di appoggio e smoothing pelle.
 * Modifica copia — non altera l’input originale se non è già la stessa istanza.
 */
export function applyFootwearPointCloudPrep(
  positions: Float32Array,
  pointCount: number,
  options?: Partial<FootwearPrepOptions>,
): { positions: Float32Array; pointCount: number } {
  const opt = { ...DEFAULT_FOOTWEAR_PREP_OPTIONS, ...options };
  if (!opt.enabled || pointCount < 6) {
    return { positions, pointCount };
  }

  const out = new Float32Array(positions.subarray(0, pointCount * 3));
  const { v, h0, h1 } = axisIndices(opt.verticalConvention);
  const cellU = opt.skinSmoothCellMm * opt.linearUnitToMm;
  const comfortU = opt.comfortOffsetMm * opt.linearUnitToMm;

  for (let it = 0; it < opt.skinSmoothIterations; it++) {
    smoothPointCloudOnce(out, pointCount, cellU, opt.skinSmoothLambda, opt.skinSmoothMaxNeighbors);
  }

  let ch0 = 0;
  let ch1 = 0;
  for (let i = 0; i < pointCount; i++) {
    const o = i * 3;
    ch0 += out[o + h0]!;
    ch1 += out[o + h1]!;
  }
  ch0 /= pointCount;
  ch1 /= pointCount;

  if (comfortU > 0) {
    for (let i = 0; i < pointCount; i++) {
      const o = i * 3;
      const dx = out[o + h0]! - ch0;
      const dz = out[o + h1]! - ch1;
      const len = Math.hypot(dx, dz);
      if (len > 1e-9) {
        const s = comfortU / len;
        out[o + h0] = out[o + h0]! + dx * s;
        out[o + h1] = out[o + h1]! + dz * s;
      }
    }
  }

  let vmin = Infinity;
  for (let i = 0; i < pointCount; i++) {
    const vy = out[i * 3 + v]!;
    if (vy < vmin) vmin = vy;
  }
  const shift = opt.sheetPlane - vmin;
  if (Math.abs(shift) > 1e-12) {
    for (let i = 0; i < pointCount; i++) {
      out[i * 3 + v] = out[i * 3 + v]! + shift;
    }
  }

  return { positions: out, pointCount };
}

/**
 * Dopo Marching Cubes: appoggio sul piano foglio, base smussata, centro orizzontale, scala uniforme (preview).
 */
export function applyFootwearMeshBedAlignment(
  geometry: THREE.BufferGeometry,
  options?: Partial<FootwearMeshBedOptions>,
): THREE.BufferGeometry {
  const opt = { ...DEFAULT_FOOTWEAR_MESH_BED_OPTIONS, ...options };
  const { v, h0, h1 } = axisIndices(opt.verticalConvention);

  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return geometry;

  const arr = pos.array as Float32Array;
  const n = pos.count;

  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const vy = arr[i * 3 + v]!;
    if (vy < vmin) vmin = vy;
    if (vy > vmax) vmax = vy;
  }
  const height = Math.max(vmax - vmin, 1e-9);
  const snapE = height * opt.bottomSnapHeightFraction;

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    arr[o + v] = arr[o + v]! - vmin + opt.sheetPlane;
    if (arr[o + v]! < snapE) arr[o + v] = opt.sheetPlane;
  }

  let min0 = Infinity;
  let max0 = -Infinity;
  let min1 = Infinity;
  let max1 = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const a0 = arr[o + h0]!;
    const a1 = arr[o + h1]!;
    const av = arr[o + v]!;
    if (a0 < min0) min0 = a0;
    if (a0 > max0) max0 = a0;
    if (a1 < min1) min1 = a1;
    if (a1 > max1) max1 = a1;
    if (av < minV) minV = av;
    if (av > maxV) maxV = av;
  }
  const c0 = (min0 + max0) / 2;
  const c1 = (min1 + max1) / 2;

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    arr[o + h0] = arr[o + h0]! - c0;
    arr[o + h1] = arr[o + h1]! - c1;
  }

  const sx = max0 - min0;
  const sy = maxV - minV;
  const sz = max1 - min1;
  const maxDim = Math.max(sx, sy, sz, 1e-9);
  const sc = opt.targetMaxExtent / maxDim;
  for (let i = 0; i < arr.length; i++) {
    arr[i] = (arr[i] ?? 0) * sc;
  }

  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  return geometry;
}
