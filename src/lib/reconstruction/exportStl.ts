/**
 * Export mesh → STL (ASCII o binario) in millimetri reali:
 * 1 unità nel file = 1 mm.
 *
 * Orientamento stampa: asse **Z verso l’alto**, **tallone in (0,0,0)** sul piano di stampa.
 * Mappatura da mesh Three (NEUMA: Y su, foglio XZ): (x,y,z)_three → (x, z, y)_stl.
 */

import * as THREE from "three";
import type { PointCloud } from "./types";
import { computeBoundingBoxFromPointCloud } from "./footMetrics";
import { buildPremiumFootDisplayMeshFromPointCloud } from "@/lib/visualization/premiumFootMeshFromPointCloud";

export type ExportStlOptions = {
  /** Nome solido (ASCII; caratteri sicuri). */
  solidName?: string;
  /** Se true (default), STL binario; altrimenti ASCII. */
  binary?: boolean;
  /** Spessore fascia plantare (mm) per stimare il tallone sul piano Z=0. */
  soleBandThicknessMm?: number;
  /** Ampiezza (mm) lungo Y per mediare X del tallone. */
  heelClusterSpanMm?: number;
};

const DEFAULT_SOLID = "NEUMA_FOOT_PRINT";

function maxDimFromBox(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
): number {
  return Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1e-9);
}

function triangleNormal(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): [number, number, number] {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  return [nx, ny, nz];
}

/**
 * Scala la mesh alla metrica della nuvola (mm), ruota in Z-up CAD e mette il tallone in (0,0,0)
 * con la suola sul piano Z=0. Modifica `geometry` in place (usa un clone se serve l’originale).
 */
export function transformMeshToStlPrintSpaceMm(
  geometry: THREE.BufferGeometry,
  referencePointCloudMm: PointCloud,
  options?: { soleBandThicknessMm?: number; heelClusterSpanMm?: number },
): void {
  const soleBand = options?.soleBandThicknessMm ?? 2.5;
  const heelSpan = options?.heelClusterSpanMm ?? 2;

  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return;

  geometry.computeBoundingBox();
  const mb = geometry.boundingBox;
  if (!mb) return;

  const pcBox = computeBoundingBoxFromPointCloud(referencePointCloudMm);
  const dimPc = maxDimFromBox(pcBox.min, pcBox.max);
  const dimMesh = maxDimFromBox(
    { x: mb.min.x, y: mb.min.y, z: mb.min.z },
    { x: mb.max.x, y: mb.max.y, z: mb.max.z },
  );
  const scale = dimPc / dimMesh;

  const arr = pos.array as Float32Array;
  const n = pos.count;

  // NEUMA Three → STL mm: X→X, Y(↑)→Z(↑), Z→Y (lunghezza piede sul piano stampa)
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = arr[o]! * scale;
    const y = arr[o + 1]! * scale;
    const z = arr[o + 2]! * scale;
    arr[o] = x;
    arr[o + 1] = z;
    arr[o + 2] = y;
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  const b2 = geometry.boundingBox!;
  const zMin = b2.min.z;

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    arr[o + 2] = arr[o + 2]! - zMin;
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  const bAfterZ = geometry.boundingBox!;

  // Tallone: tra i vertici vicini a Z=0, minimo Y (estremità posteriore lungo l’asse “lunghezza” = ex-NEUMA-Z)
  let minY = Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (arr[o + 2]! > soleBand) continue;
    const y = arr[o + 1]!;
    if (y < minY) minY = y;
  }

  if (!Number.isFinite(minY)) {
    minY = bAfterZ.min.y;
  }

  let sx = 0;
  let sc = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (arr[o + 2]! > soleBand) continue;
    if (arr[o + 1]! <= minY + heelSpan) {
      sx += arr[o]!;
      sc++;
    }
  }
  const heelX = sc > 0 ? sx / sc : (bAfterZ.min.x + bAfterZ.max.x) / 2;
  const heelY = minY;

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    arr[o] = arr[o]! - heelX;
    arr[o + 1] = arr[o + 1]! - heelY;
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
}

function collectTrianglesMm(geometry: THREE.BufferGeometry): Float32Array {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  const n = pos.count;
  if (n % 3 !== 0) {
    if (g !== geometry) g.dispose();
    return new Float32Array(0);
  }
  const out = new Float32Array(n * 3);
  out.set(a);
  if (g !== geometry) g.dispose();
  return out;
}

/**
 * Converte la mesh (preview NEUMA / Three Y-up) in Blob STL.
 * La nuvola di riferimento serve solo per la scala metrica (mm).
 */
export function exportToSTL(
  meshGeometry: THREE.BufferGeometry,
  referencePointCloudMm: PointCloud,
  options?: ExportStlOptions,
): Blob {
  const solidName = (options?.solidName ?? DEFAULT_SOLID).replace(/[^\x20-\x7E]+/g, "_").slice(0, 72);
  const binary = options?.binary !== false;

  const geom = meshGeometry.clone();
  try {
    transformMeshToStlPrintSpaceMm(geom, referencePointCloudMm, {
      soleBandThicknessMm: options?.soleBandThicknessMm,
      heelClusterSpanMm: options?.heelClusterSpanMm,
    });

    const flat = collectTrianglesMm(geom);
    const triCount = flat.length / 9;
    if (triCount <= 0) {
      return new Blob([], { type: "application/octet-stream" });
    }

    if (binary) {
      const header = new Uint8Array(80);
      const enc = new TextEncoder();
      const nameBytes = enc.encode(`NEUMA:${solidName}`);
      header.set(nameBytes.slice(0, 80));

      const body = new ArrayBuffer(4 + triCount * 50);
      const dv = new DataView(body);
      dv.setUint32(0, triCount, true);
      let off = 4;

      for (let t = 0; t < triCount; t++) {
        const i = t * 9;
        const ax = flat[i]!;
        const ay = flat[i + 1]!;
        const az = flat[i + 2]!;
        const bx = flat[i + 3]!;
        const by = flat[i + 4]!;
        const bz = flat[i + 5]!;
        const cx = flat[i + 6]!;
        const cy = flat[i + 7]!;
        const cz = flat[i + 8]!;
        const [nx, ny, nz] = triangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
        dv.setFloat32(off, nx, true);
        off += 4;
        dv.setFloat32(off, ny, true);
        off += 4;
        dv.setFloat32(off, nz, true);
        off += 4;
        dv.setFloat32(off, ax, true);
        off += 4;
        dv.setFloat32(off, ay, true);
        off += 4;
        dv.setFloat32(off, az, true);
        off += 4;
        dv.setFloat32(off, bx, true);
        off += 4;
        dv.setFloat32(off, by, true);
        off += 4;
        dv.setFloat32(off, bz, true);
        off += 4;
        dv.setFloat32(off, cx, true);
        off += 4;
        dv.setFloat32(off, cy, true);
        off += 4;
        dv.setFloat32(off, cz, true);
        off += 4;
        dv.setUint16(off, 0, true);
        off += 2;
      }

      return new Blob([header, body], { type: "application/octet-stream" });
    }

    const lines: string[] = [];
    lines.push(`solid ${solidName}`);
    for (let t = 0; t < triCount; t++) {
      const i = t * 9;
      const ax = flat[i]!;
      const ay = flat[i + 1]!;
      const az = flat[i + 2]!;
      const bx = flat[i + 3]!;
      const by = flat[i + 4]!;
      const bz = flat[i + 5]!;
      const cx = flat[i + 6]!;
      const cy = flat[i + 7]!;
      const cz = flat[i + 8]!;
      const [nx, ny, nz] = triangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
      lines.push(`facet normal ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`);
      lines.push("  outer loop");
      lines.push(`    vertex ${ax.toFixed(6)} ${ay.toFixed(6)} ${az.toFixed(6)}`);
      lines.push(`    vertex ${bx.toFixed(6)} ${by.toFixed(6)} ${bz.toFixed(6)}`);
      lines.push(`    vertex ${cx.toFixed(6)} ${cy.toFixed(6)} ${cz.toFixed(6)}`);
      lines.push("  endloop");
      lines.push("endfacet");
    }
    lines.push(`endsolid ${solidName}`);
    return new Blob([lines.join("\n")], { type: "text/plain" });
  } finally {
    geom.dispose();
  }
}

/** Costruisce la mesh premium dalla nuvola (mm) e restituisce un Blob STL. */
export function exportFootPointCloudToSTL(
  cloud: PointCloud,
  stlOptions?: ExportStlOptions,
  meshBuildOptions?: Parameters<typeof buildPremiumFootDisplayMeshFromPointCloud>[1],
): Blob | null {
  const geom = buildPremiumFootDisplayMeshFromPointCloud(cloud, {
    footwearLinearUnitToMm: 1,
    ...meshBuildOptions,
  });
  if (!geom) return null;
  try {
    return exportToSTL(geom, cloud, stlOptions);
  } finally {
    geom.dispose();
  }
}

export function downloadStlBlob(blob: Blob, filename = "neuma-foot.stl"): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".stl") ? filename : `${filename}.stl`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
