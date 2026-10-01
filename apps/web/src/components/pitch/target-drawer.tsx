"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, CheckCircle2, FlaskConical, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Cas12aArray } from "./cas12a-array";

const ParalogNetwork = dynamic(() => import("./paralog-network"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[365px] place-items-center rounded-lg border border-line bg-teal-950 text-[11px] text-white/55" role="status">
      Loading the escape map…
    </div>
  ),
});

const channels = [
  ["Paralogy", "2 sources", "Ensembl Compara and HGNC agree on ARID1A ↔ ARID1B"],
  ["Expression", "available", "ARID1B log1p(TPM) 4.31 in A375"],
  ["Conditional dependency", "supports", "ARID1B is more essential in ARID1A-loss models; Δ median -0.42"],
  ["Pathway overlap", "supports", "Shared SWI/SNF chromatin-remodelling program"],
  ["Paired validation", "missing", "No dual-knockout outcome is recorded"],
] as const;

export function TargetDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const stops = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-teal-950/45 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escape-drawer-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[880px] flex-col bg-white shadow-float"
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-orange-700">Escape hypothesis</span>
              <span className="text-[10px] text-muted">A375, GSE152611</span>
            </div>
            <h2 id="escape-drawer-title" className="mt-1 font-serif text-2xl leading-tight text-ink">
              ARID1A may be buffered by ARID1B
            </h2>
            <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-muted">
              Four independent context channels support the hypothesis. No paired perturbation has been recorded, so this is a validation priority—not a causal conclusion.
            </p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-body hover:bg-canvas" aria-label="Close target evidence">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-[#f7f9fa] px-4 py-4 sm:px-5">
          <div className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Target summary">
              {[
                ["Observed phenotype", "-0.08", "log2 fold change, weaker than 98% of references"],
                ["Leading paralog", "ARID1B", "moderate hypothesis, 4 of 5 channels support"],
                ["Validation status", "Unsettled", "paired perturbation required"],
              ].map(([label, value, note]) => (
                <div key={label} className="rounded-lg border border-line bg-white px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted">{label}</p>
                  <p className="num mt-1 text-[20px] font-medium text-ink">{value}</p>
                  <p className="mt-1 text-[10.5px] leading-snug text-muted">{note}</p>
                </div>
              ))}
            </section>

            <section id="escape-map" aria-labelledby="escape-map-title" className="scroll-mt-4 rounded-xl border border-line bg-white p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 id="escape-map-title" className="text-[13px] font-medium text-ink">Paralog escape network</h3>
                  <p className="mt-0.5 text-[10.5px] text-muted">Select a node to inspect its measured role. The moving edge is a hypothesis, not proof of rescue.</p>
                </div>
                <span className="shrink-0 rounded-full bg-teal-50 px-2 py-1 text-[9px] text-teal-700">Lazy-loaded canvas</span>
              </div>
              <ParalogNetwork />
            </section>

            <section className="rounded-xl border border-line bg-white p-3" aria-labelledby="channels-title">
              <h3 id="channels-title" className="text-[13px] font-medium text-ink">Evidence ledger</h3>
              <ul className="mt-2 divide-y divide-line">
                {channels.map(([name, status, statement]) => {
                  const missing = status === "missing";
                  return (
                    <li key={name} className="grid gap-1 py-2.5 sm:grid-cols-[150px_110px_1fr] sm:items-center">
                      <span className="text-[11px] font-medium text-ink">{name}</span>
                      <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] ${missing ? "bg-orange-50 text-orange-700" : "bg-teal-50 text-teal-700"}`}>
                        {missing ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                        {status}
                      </span>
                      <span className="text-[10.5px] leading-snug text-muted">{statement}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-xl border border-line bg-white p-3" aria-labelledby="array-title">
              <div className="mb-3 flex items-start gap-2">
                <FlaskConical className="mt-0.5 h-4 w-4 text-cyan-700" aria-hidden="true" />
                <div>
                  <h3 id="array-title" className="text-[13px] font-medium text-ink">Paired validation design</h3>
                  <p className="mt-0.5 text-[10.5px] text-muted">Hover or focus a spacer to see its target and protein coordinate.</p>
                </div>
              </div>
              <Cas12aArray />
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}
