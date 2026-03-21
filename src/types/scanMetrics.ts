/** Metriche biometriche per piede (da scansione / backend). */
export type FootSideMetrics = {
  lunghezzaMm: number;
  larghezzaMm: number;
  circonferenzaColloMm: number;
  volumeCm3: number;
};

/** Payload salvato in sessionStorage dopo process-scan. */
export type ScanMetricsPayload = {
  /** Media o riferimento principale */
  lunghezzaMm: number;
  larghezzaMm: number;
  volumeCm3: number;
  circonferenzaColloMm: number;
  left: FootSideMetrics;
  right: FootSideMetrics;
  scanVersion?: string;
  updatedAt: string;
};
