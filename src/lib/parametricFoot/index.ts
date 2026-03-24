export type {
  ArchHeight,
  FootVolume,
  ToeShape,
  FootParameters,
  ScanMeasurements,
  FootBlob,
  ParametricFootResult,
} from "./types";
export { DEFAULT_FOOT_PARAMETERS } from "./types";

export { generateControlPoints } from "./controlPoints";

export type { MeshBuilderOptions } from "./meshBuilder";
export { buildParametricFootGeometry, DEFAULT_MESH_BUILDER_OPTIONS } from "./meshBuilder";

export { applyArchDeformation, applyHeelDeformation } from "./deform";

export { extractFootParameters, measurementsFromBiometryPoints } from "./extractParameters";
