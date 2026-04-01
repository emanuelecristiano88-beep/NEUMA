/**
 * 4-point planar homography via Direct Linear Transform (DLT).
 *
 * Solves the 8×8 linear system that arises from 4 point correspondences
 * src[i] ↔ dst[i] using Gauss-Jordan elimination with partial pivoting.
 *
 * The homography H is a 3×3 matrix (9 elements, row-major) such that:
 *   [w·u, w·v, w]^T = H · [x, y, 1]^T
 *
 * This is the pure-JS replacement for cv.findHomography / getPerspectiveTransform.
 */

// ─── Internal: 8×8 Gauss-Jordan solver ───────────────────────────────────────

/**
 * Solves Ax = b for exactly 8 unknowns using reduced row echelon form.
 * Partial pivoting for numerical stability.
 * Returns null when the system is degenerate (collinear points, etc.).
 */
function gaussJordan8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  // Augmented matrix [A | b]
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Find the row with the largest absolute value in this column (partial pivot)
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) return null; // degenerate

    // Normalise the pivot row so M[col][col] = 1
    for (let k = col; k <= n; k++) M[col][k] /= pivot;

    // Eliminate this column from every other row
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }

  // The solution is in the last column of the augmented matrix
  return M.map((row) => row[n]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the 3×3 homography H (9 elements, row-major) from exactly 4
 * corresponding point pairs.
 *
 * @param src  4 source points [[x, y], …]  — e.g. physical sheet XZ coords (metres)
 * @param dst  4 destination points [[u, v], …] — e.g. image pixel positions
 * @returns    H as a flat 9-element row-major array, or null if degenerate
 */
export function computeHomography4(
  src: [number, number][],
  dst: [number, number][],
): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i];
    const [u, v] = dst[i];
    // For u: [X, Y, 1, 0, 0, 0, -u·X, -u·Y] · h = u  (h33 = 1)
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]);
    b.push(u);
    // For v: [0, 0, 0, X, Y, 1, -v·X, -v·Y] · h = v
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]);
    b.push(v);
  }

  const h = gaussJordan8(A, b);
  if (!h) return null;
  return [...h, 1]; // h[0..7] from solver, h[8] = 1 (h33 fixed)
}

/**
 * Apply homography H to a single point [x, y] → [u, v].
 * H is a 9-element row-major array.
 */
export function applyHomography(
  H: number[],
  x: number,
  y: number,
): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-9) return [0, 0];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/**
 * Sort 4 points into TL / TR / BL / BR order (by image y then x).
 * Returns indices into the original array: [iTL, iTR, iBL, iBR].
 */
export function sortCornerIndices(pts: [number, number][]): [number, number, number, number] {
  const byY = [...pts.keys()].sort((a, b) => pts[a][1] - pts[b][1]);
  const top = byY.slice(0, 2).sort((a, b) => pts[a][0] - pts[b][0]);
  const bot = byY.slice(2).sort((a, b) => pts[a][0] - pts[b][0]);
  return [top[0], top[1], bot[0], bot[1]]; // TL TR BL BR
}
