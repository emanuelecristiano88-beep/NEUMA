/**
 * Pacchetto dati JSON per generazione 3D scarpa / plantare (post-conferma utente).
 */

import type { ObservationData } from "@/lib/aruco/poseEstimation";
import type { ToeShapeKind } from "@/lib/biometry/classifyToeShapeFromObservations";
import type { FootMeasurements } from "@/lib/scanner/finalizeScanData";
import type { PointCloud } from "@/lib/reconstruction/types";
import { downsamplePointCloud } from "@/lib/visualization/downsamplePointCloud";
import {
  toeBoxParamsFromClassification,
  toeShapeKindToEnglish,
  type ToeBoxDesignParams,
  type ToeClassificationEnglish,
} from "@/lib/footwear/toeBoxDesignRules";

const PACKAGE_SCHEMA = "1.0" as const;
const MAX_CLOUD_POINTS = 2800;

export type FootDesignPackageV1 = {
  schemaVersion: typeof PACKAGE_SCHEMA;
  createdAt: string;
  dimensionsMm: {
    length: number;
    width: number;
    height: number;
  };
  /** Nuvola punti piede (mm), mondo scan, filtrata + downsample. */
  filteredPointCloudMm: Array<{ x: number; y: number; z: number }>;
  toeClassification: ToeClassificationEnglish;
  /** Parametri per il modulo generazione scarpa (toe box). */
  shoeToeBox: ToeBoxDesignParams;
  meta: {
    observationCount: number;
    scanDurationMs: number | null;
    sheetDimensionsMm: { width: number; height: number };
  };
};

function observationsToPointCloudMm(observations: ObservationData[]): PointCloud {
  const n = observations.length;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [wx, wy, wz] = observations[i]!.dotWorldPos;
    const o = i * 3;
    positions[o] = wx * 1000;
    positions[o + 1] = wy * 1000;
    positions[o + 2] = wz * 1000;
  }
  return { positions, pointCount: n };
}

function medianSorted(copy: number[]): number {
  copy.sort((a, b) => a - b);
  const m = Math.floor(copy.length / 2);
  return copy.length % 2 ? copy[m]! : (copy[m - 1]! + copy[m]!) / 2;
}

/** Rimuove outlier grossolani rispetto al mediano (robusto per burst error). */
function filterOutliersMedianMm(cloud: PointCloud, maxAbsDeltaMm: number): PointCloud {
  if (cloud.pointCount < 4) return cloud;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const p = cloud.positions;
  for (let i = 0; i < cloud.pointCount; i++) {
    xs.push(p[i * 3]!);
    ys.push(p[i * 3 + 1]!);
    zs.push(p[i * 3 + 2]!);
  }
  const mx = medianSorted([...xs]);
  const my = medianSorted([...ys]);
  const mz = medianSorted([...zs]);

  const keep: number[] = [];
  for (let i = 0; i < cloud.pointCount; i++) {
    const x = p[i * 3]!;
    const y = p[i * 3 + 1]!;
    const z = p[i * 3 + 2]!;
    if (
      Math.abs(x - mx) <= maxAbsDeltaMm &&
      Math.abs(y - my) <= maxAbsDeltaMm &&
      Math.abs(z - mz) <= maxAbsDeltaMm
    ) {
      keep.push(i);
    }
  }
  if (keep.length < Math.max(8, cloud.pointCount * 0.35)) {
    return cloud;
  }
  const positions = new Float32Array(keep.length * 3);
  let o = 0;
  for (const idx of keep) {
    positions[o] = p[idx * 3]!;
    positions[o + 1] = p[idx * 3 + 1]!;
    positions[o + 2] = p[idx * 3 + 2]!;
    o += 3;
  }
  return { positions, pointCount: keep.length };
}

function pointCloudToJsonMm(cloud: PointCloud): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  const p = cloud.positions;
  for (let i = 0; i < cloud.pointCount; i++) {
    const o = i * 3;
    out.push({
      x: Math.round(p[o]! * 100) / 100,
      y: Math.round(p[o + 1]! * 100) / 100,
      z: Math.round(p[o + 2]! * 100) / 100,
    });
  }
  return out;
}

export function buildFootDesignPackageV1(input: {
  observations: ObservationData[];
  measurements: FootMeasurements;
  toeShapeKind: ToeShapeKind;
  scanDurationMs: number | null;
  sheetDimensionsMm: { width: number; height: number };
}): FootDesignPackageV1 {
  const { observations, measurements, toeShapeKind, scanDurationMs, sheetDimensionsMm } = input;

  let cloud = observationsToPointCloudMm(observations);
  cloud = filterOutliersMedianMm(cloud, 220);
  cloud = downsamplePointCloud(cloud, MAX_CLOUD_POINTS);

  const toeClassification = toeShapeKindToEnglish(toeShapeKind);
  const shoeToeBox = toeBoxParamsFromClassification(toeClassification);

  return {
    schemaVersion: PACKAGE_SCHEMA,
    createdAt: new Date().toISOString(),
    dimensionsMm: {
      length: measurements.lengthMm,
      width: measurements.widthMm,
      height: measurements.instepHeightMm,
    },
    filteredPointCloudMm: pointCloudToJsonMm(cloud),
    toeClassification,
    shoeToeBox,
    meta: {
      observationCount: observations.length,
      scanDurationMs,
      sheetDimensionsMm,
    },
  };
}

/** Chiave sessionStorage per passaggio verso Design / worker. */
export const FOOT_DESIGN_PACKAGE_STORAGE_KEY = "neuma:footDesignPackageV1";

export function persistFootDesignPackage(pkg: FootDesignPackageV1): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(FOOT_DESIGN_PACKAGE_STORAGE_KEY, JSON.stringify(pkg));
  } catch (e) {
    console.warn("[NEUMA] persistFootDesignPackage failed", e);
  }
}

export function loadFootDesignPackage(): FootDesignPackageV1 | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FOOT_DESIGN_PACKAGE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FootDesignPackageV1;
  } catch {
    return null;
  }
}
