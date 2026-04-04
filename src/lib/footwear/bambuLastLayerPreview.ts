/**
 * Geometria sintetica “ultimo layer” (stile anteprima G-code / Bambu)
 * derivata da L/W e dai parametri toe box — non è G-code reale.
 */

import type { ToeBoxDesignParams } from "@/lib/footwear/toeBoxDesignRules";
import type { ToeClassificationEnglish } from "@/lib/footwear/toeBoxDesignRules";

function pathFromPoints(pts: { x: number; y: number }[], close: boolean): string {
  if (!pts.length) return "";
  const d = [`M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`];
  for (let i = 1; i < pts.length; i++) {
    d.push(`L ${pts[i]!.x.toFixed(2)} ${pts[i]!.y.toFixed(2)}`);
  }
  if (close) d.push("Z");
  return d.join(" ");
}

function shrinkTowardCenter(
  pts: { x: number; y: number }[],
  cx: number,
  cy: number,
  scale: number,
): { x: number; y: number }[] {
  return pts.map((p) => ({
    x: cx + (p.x - cx) * scale,
    y: cy + (p.y - cy) * scale,
  }));
}

export type BambuLayerPreviewPaths = {
  outer: string;
  inner: string;
  travel: string;
  viewBox: string;
};

/**
 * Genera path SVG per contorno esterno / percorso interno (offset) e una “travel move” sintetica.
 */
export function buildBambuStyleLastLayerPaths(input: {
  lengthMm: number;
  widthMm: number;
  toeBox: ToeBoxDesignParams;
  toeClassification: ToeClassificationEnglish;
}): BambuLayerPreviewPaths {
  const { lengthMm, widthMm, toeBox, toeClassification } = input;
  const ar = Math.max(0.55, Math.min(1.45, lengthMm / Math.max(widthMm, 1)));
  const cx = 100;
  const cy = 70;
  const rxBase = 38 * Math.min(1.15, ar * 0.55);
  const ryBase = 26;

  const elong = toeBox.elongationAlongFootAxis;
  const roundC = toeBox.centralRoundness;
  const asym = toeBox.lateralAsymmetry;
  const bev = toeBox.lateralBevelWeight;

  const N = 80;
  const pts: { x: number; y: number }[] = [];

  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const front = cos > 0.15;

    let rx = rxBase * (0.82 + 0.28 * Math.abs(sin));
    let ry = ryBase;

    if (front) {
      rx *= 1.05 + 0.42 * elong;
      const centerBump = roundC * 11 * Math.cos(ang) ** 2 * (toeClassification === "Greek" ? 1.08 : 0.75);
      rx += centerBump;

      if (toeClassification === "Egyptian" || asym > 0.65) {
        ry += asym * 7 * (sin > 0 ? 1 : -0.35) * bev;
        rx += asym * 5 * sin;
      }
    }

    const p = { x: cx + rx * cos, y: cy + ry * sin };

    if (toeClassification === "Greek" && front) {
      p.x += roundC * 6 * Math.cos(ang * 2);
    }

    pts.push(p);
  }

  const innerPts = shrinkTowardCenter(pts, cx, cy, 0.87);
  const outerPath = pathFromPoints(pts, true);
  const innerPath = pathFromPoints(innerPts, true);

  const t0 = pts[Math.floor(N * 0.72)]!;
  const t1 = pts[Math.floor(N * 0.88)]!;
  const travel = `M ${t0.x.toFixed(2)} ${t0.y.toFixed(2)} L ${t1.x.toFixed(2)} ${t1.y.toFixed(2)}`;

  return {
    outer: outerPath,
    inner: innerPath,
    travel,
    viewBox: "28 28 144 88",
  };
}
