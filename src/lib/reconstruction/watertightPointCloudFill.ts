/**
 * Densificazione “watertight” della nuvola prima di Marching Cubes:
 * nelle celle vuote interne (zone d’ombra, pieghe, arco) aggiunge punti
 * interpolati linearmente dai vicini (media pesata inversa distanza, k-NN).
 *
 * Coordinate in qualsiasi scala metrica coerente; le soglie sono relative al bbox.
 */

export type WatertightPointCloudFillOptions = {
  /** Suddivisioni lungo il lato lungo del bbox (≈ isotropo). */
  gridCellsLongAxis: number;
  /** Minimo di celle occupate nel 26-intorno perché una tasca sia riempibile. */
  minOccupied26Neighbors: number;
  /**
   * Raggio massimo per raccogliere i vicini usati nell’interpolazione,
   * come frazione della dimensione massima del bbox (es. 0.09 ≈ 9%).
   */
  interpRadiusRelative: number;
  /** Numero di vicini più prossimi per la media pesata IDW (potenza 1 → “lineare” nei pesi). */
  kNearest: number;
  /** Tetto punti sintetici (evita esplosione su nuvole rumorose). */
  maxSyntheticPoints: number;
  /** Espansione bbox prima del binning. */
  bboxPaddingRatio: number;
  /** Massimo celle griglia (sicurezza memoria). */
  maxGridCells: number;
};

export const DEFAULT_WATERTIGHT_FILL_OPTIONS: WatertightPointCloudFillOptions = {
  gridCellsLongAxis: 24,
  minOccupied26Neighbors: 5,
  interpRadiusRelative: 0.09,
  kNearest: 10,
  maxSyntheticPoints: 4500,
  bboxPaddingRatio: 0.028,
  maxGridCells: 110_000,
};

const NB26: [number, number, number][] = (() => {
  const o: [number, number, number][] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        o.push([dx, dy, dz]);
      }
    }
  }
  return o;
})();

function cellIndex(ix: number, iy: number, iz: number, nx: number, ny: number): number {
  return ix + nx * (iy + ny * iz);
}

/**
 * Duplica la nuvola e aggiunge punti sintetici nelle cavità interne rilevate in griglia,
 * usando interpolazione a distanza inversa (IDW, potenza 1) sui k vicini più prossimi.
 *
 * @returns Nuovo buffer (copia + sintetici) e conteggio totale.
 */
export function augmentPointCloudForWatertightMesh(
  positions: Float32Array,
  pointCount: number,
  options?: Partial<WatertightPointCloudFillOptions>,
): { positions: Float32Array; pointCount: number; syntheticAdded: number } {
  const opt = { ...DEFAULT_WATERTIGHT_FILL_OPTIONS, ...options };
  if (pointCount < 12) {
    return { positions, pointCount, syntheticAdded: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pointCount; i++) {
    const o = i * 3;
    const x = positions[o]!;
    const y = positions[o + 1]!;
    const z = positions[o + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const rx = maxX - minX;
  const ry = maxY - minY;
  const rz = maxZ - minZ;
  const maxExtent = Math.max(rx, ry, rz, 1e-9);
  const pad = maxExtent * opt.bboxPaddingRatio;
  minX -= pad;
  minY -= pad;
  minZ -= pad;
  maxX += pad;
  maxY += pad;
  maxZ += pad;
  const rx2 = maxX - minX;
  const ry2 = maxY - minY;
  const rz2 = maxZ - minZ;
  const maxE2 = Math.max(rx2, ry2, rz2, 1e-9);

  let cellSize = maxE2 / opt.gridCellsLongAxis;
  let nx = Math.max(4, Math.ceil(rx2 / cellSize));
  let ny = Math.max(4, Math.ceil(ry2 / cellSize));
  let nz = Math.max(4, Math.ceil(rz2 / cellSize));
  while (nx * ny * nz > opt.maxGridCells) {
    cellSize *= 1.1;
    nx = Math.max(4, Math.ceil(rx2 / cellSize));
    ny = Math.max(4, Math.ceil(ry2 / cellSize));
    nz = Math.max(4, Math.ceil(rz2 / cellSize));
  }

  const nCells = nx * ny * nz;
  const counts = new Uint16Array(nCells);
  const cellPoints: number[][] = Array.from({ length: nCells }, () => []);

  for (let pi = 0; pi < pointCount; pi++) {
    const o = pi * 3;
    const x = positions[o]!;
    const y = positions[o + 1]!;
    const z = positions[o + 2]!;
    let ix = Math.floor((x - minX) / cellSize);
    let iy = Math.floor((y - minY) / cellSize);
    let iz = Math.floor((z - minZ) / cellSize);
    ix = Math.max(0, Math.min(nx - 1, ix));
    iy = Math.max(0, Math.min(ny - 1, iy));
    iz = Math.max(0, Math.min(nz - 1, iz));
    const ci = cellIndex(ix, iy, iz, nx, ny);
    counts[ci] = Math.min(65535, (counts[ci] ?? 0) + 1);
    cellPoints[ci]!.push(pi);
  }

  const interpR = maxE2 * opt.interpRadiusRelative;
  const interpR2 = interpR * interpR;

  type Cand = { score: number; wx: number; wy: number; wz: number };
  const candidates: Cand[] = [];

  const distBuf: { i: number; d2: number }[] = [];

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const ci = cellIndex(ix, iy, iz, nx, ny);
        if (counts[ci]! > 0) continue;

        if (ix === 0 || ix === nx - 1 || iy === 0 || iy === ny - 1 || iz === 0 || iz === nz - 1) {
          continue;
        }

        let occ = 0;
        for (const [dx, dy, dz] of NB26) {
          const jx = ix + dx;
          const jy = iy + dy;
          const jz = iz + dz;
          if (jx < 0 || jx >= nx || jy < 0 || jy >= ny || jz < 0 || jz >= nz) continue;
          const j = cellIndex(jx, jy, jz, nx, ny);
          if (counts[j]! > 0) occ++;
        }
        if (occ < opt.minOccupied26Neighbors) continue;

        const cx = minX + (ix + 0.5) * cellSize;
        const cy = minY + (iy + 0.5) * cellSize;
        const cz = minZ + (iz + 0.5) * cellSize;

        distBuf.length = 0;
        for (let ddx = -1; ddx <= 1; ddx++) {
          for (let ddy = -1; ddy <= 1; ddy++) {
            for (let ddz = -1; ddz <= 1; ddz++) {
              const jx = ix + ddx;
              const jy = iy + ddy;
              const jz = iz + ddz;
              if (jx < 0 || jx >= nx || jy < 0 || jy >= ny || jz < 0 || jz >= nz) continue;
              const j = cellIndex(jx, jy, jz, nx, ny);
              const pts = cellPoints[j]!;
              for (let k = 0; k < pts.length; k++) {
                const pi = pts[k]!;
                const o = pi * 3;
                const px = positions[o]!;
                const py = positions[o + 1]!;
                const pz = positions[o + 2]!;
                const dx = px - cx;
                const dy = py - cy;
                const dz = pz - cz;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > interpR2) continue;
                distBuf.push({ i: pi, d2 });
              }
            }
          }
        }

        if (distBuf.length < 3) continue;

        distBuf.sort((a, b) => a.d2 - b.d2);
        const kUse = Math.min(opt.kNearest, distBuf.length);

        let sw = 0;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        const eps = maxE2 * 1e-6;
        for (let k = 0; k < kUse; k++) {
          const { i: pi, d2 } = distBuf[k]!;
          const d = Math.sqrt(Math.max(d2, eps * eps));
          const w = 1 / d;
          sw += w;
          const o = pi * 3;
          sx += w * positions[o]!;
          sy += w * positions[o + 1]!;
          sz += w * positions[o + 2]!;
        }
        if (sw < 1e-20) continue;

        const minD2 = distBuf[0]!.d2;
        const score = occ * 1e6 + 1 / (Math.sqrt(minD2) + eps);
        candidates.push({
          score,
          wx: sx / sw,
          wy: sy / sw,
          wz: sz / sw,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { positions, pointCount, syntheticAdded: 0 };
  }

  candidates.sort((a, b) => b.score - a.score);
  const take = Math.min(opt.maxSyntheticPoints, candidates.length);

  const out = new Float32Array((pointCount + take) * 3);
  out.set(positions.subarray(0, pointCount * 3));
  for (let s = 0; s < take; s++) {
    const c = candidates[s]!;
    const o = (pointCount + s) * 3;
    out[o] = c.wx;
    out[o + 1] = c.wy;
    out[o + 2] = c.wz;
  }

  return {
    positions: out,
    pointCount: pointCount + take,
    syntheticAdded: take,
  };
}
