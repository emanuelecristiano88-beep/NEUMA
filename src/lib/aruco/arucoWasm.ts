/**
 * Rilevamento ArUco via WASM (@ar-js-org/aruco-rs), dizionario compatibile ARuco / OpenCV “ARUCO”.
 * Inizializzazione lazy: non blocca il primo paint.
 */

import type { ArucoMarkerDetection } from "./a4MarkerGeometry";

/** Allinea al PDF guida stampa NEUMA: marker stampati DICT_4X4_50 (ID 0–3). */
export const ARUCO_DICTIONARY_NAME = "DICT_4X4_50";
const FALLBACK_DICTIONARIES = ["DICT_4X4_50", "DICT_6X6_250"] as const;

const MAX_HAMMING = 2;

let detector: import("@ar-js-org/aruco-rs").ARucoDetector | null = null;
let initPromise: Promise<void> | null = null;
const detectorByDictionary = new Map<string, import("@ar-js-org/aruco-rs").ARucoDetector>();

function detectWith(det: import("@ar-js-org/aruco-rs").ARucoDetector, width: number, height: number, rgba: Uint8Array) {
  try {
    const raw = det.detect_image(width, height, rgba);
    return normalizeDetections(raw);
  } catch {
    return [];
  }
}

function buildEnhancedRgbaVariants(imageData: ImageData): Uint8Array[] {
  const { data } = imageData;
  const variants: Uint8Array[] = [];

  // Variant 1: contrast stretch (helps low-ink print + room lighting).
  {
    const out = new Uint8Array(data.byteLength);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const c = Math.max(0, Math.min(255, (gray - 128) * 1.65 + 128));
      out[i] = c;
      out[i + 1] = c;
      out[i + 2] = c;
      out[i + 3] = a;
    }
    variants.push(out);
  }

  // Variant 2: hard threshold (helps marker borders stand out).
  {
    const out = new Uint8Array(data.byteLength);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const bw = gray > 145 ? 255 : 0;
      out[i] = bw;
      out[i + 1] = bw;
      out[i + 2] = bw;
      out[i + 3] = a;
    }
    variants.push(out);
  }

  return variants;
}

function normalizeDetections(raw: unknown): ArucoMarkerDetection[] {
  if (!Array.isArray(raw)) return [];
  const out: ArucoMarkerDetection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: number }).id;
    const corners = (item as { corners?: unknown }).corners;
    const distance = (item as { distance?: number }).distance;
    if (typeof id !== "number" || !Array.isArray(corners)) continue;
    const pts: { x: number; y: number }[] = [];
    for (const p of corners) {
      if (p && typeof p === "object" && "x" in p && "y" in p) {
        pts.push({ x: Number((p as { x: number }).x), y: Number((p as { y: number }).y) });
      }
    }
    if (pts.length >= 4) out.push({ id, distance, corners: pts });
  }
  return out;
}

/**
 * Carica WASM e crea il detector (singleton).
 */
export async function ensureArucoDetector(): Promise<import("@ar-js-org/aruco-rs").ARucoDetector> {
  if (detector) return detector;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import("@ar-js-org/aruco-rs");
      await mod.default();
      detector = new mod.ARucoDetector(ARUCO_DICTIONARY_NAME, MAX_HAMMING);
      detectorByDictionary.set(ARUCO_DICTIONARY_NAME, detector);
    })().catch((e: unknown) => {
      initPromise = null;
      throw e instanceof Error ? e : new Error(String(e));
    });
  }
  await initPromise;
  if (!detector) throw new Error("ArUco detector non inizializzato");
  return detector;
}

export function isArucoDetectorReady(): boolean {
  return detector !== null;
}

/**
 * Esegue detect su frame RGBA (es. da getImageData).
 */
export function detectArucoOnImageData(imageData: ImageData): ArucoMarkerDetection[] {
  if (!detector) return [];
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const base = detectWith(detector, width, height, rgba);
  if (base.length > 0) return base;
  const variants = buildEnhancedRgbaVariants(imageData);
  for (const v of variants) {
    const hit = detectWith(detector, width, height, v);
    if (hit.length > 0) return hit;
  }
  return [];
}

async function getDetectorForDictionary(dictionaryName: string): Promise<import("@ar-js-org/aruco-rs").ARucoDetector | null> {
  const cached = detectorByDictionary.get(dictionaryName);
  if (cached) return cached;
  try {
    const mod = await import("@ar-js-org/aruco-rs");
    await mod.default();
    const next = new mod.ARucoDetector(dictionaryName, MAX_HAMMING);
    detectorByDictionary.set(dictionaryName, next);
    return next;
  } catch {
    return null;
  }
}

/**
 * Prova più dizionari (ARUCO, 4x4, 6x6) e ritorna il primo match valido.
 */
export async function detectArucoOnImageDataMultiDictionary(
  imageData: ImageData,
  dictionaries: readonly string[] = [ARUCO_DICTIONARY_NAME, ...FALLBACK_DICTIONARIES]
): Promise<{ dictionary: string; detections: ArucoMarkerDetection[] } | null> {
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const variants = buildEnhancedRgbaVariants(imageData);
  for (const dict of dictionaries) {
    const d = await getDetectorForDictionary(dict);
    if (!d) continue;
    const detections = detectWith(d, width, height, rgba);
    if (detections.length > 0) return { dictionary: dict, detections };
    for (const v of variants) {
      const hit = detectWith(d, width, height, v);
      if (hit.length > 0) return { dictionary: dict, detections: hit };
    }
  }
  return null;
}
