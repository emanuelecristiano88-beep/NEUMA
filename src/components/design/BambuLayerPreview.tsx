"use client";

import React, { useMemo } from "react";
import { buildBambuStyleLastLayerPaths } from "@/lib/footwear/bambuLastLayerPreview";
import type { ToeBoxDesignParams } from "@/lib/footwear/toeBoxDesignRules";
import type { ToeClassificationEnglish } from "@/lib/footwear/toeBoxDesignRules";

export type BambuLayerPreviewProps = {
  lengthMm: number;
  widthMm: number;
  toeBox: ToeBoxDesignParams;
  toeClassification: ToeClassificationEnglish;
  className?: string;
};

/**
 * Anteprima sintetica “ultimo layer” (stile slicer / Bambu): contorni + travel move.
 * Non legge G-code reale — geometria derivata da L/W e regole toe box.
 */
export function BambuLayerPreview({
  lengthMm,
  widthMm,
  toeBox,
  toeClassification,
  className,
}: BambuLayerPreviewProps) {
  const paths = useMemo(
    () =>
      buildBambuStyleLastLayerPaths({
        lengthMm,
        widthMm,
        toeBox,
        toeClassification,
      }),
    [lengthMm, widthMm, toeBox, toeClassification],
  );

  return (
    <div
      className={className}
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.1)",
        background:
          "linear-gradient(180deg, rgba(12,18,32,0.95) 0%, rgba(6,10,20,0.98) 100%), repeating-linear-gradient(90deg, transparent, transparent 9px, rgba(255,255,255,0.03) 9px, rgba(255,255,255,0.03) 10px), repeating-linear-gradient(0deg, transparent, transparent 9px, rgba(255,255,255,0.03) 9px, rgba(255,255,255,0.03) 10px)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          style={{
            fontFamily: "ui-monospace, 'SF Mono', monospace",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.45)",
            textTransform: "uppercase",
          }}
        >
          Bambu · Layer preview
        </span>
        <span style={{ fontSize: 10, color: "rgba(56,189,248,0.75)", fontWeight: 600 }}>Z = 0.00 mm</span>
      </div>
      <div style={{ padding: "12px 16px 16px" }}>
        <svg
          viewBox={paths.viewBox}
          width="100%"
          height={220}
          style={{ display: "block", maxHeight: 240 }}
          aria-label="Anteprima percorso ultimo layer"
        >
          <path
            d={paths.outer}
            fill="rgba(56,189,248,0.07)"
            stroke="rgba(147,224,255,0.92)"
            strokeWidth={1.15}
            strokeLinejoin="round"
          />
          <path
            d={paths.inner}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={0.85}
            strokeDasharray="3 2"
            strokeLinejoin="round"
          />
          <path
            d={paths.travel}
            fill="none"
            stroke="rgba(251,191,36,0.75)"
            strokeWidth={0.7}
            strokeDasharray="4 3"
            strokeLinecap="round"
          />
        </svg>
        <p
          style={{
            marginTop: 10,
            fontFamily: "ui-rounded, -apple-system, sans-serif",
            fontSize: 11,
            color: "rgba(255,255,255,0.42)",
            lineHeight: 1.45,
          }}
        >
          Profilo adattato alla forma dita{" "}
          <span style={{ color: "rgba(224,249,255,0.85)", fontWeight: 600 }}>{toeClassification}</span> — anteprima
          sintetica (non è il file G-code esportato).
        </p>
      </div>
    </div>
  );
}
