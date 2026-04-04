import { useEffect, useRef, useState } from "react";

export type ScanFrameTilt = {
  /** Gradi — inclinazione “avanti/indietro” rispetto alla verticale */
  rotateX: number;
  /** Gradi — rollio leggero */
  rotateY: number;
  /** Gradi — rotazione piano schermo (gamma) */
  rotateZ: number;
  /**
   * Gamma W3C grezzo (°), tipicamente −90…+90 in portrait — rollio sinistra/destra.
   * Non passa dal LERP: serve al guard parallasse (|gamma| > soglia → pausa scan).
   */
  rawGammaDeg: number | null;
  /** Beta grezzo (°) — opzionale, per telemetria / fallback. */
  rawBetaDeg: number | null;
};

/** Allineato al tracking overlay foglio (0.08–0.15 = movimento morbido per frame) */
const LERP = 0.1;

/**
 * Angoli derivati da DeviceOrientation per far “seguire” il rettangolo guida al telefono
 * (effetto simile alle app di scansione documenti).
 */
export function useScanFrameOrientation(enabled: boolean): ScanFrameTilt {
  const [tilt, setTilt] = useState<ScanFrameTilt>({
    rotateX: 0, rotateY: 0, rotateZ: 0, rawGammaDeg: null, rawBetaDeg: null,
  });
  const smoothed = useRef({ rotateX: 0, rotateY: 0, rotateZ: 0 });
  const target   = useRef({ rotateX: 0, rotateY: 0, rotateZ: 0 });
  /** Ultimo gamma/beta da DeviceOrientation (non filtrati). */
  const rawOrientationRef = useRef<{ gamma: number | null; beta: number | null }>({
    gamma: null, beta: null,
  });
  /**
   * Stima gamma da accelerometro (DeviceMotion) quando l’orientation è assente o
   * incompleta — approssimazione portrait, utile su alcuni Android.
   */
  const rawAccelGammaRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      const zero = { rotateX: 0, rotateY: 0, rotateZ: 0 };
      smoothed.current = zero;
      target.current   = zero;
      rawOrientationRef.current = { gamma: null, beta: null };
      rawAccelGammaRef.current  = null;
      setTilt({
        rotateX: 0, rotateY: 0, rotateZ: 0, rawGammaDeg: null, rawBetaDeg: null,
      });
      return;
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      const beta  = e.beta;
      const gamma = e.gamma;
      const alpha = e.alpha;
      if (beta == null || gamma == null) return;

      rawOrientationRef.current = { gamma, beta };

      // Ritratto: beta ~90°, gamma ~0° = telefono dritto verso il piede
      const rx = Math.max(-22, Math.min(22, (beta - 90) * 0.48));
      const rz = Math.max(-28, Math.min(28, gamma * 0.42));
      let ry = 0;
      if (alpha != null) {
        const a = alpha > 180 ? alpha - 360 : alpha;
        ry = Math.max(-12, Math.min(12, a * 0.03));
      }
      target.current = { rotateX: rx, rotateY: ry, rotateZ: rz };
    };

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const ax = a.x;
      const ay = a.y;
      const az = a.z;
      // Portrait, schermo verso l’utente: rollio sinistra/destra ~ atan2(ax, piano yz)
      const denom = Math.sqrt(ay * ay + az * az) || 1e-6;
      rawAccelGammaRef.current = (Math.atan2(ax, denom) * 180) / Math.PI;
    };

    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("devicemotion", onMotion, true);

    const loop = () => {
      const s = smoothed.current;
      const t = target.current;
      s.rotateX += (t.rotateX - s.rotateX) * LERP;
      s.rotateY += (t.rotateY - s.rotateY) * LERP;
      s.rotateZ += (t.rotateZ - s.rotateZ) * LERP;

      const og = rawOrientationRef.current.gamma;
      const ob = rawOrientationRef.current.beta;
      const rawG = og != null ? og : rawAccelGammaRef.current;

      setTilt({
        rotateX:     s.rotateX,
        rotateY:     s.rotateY,
        rotateZ:     s.rotateZ,
        rawGammaDeg: rawG,
        rawBetaDeg:  ob,
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("deviceorientation", onOrientation, true);
      window.removeEventListener("devicemotion", onMotion, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  return tilt;
}
