export {
  estimateRelativeDepthNormalized,
  normalizeDepth01,
} from "./depthEstimation";
export type { DepthBackend } from "./depthEstimation";

export { extractFootMask, extractFootMaskAi } from "./segmentFoot";
export { depthMapToPointCloud } from "./depthToPointCloud";
export { transformPointByPhase, phaseGroup } from "./phaseAlignment";
export { mergePointCloudsVoxelAverage } from "./mergePointClouds";
export { alignPointCloudsMultiView } from "./multiViewAlign";
export type { MultiViewAlignOptions, PerViewCloud } from "./multiViewAlign";
export { downscaleImageDataMaxSide } from "./imageResize";

export {
  reconstructFootFromCapturedViews,
  reconstructFootFromBlobs,
  blobToImageData,
} from "./pipeline";

export type {
  Vec3,
  PointCloud,
  CapturedView,
  ReconstructionOptions,
  ReconstructionResult,
} from "./types";
export { DEFAULT_RECONSTRUCTION_OPTIONS } from "./types";

export {
  buildFootSurfaceFromPositions,
  laplacianSmoothGeometry,
  centerAndNormalizeFootMesh,
  deformFootGeometry,
  DEFAULT_FOOT_SURFACE_OPTIONS,
  DEFAULT_FOOT_DEFORM_OPTIONS,
} from "./footSurfaceMesh";
export type { FootSurfaceOptions, FootDeformOptions } from "./footSurfaceMesh";
