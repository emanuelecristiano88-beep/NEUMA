/**
 * Overlay 2s post-scan: rete wireframe (Delaunay XZ) proiettata sul video live.
 * La pose segue ArUco se ≥4 marker, altrimenti l’ultima osservazione mirino.
 */

import React, { useEffect, useRef } from "react";
import type { OpenCvArucoQuad } from "@/hooks/useOpenCvArucoAnalysis";
import {
  cameraPoseFromObservation,
  estimateCameraIntrinsics,
  estimatePoseFromQuads,
  projectPoint3D,
  type CameraPose,
  type ObservationData,
} from "@/lib/aruco/poseEstimation";
import { generatePreviewMesh } from "@/lib/scanner/generatePreviewMesh";

type V3 = [number, number, number];

const FLASH_LINE = "rgba(56, 218, 255, 0.42)";
const FLASH_LINE_CORE = "rgba(200, 245, 255, 0.55)";

interface Props {
  visible: boolean;
  worldPoints: V3[];
  lastObservation: ObservationData;
  markerQuads: OpenCvArucoQuad[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function FootScanMeshFlashOverlay({
  visible,
  worldPoints,
  lastObservation,
  markerQuads,
  videoRef,
  containerRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edgesRef = useRef<[number, number][] | null>(null);

  useEffect(() => {
    if (!visible || worldPoints.length < 2) {
      edgesRef.current = null;
      return;
    }
    edgesRef.current = generatePreviewMesh(worldPoints).edges;
  }, [visible, worldPoints]);

  useEffect(() => {
    if (!visible) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;

    const frame = () => {
      const parent = containerRef.current;
      const video = videoRef.current;
      if (!parent || !canvas) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w <= 0 || h <= 0) {
        raf = requestAnimationFrame(frame);
        return;
      }

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const edges = edgesRef.current;
      const K = estimateCameraIntrinsics(w, h);

      let pose: CameraPose | null = null;
      const vw = video?.videoWidth ?? 0;
      const vh = video?.videoHeight ?? 0;
      if (markerQuads.length >= 4 && vw > 0 && vh > 0) {
        pose = estimatePoseFromQuads(markerQuads, vw, vh, w, h, K);
      }
      if (!pose) {
        pose = cameraPoseFromObservation(lastObservation);
      }

      const proj: ([number, number] | null)[] = worldPoints.map((p) =>
        projectPoint3D(p, pose!, K),
      );

      ctx.clearRect(0, 0, w, h);

      if (edges && edges.length > 0) {
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.strokeStyle = FLASH_LINE;
        ctx.beginPath();
        for (const [ia, ib] of edges) {
          const pa = proj[ia];
          const pb = proj[ib];
          if (!pa || !pb) continue;
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
        }
        ctx.stroke();

        ctx.strokeStyle = FLASH_LINE_CORE;
        ctx.lineWidth = 0.85;
        ctx.beginPath();
        for (const [ia, ib] of edges) {
          const pa = proj[ia];
          const pb = proj[ib];
          if (!pa || !pb) continue;
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
        }
        ctx.stroke();
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [visible, worldPoints, lastObservation, markerQuads, videoRef, containerRef]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 64, width: "100%", height: "100%" }}
    />
  );
}
