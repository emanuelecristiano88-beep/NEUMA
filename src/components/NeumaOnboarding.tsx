"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, PanelTop, Printer, Smartphone } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";
import {
  type UserProfileV2,
  type UserProfileV2Sex,
  type UserProfileV2Usage,
  saveOnboardingV2Profile,
} from "../lib/neumaUserProfileV2";

const LAB_BG = "#e5e5e5";
const ELECTRIC_BLUE = "#2563eb";

const STEP_LABELS = ["Requisiti", "Profilo biometrico", "Privacy & consenso"];

const CHECKLIST = [
  {
    key: "printerA4" as const,
    label: "Stampante A4",
    description: "Per stampare il target NEUMA in scala 1:1",
    Icon: Printer,
  },
  {
    key: "sheetOnRigidSurface" as const,
    label: "Foglio su superficie rigida",
    description: "Tavolo piatto, senza pieghe",
    Icon: PanelTop,
  },
  {
    key: "smartphoneChargedCleanLens" as const,
    label: "Smartphone carico / lente pulita",
    description: "Batteria sufficiente e obiettivo senza aloni",
    Icon: Smartphone,
  },
];

const SEX_OPTIONS: { value: UserProfileV2Sex; label: string }[] = [
  { value: "male", label: "Uomo" },
  { value: "female", label: "Donna" },
  { value: "prefer_not_say", label: "Preferisco non rispondere" },
];

const USAGE_OPTIONS: { value: UserProfileV2Usage; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "sport", label: "Sport" },
  { value: "comfort", label: "Comfort" },
];

const SHOE_SIZES = Array.from({ length: 48 - 35 + 1 }, (_, i) => 35 + i);

const PRIVACY_SCROLL = `INFORMATIVA SUL TRATTAMENTO DEI DATI BIOMETRICI

I dati raccolti tramite scansione del piede (immagini e misure) sono utilizzati per progettare e produrre calzature personalizzate, inclusa la stampa 3D.

Il trattamento avviene nel rispetto della normativa applicabile. Puoi esercitare i tuoi diritti contattando il titolare del trattamento indicato nell'app o sul sito NEUMA.

Proseguendo accetti le condizioni d'uso del servizio di scansione e di invio dati all'officina per la lavorazione.`;

const CONSENT_TEXT =
  "Accetto il trattamento dei dati biometrici per la produzione 3D.";

export type NeumaOnboardingProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
};

export default function NeumaOnboarding({ open, onOpenChange, onComplete }: NeumaOnboardingProps) {
  const [step, setStep] = useState(0);

  const [req, setReq] = useState({
    printerA4: false,
    sheetOnRigidSurface: false,
    smartphoneChargedCleanLens: false,
  });

  const [sex, setSex] = useState<UserProfileV2Sex | null>(null);
  const [heightCm, setHeightCm] = useState("");
  const [shoeSize, setShoeSize] = useState<string>("");
  const [usage, setUsage] = useState<UserProfileV2Usage | "">("");

  const [privacyOk, setPrivacyOk] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(0);
      setReq({
        printerA4: false,
        sheetOnRigidSurface: false,
        smartphoneChargedCleanLens: false,
      });
      setSex(null);
      setHeightCm("");
      setShoeSize("");
      setUsage("");
      setPrivacyOk(false);
    }
  }, [open]);

  const step1Ok = req.printerA4 && req.sheetOnRigidSurface && req.smartphoneChargedCleanLens;

  const heightNum = parseFloat(heightCm.replace(",", "."));
  const heightOk = Number.isFinite(heightNum) && heightNum >= 100 && heightNum <= 250;

  const step2Ok =
    sex != null && heightOk && shoeSize !== "" && (usage === "daily" || usage === "sport" || usage === "comfort");

  const step3Ok = privacyOk;

  const canGoNext = useMemo(() => {
    if (step === 0) return step1Ok;
    if (step === 1) return step2Ok;
    return false;
  }, [step, step1Ok, step2Ok]);

  function toggleReq(key: keyof typeof req) {
    setReq((p) => ({ ...p, [key]: !p[key] }));
  }

  function buildProfile(): UserProfileV2 {
    const now = new Date().toISOString();
    return {
      version: 2,
      requirements: { ...req },
      sex: sex!,
      heightCm: heightNum,
      shoeSizeEu: Number(shoeSize),
      usage: usage as UserProfileV2Usage,
      privacy: {
        biometricProcessingAccepted: true,
        acceptedAtIso: now,
      },
      completedAtIso: now,
    };
  }

  function handlePrimaryAction() {
    if (step < 2) {
      if (!canGoNext) return;
      setStep((s) => s + 1);
      return;
    }
    if (!step3Ok) return;
    saveOnboardingV2Profile(buildProfile());
    onComplete();
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose
        className="max-h-[92dvh] max-w-lg overflow-y-auto border border-black/10 bg-[#e5e5e5] p-5 shadow-xl sm:p-6"
        style={{ backgroundColor: LAB_BG }}
      >
        <DialogHeader className="space-y-3 text-left">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-xl font-semibold tracking-tight text-black">Onboarding NEUMA</DialogTitle>
            <span className="text-xs font-medium text-black/50">
              {step + 1}/{STEP_LABELS.length}
            </span>
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Step onboarding">
            {STEP_LABELS.map((label, i) => (
              <div
                key={label}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-[#2563eb]" : "bg-black/15"
                )}
                title={label}
              />
            ))}
          </div>
          <DialogDescription className="text-sm font-medium text-black/80">{STEP_LABELS[step]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {step === 0 ? (
            <section aria-labelledby="step-req">
              <h2 id="step-req" className="sr-only">
                Requisiti
              </h2>
              <p className="mb-3 text-xs text-black/60">Conferma di avere tutto pronto prima del video briefing e dello scanner radar.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {CHECKLIST.map(({ key, label, description, Icon }) => {
                  const selected = req[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleReq(key)}
                      className={cn(
                        "relative flex flex-col items-center rounded-xl border-2 bg-white px-3 py-4 text-center transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2",
                        selected ? "border-[#2563eb] shadow-md shadow-blue-500/15" : "border-black/10 hover:border-black/25"
                      )}
                      aria-pressed={selected}
                    >
                      {selected ? (
                        <span
                          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-white"
                          style={{ backgroundColor: ELECTRIC_BLUE }}
                          aria-hidden
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                      ) : null}
                      <Icon className="h-9 w-9 text-black" strokeWidth={1.5} aria-hidden />
                      <span className="mt-3 text-sm font-semibold text-black">{label}</span>
                      <span className="mt-1 text-[11px] leading-tight text-black/55">{description}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="space-y-4" aria-labelledby="step-profile">
              <h2 id="step-profile" className="sr-only">
                Profilo biometrico
              </h2>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-black/60">Sesso</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {SEX_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSex(value)}
                      className={cn(
                        "rounded-lg border-2 bg-white px-3 py-2.5 text-sm font-medium text-black transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]",
                        sex === value ? "border-[#2563eb] shadow-sm" : "border-black/10 hover:border-black/30"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="neuma-height" className="text-black">
                  Altezza (cm)
                </Label>
                <Input
                  id="neuma-height"
                  inputMode="decimal"
                  placeholder="es. 175"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className="border-black/15 bg-white text-black placeholder:text-black/40"
                />
                {!heightCm ? null : !heightOk ? (
                  <p className="text-xs text-red-600">Inserisci un valore tra 100 e 250 cm.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="neuma-size" className="text-black">
                  Taglia (EU)
                </Label>
                <select
                  id="neuma-size"
                  value={shoeSize}
                  onChange={(e) => setShoeSize(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                  <option value="">Seleziona…</option>
                  {SHOE_SIZES.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="neuma-usage" className="text-black">
                  Uso
                </Label>
                <select
                  id="neuma-usage"
                  value={usage}
                  onChange={(e) => setUsage(e.target.value as UserProfileV2Usage | "")}
                  className="flex h-10 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                  <option value="">Seleziona…</option>
                  {USAGE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-4" aria-labelledby="step-privacy">
              <h2 id="step-privacy" className="sr-only">
                Privacy
              </h2>
              <div
                className="max-h-40 overflow-y-auto rounded-lg border border-black/10 bg-white p-3 text-left text-[11px] leading-relaxed text-black shadow-sm sm:text-xs"
                role="region"
                tabIndex={0}
              >
                {PRIVACY_SCROLL.split("\n\n").map((block, i) => (
                  <p key={i} className={i > 0 ? "mt-2" : undefined}>
                    {block}
                  </p>
                ))}
              </div>
              <div className="flex gap-3 rounded-lg border border-black/10 bg-white p-3 shadow-sm">
                <Checkbox
                  id="neuma-privacy-v2"
                  checked={privacyOk}
                  onCheckedChange={(v) => setPrivacyOk(v === true)}
                  className="mt-0.5 border-black/40 data-[state=checked]:border-[#2563eb] data-[state=checked]:bg-[#2563eb]"
                />
                <Label htmlFor="neuma-privacy-v2" className="cursor-pointer text-left text-sm font-normal leading-snug text-black">
                  {CONSENT_TEXT}
                </Label>
              </div>
            </section>
          ) : null}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 0}
              className={cn(
                "inline-flex h-12 items-center justify-center gap-1 rounded-lg border border-black/15 bg-white px-4 text-sm font-semibold text-black",
                "transition-colors hover:bg-black/5 disabled:pointer-events-none disabled:opacity-35"
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              Indietro
            </button>

            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={step < 2 ? !canGoNext : !step3Ok}
              className={cn(
                "inline-flex h-12 min-w-[200px] flex-1 items-center justify-center gap-1 rounded-lg border-0 px-4 text-sm font-bold uppercase tracking-wide text-white shadow-lg sm:flex-initial",
                "bg-[#2563eb] transition-[filter] duration-200 enabled:hover:brightness-110 enabled:active:brightness-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-45"
              )}
            >
              {step < 2 ? (
                <>
                  Avanti
                  <ChevronRight className="h-4 w-4" />
                </>
              ) : (
                "Video briefing & scanner"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
