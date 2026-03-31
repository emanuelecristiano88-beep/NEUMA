/**
 * Shared scan types — imported by ScannerCattura, FootPreview, and other
 * components. Kept in a standalone file with zero runtime dependencies to
 * prevent any circular-import / TDZ issues.
 */

export type FootId = "LEFT" | "RIGHT";

export type ScanPhaseId = 0 | 1 | 2 | 3;

export interface Metrics {
  footLengthMm: number;
  forefootWidthMm: number;
}
