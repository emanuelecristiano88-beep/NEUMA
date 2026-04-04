/**
 * Classificazione forma dita (Egizio / Greco / Romano) da point cloud cupola.
 *
 * Nel frame mondo NEUMA: piano foglio ~ orizzontale, asse Y verticale.
 * Si proietta la pianta su XZ (PCA come extractPlantMorph), si isolano i punti
 * avampiede (alto t lungo l’asse piede) e si partiziona la larghezza w in tre
 * fasce: alluce (mediale), secondo, terzo dito.
 * Per ogni fascia si prendono i punti più anteriori (t massimo) e si confronta
 * la quota Y (profondità verticale del campione in mondo) come proxy della
 * “lunghezza” relativa del profilo dita sul campione cupola.
 */

import type { ObservationData } from "@/lib/aruco/poseEstimation";

export type ToeShapeKind = "egizio" | "greco" | "romano" | "indeterminato";

export type ToeShapeClassification = {
  kind: ToeShapeKind;
  /** Y (m) dei punti “punta” per [alluce, secondo, terzo], dopo ordinamento fasce mediale→laterale */
  yTipsM: [number, number, number];
  /** Estensione lungo piede t (normalizzata 0–1) delle punte, per debug/UI opzionale */
  tTipsNorm: [number, number, number];
  /** 0–1 in base al numero di punti utilizzati */
  confidence: number;
};

const LOW_WY_M = 0.17;
const FOREFOOT_T0 = 0.56;
const MIN_TOTAL = 18;
const MIN_PER_BIN = 4;
const ROMAN_MAX_SPREAD_M = 0.0045;
const GREEK_MIN_DELTA_M = 0.0028;
const EGYPT_MIN_DELTA_M = 0.0022;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Classifica la forma dita dalle osservazioni cupola (dotWorldPos in metri).
 */
export function classifyToeShapeFromObservations(observations: ObservationData[]): ToeShapeClassification {
  const pts = observations
    .map((o) => ({
      x: o.dotWorldPos[0],
      y: o.dotWorldPos[1],
      z: o.dotWorldPos[2],
    }))
    .filter((p) => p.y < LOW_WY_M);

  if (pts.length < MIN_TOTAL) {
    return {
      kind: "indeterminato",
      yTipsM: [0, 0, 0],
      tTipsNorm: [0, 0, 0],
      confidence: 0,
    };
  }

  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;

  const rel = pts.map((p) => ({ x: p.x - cx, z: p.z - cz, y: p.y }));
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

  const tList: number[] = [];
  const wList: number[] = [];
  for (const p of rel) {
    tList.push(p.x * ux + p.z * uz);
    wList.push(p.x * vx + p.z * vz);
  }
  const tMin = Math.min(...tList);
  const tMax = Math.max(...tList);
  const tRange = Math.max(tMax - tMin, 1e-9);

  type Pw = { y: number; t: number; w: number };
  const fore: Pw[] = [];
  for (let i = 0; i < rel.length; i++) {
    const tNorm = (tList[i]! - tMin) / tRange;
    if (tNorm < FOREFOOT_T0) continue;
    fore.push({ y: rel[i]!.y, t: tList[i]!, w: wList[i]! });
  }

  if (fore.length < MIN_TOTAL) {
    return {
      kind: "indeterminato",
      yTipsM: [0, 0, 0],
      tTipsNorm: [0, 0, 0],
      confidence: clamp(fore.length / MIN_TOTAL, 0, 0.45),
    };
  }

  const wVals = fore.map((p) => p.w);
  const wMin = Math.min(...wVals);
  const wMax = Math.max(...wVals);
  const wRange = Math.max(wMax - wMin, 1e-9);

  const bins: Pw[][] = [[], [], []];
  for (const p of fore) {
    const u = (p.w - wMin) / wRange;
    const idx = u < 1 / 3 ? 0 : u < 2 / 3 ? 1 : 2;
    bins[idx]!.push(p);
  }

  if (bins.some((b) => b.length < MIN_PER_BIN)) {
    const c = clamp(Math.min(...bins.map((b) => b.length)) / MIN_PER_BIN, 0, 0.55);
    return {
      kind: "indeterminato",
      yTipsM: [0, 0, 0],
      tTipsNorm: [0, 0, 0],
      confidence: c,
    };
  }

  /** Per fascia: tra i punti nel top 18% di t (punta), media Y dei 4 punti più avanti */
  function tipMetric(points: Pw[]): { y: number; tNorm: number } {
    const sortedT = [...points].sort((a, b) => b.t - a.t);
    const k = Math.max(4, Math.ceil(points.length * 0.18));
    const tipSlice = sortedT.slice(0, k);
    let ySum = 0;
    let tSum = 0;
    for (const p of tipSlice) {
      ySum += p.y;
      tSum += p.t;
    }
    const yMean = ySum / tipSlice.length;
    const tMean = tSum / tipSlice.length;
    const tNorm = (tMean - tMin) / tRange;
    return { y: yMean, tNorm };
  }

  const m0 = tipMetric(bins[0]!);
  const m1 = tipMetric(bins[1]!);
  const m2 = tipMetric(bins[2]!);

  const y1 = m0.y;
  const y2 = m1.y;
  const y3 = m2.y;
  const yTipsM: [number, number, number] = [y1, y2, y3];
  const tTipsNorm: [number, number, number] = [m0.tNorm, m1.tNorm, m2.tNorm];

  const spread = Math.max(y1, y2, y3) - Math.min(y1, y2, y3);
  const conf = clamp(Math.min(...bins.map((b) => b.length)) / 24, 0.35, 1);

  if (spread < ROMAN_MAX_SPREAD_M) {
    return { kind: "romano", yTipsM, tTipsNorm, confidence: conf };
  }

  if (y2 > y1 + GREEK_MIN_DELTA_M && y2 >= y3 - ROMAN_MAX_SPREAD_M * 0.5) {
    return { kind: "greco", yTipsM, tTipsNorm, confidence: conf };
  }

  if (y1 > y2 + EGYPT_MIN_DELTA_M && y2 > y3 + EGYPT_MIN_DELTA_M * 0.65) {
    return { kind: "egizio", yTipsM, tTipsNorm, confidence: conf };
  }

  if (y1 > y2 && y2 > y3) {
    return { kind: "egizio", yTipsM, tTipsNorm, confidence: conf * 0.85 };
  }

  if (y2 > y1) {
    return { kind: "greco", yTipsM, tTipsNorm, confidence: conf * 0.8 };
  }

  return { kind: "indeterminato", yTipsM, tTipsNorm, confidence: conf * 0.5 };
}

export const TOE_SHAPE_LABEL_IT: Record<ToeShapeKind, string> = {
  egizio: "Egizio",
  greco: "Greco",
  romano: "Romano",
  indeterminato: "Non rilevato",
};
