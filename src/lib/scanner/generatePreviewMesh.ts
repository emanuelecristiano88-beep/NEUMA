/**
 * Anteprima mesh wireframe dalla nuvola punti (world Y-up, foglio XZ).
 *
 * Delaunay 2D sul piano XZ del foglio: triangoli nel piano orizzontale, spigoli
 * come segmenti 3D tra i punti catturati — adatto al volume “a cupola” sopra l’A4.
 */

export type PreviewMeshWire = {
  /** Coppie di indici nella nuvola in input (i < j). */
  edges: [number, number][];
};

type Pt2 = [number, number];
type Tri = [number, number, number];

function triEqual(a: Tri, b: Tri): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function circumcircleContains(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const d =
    2 *
    (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  if (Math.abs(d) < 1e-20) return false;

  const a2 = ax * ax + az * az;
  const b2 = bx * bx + bz * bz;
  const c2 = cx * cx + cz * cz;
  const ux = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / d;
  const uz = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const dx = ax - ux;
  const dz = az - uz;
  const r2 = dx * dx + dz * dz;
  const ex = px - ux;
  const ez = pz - uz;
  return ex * ex + ez * ez < r2 - 1e-14;
}

function edgeKey(i: number, j: number): string {
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  return `${lo},${hi}`;
}

/**
 * Delaunay (Bowyer–Watson) su coordinate (x, z), poi spigoli unici.
 */
function delaunayEdgesFromXZ(pts2: Pt2[]): [number, number][] {
  const n = pts2.length;
  if (n < 3) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts2) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-5);
  const R = span * 4;

  const all: Pt2[] = [
    ...pts2,
    [midX - 2 * R, midZ - R],
    [midX + 2 * R, midZ - R],
    [midX, midZ + 2 * R],
  ];
  const st0 = n;
  const st1 = n + 1;
  const st2 = n + 2;

  let triangles: Tri[] = [[st0, st1, st2]];

  for (let pi = 0; pi < n; pi++) {
    const px = all[pi]![0];
    const pz = all[pi]![1];
    const bad: Tri[] = [];
    for (const tri of triangles) {
      const [a, b, c] = tri;
      if (
        circumcircleContains(
          px,
          pz,
          all[a]![0],
          all[a]![1],
          all[b]![0],
          all[b]![1],
          all[c]![0],
          all[c]![1],
        )
      ) {
        bad.push(tri);
      }
    }

    const edgeFreq = new Map<string, number>();
    for (const tri of bad) {
      const es: [number, number][] = [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ];
      for (const [u, v] of es) {
        const k = edgeKey(u, v);
        edgeFreq.set(k, (edgeFreq.get(k) ?? 0) + 1);
      }
    }

    const boundary: [number, number][] = [];
    for (const [k, cnt] of edgeFreq) {
      if (cnt === 1) {
        const [lo, hi] = k.split(",").map(Number) as [number, number];
        boundary.push([lo, hi]);
      }
    }

    triangles = triangles.filter((t) => !bad.some((b) => triEqual(t, b)));
    for (const [u, v] of boundary) {
      triangles.push([u, v, pi]);
    }
  }

  const trisFinal = triangles.filter(
    (t) => t[0] < n && t[1] < n && t[2] < n,
  );
  const edgeSet = new Set<string>();
  for (const tri of trisFinal) {
    edgeSet.add(edgeKey(tri[0], tri[1]));
    edgeSet.add(edgeKey(tri[1], tri[2]));
    edgeSet.add(edgeKey(tri[2], tri[0]));
  }
  return [...edgeSet].map((k) => {
    const [a, b] = k.split(",").map(Number) as [number, number];
    return [a, b] as [number, number];
  });
}

/**
 * Collega i punti della nuvola con una triangolazione di Delaunay sul piano XZ
 * (proiezione orizzontale sul foglio). Restituisce solo gli spigoli come coppie
 * di indici rispetto all’array `pointsWorld` passato.
 */
export function generatePreviewMesh(
  pointsWorld: [number, number, number][],
): PreviewMeshWire {
  const n = pointsWorld.length;
  if (n < 2) return { edges: [] };
  if (n === 2) return { edges: [[0, 1]] };

  const pts2: Pt2[] = pointsWorld.map((p, i) => {
    // Evita degeneri se due punti hanno la stessa proiezione XZ
    const ε = (i % 11) * 1e-8;
    return [p[0] + ε, p[2] + ε * 0.7] as Pt2;
  });

  const edges = delaunayEdgesFromXZ(pts2);
  return { edges: edges.length > 0 ? edges : convexHullEdgesXZ(pts2) };
}

/** Fallback se Delaunay non produce spigoli (es. punti quasi collineari su XZ). */
function convexHullEdgesXZ(pts: Pt2[]): [number, number][] {
  const n = pts.length;
  if (n < 2) return [];
  if (n === 2) return [[0, 1]];

  const order = pts.map((_, i) => i).sort((i, j) => {
    const dx = pts[i]![0] - pts[j]![0];
    if (dx !== 0) return dx;
    return pts[i]![1] - pts[j]![1];
  });

  const cross = (o: number, a: number, b: number): number =>
    (pts[a]![0] - pts[o]![0]) * (pts[b]![1] - pts[o]![1]) -
    (pts[a]![1] - pts[o]![1]) * (pts[b]![0] - pts[o]![0]);

  const lower: number[] = [];
  for (const i of order) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, i) <= 0) {
      lower.pop();
    }
    lower.push(i);
  }

  const upper: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, i) <= 0) {
      upper.pop();
    }
    upper.push(i);
  }

  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 2) return [[0, 1]];

  const edges: [number, number][] = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    edges.push(a < b ? [a, b] : [b, a]);
  }
  return edges;
}
