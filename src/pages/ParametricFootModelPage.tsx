import React, { Suspense, lazy, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Scan, Sliders, Box } from "lucide-react";
import NeumaLogo from "../components/NeumaLogo";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Slider } from "../components/ui/slider";
import { Badge } from "../components/ui/badge";
import {
  DEFAULT_FOOT_PARAMETERS,
  extractFootParameters,
  type ArchHeight,
  type FootParameters,
  type FootVolume,
  type ScanMeasurements,
  type ToeShape,
} from "../lib/parametricFoot";

// Lazy-load the Three.js viewer to avoid blocking initial render
const ParametricFootViewer = lazy(() => import("../../components/three/ParametricFootViewer"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Maps a [0,100] slider value to [0.70, 1.30] */
function sliderToScale(v: number): number {
  return lerp(0.70, 1.30, v / 100);
}

/** Maps [0.70, 1.30] back to [0, 100] */
function scaleToSlider(s: number): number {
  return Math.round(((s - 0.70) / 0.60) * 100);
}

function formatScale(s: number): string {
  const pct = Math.round((s - 1) * 100);
  if (pct === 0) return "100%";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// ─── Preset scan measurements (demo / showcase) ───────────────────────────────

const DEMO_PRESETS: { label: string; measurements: ScanMeasurements }[] = [
  {
    label: "Size 40 — narrow",
    measurements: { footLengthMm: 256, forefootWidthMm: 84, instepHeightMm: 62, heelWidthMm: 58, archHeightMm: 12 },
  },
  {
    label: "Size 42 — medium",
    measurements: { footLengthMm: 268, forefootWidthMm: 94, instepHeightMm: 70, heelWidthMm: 66, archHeightMm: 17 },
  },
  {
    label: "Size 44 — wide",
    measurements: { footLengthMm: 282, forefootWidthMm: 108, instepHeightMm: 76, heelWidthMm: 76, archHeightMm: 22 },
  },
  {
    label: "Size 38 — high arch",
    measurements: { footLengthMm: 244, forefootWidthMm: 86, instepHeightMm: 72, heelWidthMm: 60, archHeightMm: 28 },
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

type ToggleGroupProps<T extends string> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
};

function ToggleGroup<T extends string>({ value, options, onChange }: ToggleGroupProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
            value === opt.value
              ? "border-blue-500 bg-blue-600 text-white shadow-sm"
              : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

type ScaleRowProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
};

function ScaleRow({ label, value, onChange }: ScaleRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        <span className="font-mono text-xs text-blue-400">{formatScale(value)}</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[scaleToSlider(value)]}
        onValueChange={([v]) => onChange(sliderToScale(v))}
        className="w-full"
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ParametricFootModelPage() {
  const [params, setParams] = useState<FootParameters>(DEFAULT_FOOT_PARAMETERS);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);

  const update = useCallback(<K extends keyof FootParameters>(key: K, val: FootParameters[K]) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  }, []);

  const applyPreset = useCallback((measurements: ScanMeasurements) => {
    setParams(extractFootParameters(measurements));
  }, []);

  const resetToDefault = useCallback(() => {
    setParams(DEFAULT_FOOT_PARAMETERS);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Button variant="ghost" size="sm" className="gap-2 px-2 text-zinc-400 hover:text-zinc-100" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Torna all&apos;app</span>
            </Link>
          </Button>

          <div className="flex items-center gap-2">
            <NeumaLogo size="sm" className="opacity-80" />
            <span className="hidden text-sm font-semibold text-zinc-200 sm:inline">Modello Piede Parametrico</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className={[
                "gap-1.5 text-xs",
                wireframe ? "text-blue-400" : "text-zinc-400 hover:text-zinc-100",
              ].join(" ")}
              onClick={() => setWireframe((w) => !w)}
            >
              <Box className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Wireframe</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={[
                "gap-1.5 text-xs",
                autoRotate ? "text-blue-400" : "text-zinc-400 hover:text-zinc-100",
              ].join(" ")}
              onClick={() => setAutoRotate((r) => !r)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${autoRotate ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} />
              <span className="hidden sm:inline">Rotazione</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">

          {/* ── 3D Viewer ──────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <Suspense
              fallback={
                <div className="flex h-[420px] w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-sm text-zinc-500">
                  Caricamento visualizzatore 3D…
                </div>
              }
            >
              <ParametricFootViewer
                parameters={params}
                wireframe={wireframe}
                autoRotateSpeed={autoRotate ? 0.28 : 0}
                height={420}
              />
            </Suspense>

            {/* Parameter summary badges */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                Lunghezza {formatScale(params.lengthScale)}
              </Badge>
              <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                Larghezza {formatScale(params.widthScale)}
              </Badge>
              <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                Altezza {formatScale(params.heightScale)}
              </Badge>
              <Badge variant="outline" className="border-blue-900/50 text-blue-400 text-[10px]">
                Arco: {params.archHeight}
              </Badge>
              <Badge variant="outline" className="border-blue-900/50 text-blue-400 text-[10px]">
                Volume: {params.footVolume}
              </Badge>
              <Badge variant="outline" className="border-blue-900/50 text-blue-400 text-[10px]">
                Dita: {params.toeShape}
              </Badge>
            </div>

            {/* Scan presets */}
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-3 pt-4">
                <div className="flex items-center gap-2">
                  <Scan className="h-4 w-4 text-blue-500" />
                  <CardTitle className="text-sm text-zinc-200">Preset da misure di scansione</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 pb-4 sm:grid-cols-4">
                {DEMO_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset.measurements)}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left transition-colors hover:border-blue-500/60 hover:bg-zinc-700"
                  >
                    <div className="text-[10px] font-semibold leading-tight text-zinc-200">{preset.label}</div>
                    <div className="mt-1 text-[9px] text-zinc-500">
                      {preset.measurements.footLengthMm} mm
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ── Parameters panel ───────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Scale parameters */}
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-2 pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-blue-500" />
                    <CardTitle className="text-sm text-zinc-200">Scala dimensioni</CardTitle>
                  </div>
                  <button
                    type="button"
                    onClick={resetToDefault}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Reset
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pb-4">
                <ScaleRow
                  label="Lunghezza (Length)"
                  value={params.lengthScale}
                  onChange={(v) => update("lengthScale", v)}
                />
                <ScaleRow
                  label="Larghezza (Width)"
                  value={params.widthScale}
                  onChange={(v) => update("widthScale", v)}
                />
                <ScaleRow
                  label="Altezza instep (Height)"
                  value={params.heightScale}
                  onChange={(v) => update("heightScale", v)}
                />
                <ScaleRow
                  label="Larghezza tallone (Heel width)"
                  value={params.heelWidth}
                  onChange={(v) => update("heelWidth", v)}
                />
              </CardContent>
            </Card>

            {/* Arch height */}
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm text-zinc-200">Altezza arco plantare</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <ToggleGroup<ArchHeight>
                  value={params.archHeight}
                  options={[
                    { value: "low",    label: "Basso (piatto)" },
                    { value: "medium", label: "Medio" },
                    { value: "high",   label: "Alto" },
                  ]}
                  onChange={(v) => update("archHeight", v)}
                />
              </CardContent>
            </Card>

            {/* Foot volume */}
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm text-zinc-200">Volume / larghezza generale</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <ToggleGroup<FootVolume>
                  value={params.footVolume}
                  options={[
                    { value: "slim",   label: "Slim" },
                    { value: "normal", label: "Normale" },
                    { value: "wide",   label: "Wide" },
                  ]}
                  onChange={(v) => update("footVolume", v)}
                />
              </CardContent>
            </Card>

            {/* Toe shape */}
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm text-zinc-200">Forma delle dita</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                <ToggleGroup<ToeShape>
                  value={params.toeShape}
                  options={[
                    { value: "egyptian", label: "Egiziana" },
                    { value: "roman",    label: "Romana" },
                    { value: "greek",    label: "Greca" },
                  ]}
                  onChange={(v) => update("toeShape", v)}
                />
                <p className="text-[10px] leading-relaxed text-zinc-600">
                  {params.toeShape === "egyptian" && "Alluce più lungo — la forma più comune (~60% della popolazione)."}
                  {params.toeShape === "roman"    && "Primo, secondo e terzo dito approssimativamente uguali."}
                  {params.toeShape === "greek"    && "Secondo dito più lungo dell'alluce."}
                </p>
              </CardContent>
            </Card>

            {/* Info card */}
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardContent className="py-4">
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  Le misure vengono estratte automaticamente dai dati di scansione NEUMA e mappate
                  ai parametri del modello.  Puoi anche regolare manualmente ogni parametro.
                  La mesh viene ricostruita in tempo reale ad ogni modifica.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
