/**
 * morphAvatarToClientData — deforma un mesh piede “avatar” perfetto verso i dati cliente.
 *
 * Pipeline:
 * 1. Centra il template e allinea gli assi a L=lunghezza (Z), W=larghezza (X), H=instep (Y) come in FootPreview.
 * 2. Blend shapes procedurali dalla pianta (flare avampiede, raccordo tallone, volume arco).
 * 3. Scaling non uniforme esatto affinché il bounding box coincida con lengthMm × widthMm × instepHeightMm.
 */

import * as THREE from "three";
import type { ObservationData } from "@/lib/aruco/poseEstimation";

/** Pesi morph derivati dalla proiezione plantare del point cloud (banda equatoriale). */
export type PlantMorphWeights = {
  /** Rapporto larghezza avampiede / metatarso vs nominale (~1). */
  forefootFlare: number;
  /** Rapporto larghezza tallone / metatarso vs nominale (~1). */
  heelTaper: number;
  /** 0..1 — enfasi volume arco plantare (0.5 = neutro). */
  archMedialBias: number;
};

export type ClientFootBiometrics = {
  lengthMm: number;
  widthMm: number;
  instepHeightMm: number;
  plant?: PlantMorphWeights;
};

const LOW_EL_M = 0.15;

/** Pianta neutra (nessuna deformazione plantare). */
export const NEUTRAL_PLANT_MORPH: PlantMorphWeights = {
  forefootFlare: 1,
  heelTaper: 1,
  archMedialBias: 0.5,
};

const DEFAULT_PLANT: PlantMorphWeights = NEUTRAL_PLANT_MORPH;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Estrae pesi “blend shape” plantari dalla nuvola punti mondo (metri),
 * usando i punti cupola bassi (stessa logica di finalizeScanData per L/W).
 */
export function extractPlantMorphFromPointCloud(observations: ObservationData[]): PlantMorphWeights {
  const pts = observations
    .filter((o) => o.dotWorldPos[1] < LOW_EL_M)
    .map((o) => ({ x: o.dotWorldPos[0], z: o.dotWorldPos[2] }));

  if (pts.length < 10) return { ...DEFAULT_PLANT };

  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;

  const rel = pts.map((p) => ({ x: p.x - cx, z: p.z - cz }));
  let cxx = 0;
  let cxz = 0;
  let czz = 0;
  for (const p of rel) {
    cxx += p.x * p.x;
    cxz += p.x * p.z;
    czz += p.z * p.z;
  }
  const n = rel.length;
  cxx /= n;
  cxz /= n;
  czz /= n;

  const trace = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const disc = Math.max(0, trace * trace * 0.25 - det);
  const l1 = trace * 0.5 + Math.sqrt(disc);

  let ux: number;
  let uz: number;
  if (Math.abs(cxz) > 1e-9) {
    ux = l1 - czz;
    uz = cxz;
  } else {
    ux = cxx >= czz ? 1 : 0;
    uz = cxx >= czz ? 0 : 1;
  }
  const ulen = Math.hypot(ux, uz) || 1;
  ux /= ulen;
  uz /= ulen;

  const vx = -uz;
  const vz = ux;

  const t: number[] = [];
  const w: number[] = [];
  for (const p of rel) {
    t.push(p.x * ux + p.z * uz);
    w.push(p.x * vx + p.z * vz);
  }
  const tMin = Math.min(...t);
  const tMax = Math.max(...t);
  const tRange = Math.max(tMax - tMin, 1e-9);

  function widthInBand(t0: number, t1: number): number {
    const ww: number[] = [];
    for (let i = 0; i < rel.length; i++) {
      const ti = (t[i]! - tMin) / tRange;
      if (ti >= t0 && ti < t1) ww.push(w[i]!);
    }
    if (ww.length < 3) return 0;
    return Math.max(...ww) - Math.min(...ww);
  }

  const wHeel = widthInBand(0, 0.36);
  const wMid = widthInBand(0.32, 0.68);
  const wFore = widthInBand(0.52, 1.0);
  const midRef = Math.max(wMid, 1e-6);

  const forefootFlare = clamp((wFore / midRef) / 1.1, 0.82, 1.48);
  const heelTaper = clamp((Math.max(wHeel, 1e-6) / midRef) / 0.9, 0.72, 1.32);

  const midIdx: number[] = [];
  for (let i = 0; i < rel.length; i++) {
    const ti = (t[i]! - tMin) / tRange;
    if (ti >= 0.36 && ti <= 0.64) midIdx.push(i);
  }
  let sumW = 0;
  for (const i of midIdx) sumW += w[i]!;
  const meanW = midIdx.length ? sumW / midIdx.length : 0;
  const archMedialBias = clamp(0.5 + (meanW / (midRef * 0.35 + 1e-6)) * 0.22, 0.2, 0.85);

  return { forefootFlare, heelTaper, archMedialBias };
}

function applyPlantBlendShapes(
  positions: Float32Array,
  box: THREE.Box3,
  morph: PlantMorphWeights,
): void {
  const { min, max } = box;
  const sx = Math.max(max.x - min.x, 1e-6);
  const sy = Math.max(max.y - min.y, 1e-6);
  const sz = Math.max(max.z - min.z, 1e-6);
  const cx = (min.x + max.x) * 0.5;

  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i]!;
    let y = positions[i + 1]!;
    let z = positions[i + 2]!;

    const nx = (x - min.x) / sx;
    const ny = (y - min.y) / sy;
    const nz = (z - min.z) / sz;

    const foreZone = smoothstep(0.48, 0.78, nz) * (1 - smoothstep(0.78, 0.95, nz));
    const foreMag = (morph.forefootFlare - 1) * 0.55;
    const dx = x - cx;
    x = cx + dx * (1 + foreMag * foreZone);

    const heelZone = smoothstep(0.42, 0.05, nz);
    const heelMag = (morph.heelTaper - 1) * 0.45;
    const dx2 = x - cx;
    x = cx + dx2 * (1 + heelMag * heelZone);

    const archZone =
      smoothstep(0.18, 0.42, nz) *
      (1 - smoothstep(0.58, 0.82, nz)) *
      smoothstep(0.15, 0.45, ny) *
      (1 - smoothstep(0.72, 0.95, ny));
    const archLift = (morph.archMedialBias - 0.5) * sy * 0.14 * archZone;
    y += archLift;

    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }
}

/**
 * Clona `baseGeometry`, applica morph + dimensioni cliente, restituisce una nuova geometria (mm = unità scena).
 */
export function morphAvatarToClientData(
  baseGeometry: THREE.BufferGeometry,
  client: ClientFootBiometrics,
): THREE.BufferGeometry {
  const geom = baseGeometry.clone();
  const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!posAttr) return geom;

  const positions = new Float32Array((posAttr.array as Float32Array).slice());
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  geom.computeBoundingBox();
  const box0 = geom.boundingBox!.clone();
  const c = new THREE.Vector3();
  box0.getCenter(c);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! -= c.x;
    positions[i + 1]! -= c.y;
    positions[i + 2]! -= c.z;
  }
  geom.computeBoundingBox();
  const box1 = geom.boundingBox!;

  const morph = client.plant ?? DEFAULT_PLANT;
  applyPlantBlendShapes(positions, box1, morph);
  geom.attributes.position.needsUpdate = true;
  geom.computeBoundingBox();
  const box2 = geom.boundingBox!;

  const size = new THREE.Vector3();
  box2.getSize(size);
  const sx = Math.max(size.x, 1e-6);
  const sy = Math.max(size.y, 1e-6);
  const sz = Math.max(size.z, 1e-6);

  const tx = client.widthMm / sx;
  const ty = client.instepHeightMm / sy;
  const tz = client.lengthMm / sz;

  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! *= tx;
    positions[i + 1]! *= ty;
    positions[i + 2]! *= tz;
  }

  geom.computeBoundingBox();
  geom.computeVertexNormals();
  return geom;
}
