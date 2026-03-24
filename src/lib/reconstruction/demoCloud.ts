/**
 * Generatore di nuvola punti sintetica a forma di piede.
 * Usato per demo/parametri senza fotocamera.
 */

import type { PointCloud } from "./types";

/**
 * Genera una PointCloud sintetica che approssima la forma di un piede
 * (alluce → tallone, arco plantare, dita schematiche).
 */
export function generateDemoFootCloud(pointCount = 1800): PointCloud {
  const positions: number[] = [];

  const rng = (() => {
    let s = 0x9e3779b9;
    return () => {
      s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0);
      s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0);
      return (s >>> 0) / 0xffffffff;
    };
  })();

  // Piede: asse Z = tallone (0) → avampiede (240 mm)
  //        asse X = mediale (0) → laterale (80 mm)
  //        asse Y = pianta (0) → dorso (60 mm)
  const footL = 240;
  const footW = 80;
  const footH = 60;

  const addPoint = (x: number, y: number, z: number, noise = 1.5) => {
    positions.push(
      x + (rng() - 0.5) * noise,
      y + (rng() - 0.5) * noise,
      z + (rng() - 0.5) * noise
    );
  };

  const targetCount = pointCount;
  let n = 0;

  // --- profilo plantare ellissoidale ---
  while (n < targetCount * 0.5) {
    const t = rng(); // 0=tallone, 1=avampiede
    const u = rng() * 2 - 1; // -1..1 laterale

    // Larghezza varia con t: più stretta al tallone, più larga all'avampiede
    const wFactor = 0.45 + 0.55 * Math.sin(t * Math.PI * 0.95 + 0.05);
    const halfW = footW * 0.5 * wFactor;

    if (Math.abs(u) > 1) continue;

    const x = footW * 0.5 + u * halfW;
    const z = t * footL;

    // Altezza: arco plantare — bassa ai lati, più alta al centro
    const archRise = Math.max(0, Math.sin(t * Math.PI * 0.9 + 0.1) * (1 - Math.abs(u) * 0.7)) * footH * 0.45;
    const yBase = rng() * footH * 0.25;
    const y = yBase + archRise * rng();

    addPoint(x, y, z);
    n++;
  }

  // --- superficie dorsale ---
  while (n < targetCount * 0.8) {
    const t = rng();
    const u = rng() * 2 - 1;

    const wFactor = 0.45 + 0.55 * Math.sin(t * Math.PI * 0.95 + 0.05);
    const halfW = footW * 0.5 * wFactor;
    const x = footW * 0.5 + u * halfW * (rng() < 0.85 ? 1 : 0); // un po' di punti interni
    const z = t * footL;
    const dorsalH = footH * (0.55 + 0.35 * Math.sin(t * Math.PI));
    const y = dorsalH * (0.7 + rng() * 0.3);

    addPoint(x, y, z, 2);
    n++;
  }

  // --- dita (avampiede, z > 200) ---
  while (n < targetCount) {
    const digit = Math.floor(rng() * 5);
    const digitOffsetX = (digit - 2) * 12 + footW * 0.5;
    const digitL = 28 - digit * 3;
    const tx = rng();
    const ty = rng();

    const x = digitOffsetX + (rng() - 0.5) * 10;
    const z = footL - 20 + tx * digitL;
    const y = ty * footH * 0.4;

    addPoint(x, y, z, 1);
    n++;
  }

  const posArr = new Float32Array(positions);

  // Centra intorno all'origine (come il resto della pipeline)
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += posArr[i * 3];
    cy += posArr[i * 3 + 1];
    cz += posArr[i * 3 + 2];
  }
  cx /= n; cy /= n; cz /= n;
  for (let i = 0; i < n; i++) {
    posArr[i * 3] -= cx;
    posArr[i * 3 + 1] -= cy;
    posArr[i * 3 + 2] -= cz;
  }

  return { positions: posArr, pointCount: n };
}
