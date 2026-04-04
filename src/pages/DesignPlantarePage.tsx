import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { BambuLayerPreview } from "../components/design/BambuLayerPreview";
import { loadFootDesignPackage, type FootDesignPackageV1 } from "../lib/scanner/buildFootDesignPackage";

export default function DesignPlantarePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { scanId?: number; fromScan?: boolean } | null;

  const [pkg, setPkg] = React.useState<FootDesignPackageV1 | null>(() =>
    typeof sessionStorage !== "undefined" ? loadFootDesignPackage() : null,
  );

  React.useEffect(() => {
    setPkg(loadFootDesignPackage());
  }, [state?.fromScan]);

  const jsonPreview = React.useMemo(() => {
    if (!pkg) return "";
    const slim = {
      ...pkg,
      filteredPointCloudMm: `[${pkg.filteredPointCloudMm.length} punti]`,
    };
    return JSON.stringify(slim, null, 2);
  }, [pkg]);

  return (
    <div className="min-h-[100dvh] bg-black px-5 pt-10 pb-14 text-white">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">NEUMA</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Design del Plantare</h1>
          <p className="mt-2 text-sm text-white/60">
            Pacchetto 3D generato dalla scansione
            {state?.scanId != null ? (
              <>
                {" "}
                · Scan <span className="font-mono text-white/75">{state.scanId}</span>
              </>
            ) : null}
          </p>

          {!pkg ? (
            <p className="mt-6 text-sm text-amber-200/80">
              Nessun pacchetto trovato. Completa una scansione e conferma le misure dalla revisione.
            </p>
          ) : (
            <>
              <div className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm">
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                  <span className="text-white/45">Lunghezza</span>
                  <span className="font-mono tabular-nums text-white/90">{pkg.dimensionsMm.length} mm</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                  <span className="text-white/45">Larghezza</span>
                  <span className="font-mono tabular-nums text-white/90">{pkg.dimensionsMm.width} mm</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                  <span className="text-white/45">Altezza (instep)</span>
                  <span className="font-mono tabular-nums text-white/90">{pkg.dimensionsMm.height} mm</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                  <span className="text-white/45">Forma dita</span>
                  <span className="font-semibold text-cyan-200/95">{pkg.toeClassification}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-white/45">Nuvola filtrata</span>
                  <span className="font-mono text-white/80">{pkg.filteredPointCloudMm.length} punti</span>
                </div>
              </div>

              <div className="mt-6">
                <BambuLayerPreview
                  lengthMm={pkg.dimensionsMm.length}
                  widthMm={pkg.dimensionsMm.width}
                  toeBox={pkg.shoeToeBox}
                  toeClassification={pkg.toeClassification}
                />
              </div>

              <details className="mt-5 rounded-2xl border border-white/10 bg-black/25">
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-white/55">
                  Pacchetto JSON (riepilogo)
                </summary>
                <pre className="max-h-52 overflow-auto border-t border-white/10 px-4 py-3 text-[10px] leading-relaxed text-white/50">
                  {jsonPreview}
                </pre>
              </details>

              <p className="mt-4 text-[12px] leading-relaxed text-white/40">
                I parametri <span className="text-white/55">shoeToeBox</span> sono pronti per il modulo di
                generazione scarpa: toe box più allungato e centrale per <strong className="text-white/70">Greek</strong>
                , più asimmetrico verso l’esterno per <strong className="text-white/70">Egyptian</strong>.
              </p>
            </>
          )}

          <div className="mt-8 flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="rounded-full border border-white/12 bg-white/[0.05] text-white hover:bg-white/[0.09]"
              onClick={() => navigate(-1)}
            >
              Indietro
            </Button>
            <Button
              type="button"
              className="rounded-full border border-white/12 bg-white/10 text-white hover:bg-white/15"
              onClick={() => navigate("/")}
            >
              Home
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
