import * as THREE from "three";
import type { PointCloud } from "@/lib/reconstruction/types";
import {
  buildFootSurfaceFromPositions,
  laplacianSmoothGeometry,
  DEFAULT_FOOT_SURFACE_OPTIONS,
  type FootSurfaceOptions,
} from "@/lib/reconstruction/footSurfaceMesh";
import { downsamplePointCloud } from "./downsamplePointCloud";
import {
  augmentPointCloudForWatertightMesh,
  type WatertightPointCloudFillOptions,
} from "@/lib/reconstruction/watertightPointCloudFill";
import {
  applyFootwearMeshBedAlignment,
  applyFootwearPointCloudPrep,
  DEFAULT_FOOTWEAR_MESH_BED_OPTIONS,
  DEFAULT_FOOTWEAR_PREP_OPTIONS,
  type FootwearMeshBedOptions,
  type FootwearPrepOptions,
} from "@/lib/reconstruction/footwearInsolePrep";

export type { FootwearMeshBedOptions, FootwearPrepOptions, FootwearVerticalConvention } from "@/lib/reconstruction/footwearInsolePrep";

type PremiumMeshOptions = {
  /** Picco per limitare rumore/aliasing nella ricostruzione (UI only). */
  maxDownsamplePoints?: number;
  /** Risoluzione “voxel grid” per marching cubes (più bassa = più robusta). */
  voxelGridResolution?: number;
  /** Smoothing aggiuntivo dopo la prima laplacian (anti sharp artifacts). */
  extraSmoothIterations?: number;
  extraSmoothLambda?: number;
  /** Rimuove isole piccole tenendo solo la componente con più triangoli. */
  keepLargestComponent?: boolean;
  /**
   * Se true (default), aggiunge punti sintetici nelle tasche (IDW dai vicini) prima
   * dei metaball + Marching Cubes — mesh più chiusa per slicer (Bambu, ecc.).
   */
  watertightGapFill?: boolean;
  watertightFillOptions?: Partial<WatertightPointCloudFillOptions>;
  /**
   * Calzatura / plantare: offset comfort, piano foglio, smoothing pelle, base piatta in mesh.
   * `false` disattiva. Default: attivo (come richiesto per TPU / slicer).
   */
  footwear?: boolean | Partial<FootwearPrepOptions>;
  /** Override allineamento mesh dopo MC (piano foglio, snap suola). */
  footwearMeshBed?: Partial<FootwearMeshBedOptions>;
  /**
   * 1 = coordinate in mm (nuvola ricostruzione). 0.001 = metri (preview Three con mmToWorld).
   */
  footwearLinearUnitToMm?: number;
  /** Iterazioni Laplaciano mesh extra quando footwear è attivo (TPU). */
  footwearExtraMeshSmoothIterations?: number;
};

function resolveFootwearPrep(
  footwear: PremiumMeshOptions["footwear"],
  defaultLinearUnitToMm: number,
): FootwearPrepOptions | null {
  if (footwear === false) return null;
  const partial = footwear === true || footwear === undefined ? {} : footwear;
  if (partial.enabled === false) return null;
  return {
    ...DEFAULT_FOOTWEAR_PREP_OPTIONS,
    ...partial,
    enabled: true,
    linearUnitToMm: partial.linearUnitToMm ?? defaultLinearUnitToMm,
  };
}

function keepLargestConnectedTriangleComponent(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = geometry.index;
  if (!idx) return geometry;

  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!posAttr) return geometry;

  const indexArray = idx.array as ArrayLike<number>;
  const indexCount = idx.count;
  const triCount = Math.floor(indexCount / 3);
  if (triCount <= 1) return geometry;

  const vertexCount = posAttr.count;
  const vertexToFaces = new Map<number, number[]>();

  const pushFace = (v: number, f: number) => {
    let arr = vertexToFaces.get(v);
    if (!arr) {
      arr = [];
      vertexToFaces.set(v, arr);
    }
    arr.push(f);
  };

  for (let f = 0; f < triCount; f++) {
    const a = indexArray[f * 3]!;
    const b = indexArray[f * 3 + 1]!;
    const c = indexArray[f * 3 + 2]!;
    pushFace(a, f);
    pushFace(b, f);
    pushFace(c, f);
  }

  const visited = new Uint8Array(triCount);
  let bestFaces: number[] = [];

  for (let f = 0; f < triCount; f++) {
    if (visited[f]) continue;
    const comp: number[] = [];
    const q: number[] = [f];
    visited[f] = 1;

    while (q.length) {
      const cur = q.pop()!;
      comp.push(cur);
      const a = indexArray[cur * 3]!;
      const b = indexArray[cur * 3 + 1]!;
      const c = indexArray[cur * 3 + 2]!;
      for (const v of [a, b, c]) {
        const neighFaces = vertexToFaces.get(v);
        if (!neighFaces) continue;
        for (const nf of neighFaces) {
          if (visited[nf]) continue;
          visited[nf] = 1;
          q.push(nf);
        }
      }
    }

    if (comp.length > bestFaces.length) bestFaces = comp;
  }

  if (bestFaces.length === triCount) return geometry;

  const keptVertexSet = new Set<number>();
  for (const f of bestFaces) {
    keptVertexSet.add(indexArray[f * 3]!);
    keptVertexSet.add(indexArray[f * 3 + 1]!);
    keptVertexSet.add(indexArray[f * 3 + 2]!);
  }

  const keptVertices = Array.from(keptVertexSet.values());
  const oldToNew = new Int32Array(vertexCount);
  oldToNew.fill(-1);
  for (let i = 0; i < keptVertices.length; i++) {
    oldToNew[keptVertices[i]!] = i;
  }
  const newVertexCount = keptVertices.length;

  const useUint32 = newVertexCount > 65535;
  const newIndexArr = useUint32
    ? new Uint32Array(bestFaces.length * 3)
    : new Uint16Array(bestFaces.length * 3);

  let w = 0;
  for (const f of bestFaces) {
    newIndexArr[w++] = oldToNew[indexArray[f * 3]!];
    newIndexArr[w++] = oldToNew[indexArray[f * 3 + 1]!];
    newIndexArr[w++] = oldToNew[indexArray[f * 3 + 2]!];
  }

  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setIndex(new THREE.BufferAttribute(newIndexArr, 1));

  const newPositions = new Float32Array(newVertexCount * 3);
  const oldPositions = posAttr.array as Float32Array;
  for (const oldV of keptVertices) {
    const nv = oldToNew[oldV]!;
    newPositions[nv * 3] = oldPositions[oldV * 3]!;
    newPositions[nv * 3 + 1] = oldPositions[oldV * 3 + 1]!;
    newPositions[nv * 3 + 2] = oldPositions[oldV * 3 + 2]!;
  }
  newGeometry.setAttribute("position", new THREE.BufferAttribute(newPositions, 3));

  const normalsAttr = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (normalsAttr) {
    const oldNormals = normalsAttr.array as Float32Array;
    const newNormals = new Float32Array(newVertexCount * 3);
    for (const oldV of keptVertices) {
      const nv = oldToNew[oldV]!;
      newNormals[nv * 3] = oldNormals[oldV * 3]!;
      newNormals[nv * 3 + 1] = oldNormals[oldV * 3 + 1]!;
      newNormals[nv * 3 + 2] = oldNormals[oldV * 3 + 2]!;
    }
    newGeometry.setAttribute("normal", new THREE.BufferAttribute(newNormals, 3));
  } else {
    newGeometry.computeVertexNormals();
  }

  // Mantieni bounds (utile per centrare/controllare) — tre se ne occupa in render.
  newGeometry.computeBoundingBox();
  return newGeometry;
}

export function buildPremiumFootDisplayMeshFromPointCloud(
  cloud: PointCloud,
  options: PremiumMeshOptions = {}
): THREE.BufferGeometry | null {
  const {
    maxDownsamplePoints = 6000,
    voxelGridResolution = 38,
    extraSmoothIterations = 2,
    extraSmoothLambda = 0.35,
    keepLargestComponent = true,
    watertightGapFill = true,
    watertightFillOptions,
    footwear,
    footwearMeshBed,
    footwearLinearUnitToMm = 1,
    footwearExtraMeshSmoothIterations = 1,
  } = options;

  const ds = downsamplePointCloud(cloud, maxDownsamplePoints);
  const { positions, pointCount } = ds;
  if (pointCount < 8) return null;

  const surfaceOptions: Partial<FootSurfaceOptions> = {
    ...DEFAULT_FOOT_SURFACE_OPTIONS,
    ...{
      // Risoluzione “voxel grid” per marching cubes: più bassa = mesh più pulita/robusta.
      resolution: Math.min(DEFAULT_FOOT_SURFACE_OPTIONS.resolution, voxelGridResolution),
      // Limita sorgenti per ridurre rumore spezzato nella scalabilità.
      maxSourcePoints: Math.min(DEFAULT_FOOT_SURFACE_OPTIONS.maxSourcePoints, 2400),
      // Smoothing già dentro buildFootSurfaceFromPositions; qui aggiungiamo un passaggio extra.
      smoothIterations: Math.max(4, DEFAULT_FOOT_SURFACE_OPTIONS.smoothIterations),
    },
  };

  return buildPremiumFootDisplayMeshFromPositions(positions, pointCount, {
    voxelGridResolution,
    extraSmoothIterations,
    extraSmoothLambda,
    keepLargestComponent,
    watertightGapFill,
    watertightFillOptions,
    footwear,
    footwearMeshBed,
    footwearLinearUnitToMm,
    footwearExtraMeshSmoothIterations,
  });
}

export function buildPremiumFootDisplayMeshFromPositions(
  positions: Float32Array,
  pointCount: number,
  options: Omit<PremiumMeshOptions, "maxDownsamplePoints"> & { surfaceOptions?: Partial<FootSurfaceOptions> } = {}
): THREE.BufferGeometry | null {
  const {
    voxelGridResolution = 38,
    extraSmoothIterations = 2,
    extraSmoothLambda = 0.35,
    keepLargestComponent = true,
    watertightGapFill = true,
    watertightFillOptions,
    footwear,
    footwearMeshBed,
    footwearLinearUnitToMm = 0.001,
    footwearExtraMeshSmoothIterations = 1,
    surfaceOptions,
  } = options;

  if (pointCount < 8) return null;

  const filled =
    watertightGapFill !== false
      ? augmentPointCloudForWatertightMesh(positions, pointCount, watertightFillOptions)
      : { positions, pointCount, syntheticAdded: 0 };

  const footwearPrep = resolveFootwearPrep(footwear, footwearLinearUnitToMm);
  const shoeCloud = footwearPrep
    ? applyFootwearPointCloudPrep(filled.positions, filled.pointCount, footwearPrep)
    : filled;

  const effectiveSurfaceOptions: Partial<FootSurfaceOptions> = surfaceOptions
    ? {
        ...surfaceOptions,
        resolution: Math.min(surfaceOptions.resolution ?? DEFAULT_FOOT_SURFACE_OPTIONS.resolution, voxelGridResolution),
        ...(footwearPrep ? { finalNormalize: "skip" as const } : {}),
      }
    : {
        ...DEFAULT_FOOT_SURFACE_OPTIONS,
        ...{
          resolution: Math.min(DEFAULT_FOOT_SURFACE_OPTIONS.resolution, voxelGridResolution),
          maxSourcePoints: Math.min(DEFAULT_FOOT_SURFACE_OPTIONS.maxSourcePoints, 2400),
          smoothIterations: Math.max(4, DEFAULT_FOOT_SURFACE_OPTIONS.smoothIterations),
          ...(footwearPrep ? { finalNormalize: "skip" as const } : {}),
        },
      };

  const geom = buildFootSurfaceFromPositions(
    shoeCloud.positions,
    shoeCloud.pointCount,
    effectiveSurfaceOptions,
  );
  if (!geom) return null;

  const extraIt =
    extraSmoothIterations + (footwearPrep ? footwearExtraMeshSmoothIterations : 0);
  const smoothed = laplacianSmoothGeometry(geom, extraIt, extraSmoothLambda);

  let out: THREE.BufferGeometry = smoothed;
  if (keepLargestComponent) {
    const cleaned = keepLargestConnectedTriangleComponent(smoothed);
    if (cleaned !== smoothed) smoothed.dispose();
    out = cleaned;
  }

  if (footwearPrep) {
    const bed: FootwearMeshBedOptions = {
      ...DEFAULT_FOOTWEAR_MESH_BED_OPTIONS,
      ...footwearMeshBed,
      verticalConvention: footwearPrep.verticalConvention,
      sheetPlane: footwearPrep.sheetPlane,
    };
    applyFootwearMeshBedAlignment(out, bed);
  }

  return out;
}

