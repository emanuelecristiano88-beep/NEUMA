/**
 * Regole di design scarpa / plantare in base alla classificazione dita.
 * Consumabile dal modulo di generazione mesh (toe box, punta, offset slicer).
 */

import type { ToeShapeKind } from "@/lib/biometry/classifyToeShapeFromObservations";

export type ToeClassificationEnglish = "Greek" | "Egyptian" | "Roman" | "Unknown";

export type ToeBoxDesignParams = {
  /** Allungamento punta lungo asse piede (0–1, default neutro ~0.5). */
  elongationAlongFootAxis: number;
  /** Arrotondamento centrale (zona secondo dito) per toe box (0–1). */
  centralRoundness: number;
  /** Asimmetria medial/laterale (0 = simmetrico, 1 = forte bias laterale). */
  lateralAsymmetry: number;
  /** Smussatura / raccordo verso il bordo esterno (0–1). */
  lateralBevelWeight: number;
};

export function toeShapeKindToEnglish(kind: ToeShapeKind): ToeClassificationEnglish {
  switch (kind) {
    case "greco":
      return "Greek";
    case "egizio":
      return "Egyptian";
    case "romano":
      return "Roman";
    default:
      return "Unknown";
  }
}

/**
 * Deriva parametri toe box dalla forma dita (per mesh scarpa / offset comfort).
 * - Greek: punta più allungata e arrotondata al centro (secondo dito dominante).
 * - Egyptian: punta più asimmetrica, smussata verso l’esterno (alluce dominante).
 * - Roman: profilo neutro, tre dita equivalenti.
 */
export function toeBoxParamsFromClassification(
  english: ToeClassificationEnglish,
): ToeBoxDesignParams {
  switch (english) {
    case "Greek":
      return {
        elongationAlongFootAxis: 0.88,
        centralRoundness: 0.92,
        lateralAsymmetry: 0.32,
        lateralBevelWeight: 0.42,
      };
    case "Egyptian":
      return {
        elongationAlongFootAxis: 0.52,
        centralRoundness: 0.44,
        lateralAsymmetry: 0.86,
        lateralBevelWeight: 0.78,
      };
    case "Roman":
      return {
        elongationAlongFootAxis: 0.5,
        centralRoundness: 0.52,
        lateralAsymmetry: 0.48,
        lateralBevelWeight: 0.5,
      };
    default:
      return {
        elongationAlongFootAxis: 0.52,
        centralRoundness: 0.5,
        lateralAsymmetry: 0.5,
        lateralBevelWeight: 0.52,
      };
  }
}
