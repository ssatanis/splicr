"use client";

import {
  ArrowUpRight,
  Database,
  FileCheck2,
  FlaskConical,
  Layers3,
  Network,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useState } from "react";

import { LiveRun } from "./live-run";
import { TargetDrawer } from "./target-drawer";
import { TargetScorecard } from "./target-scorecard";

const targets = [
  { gene: "ARID1A", effect: -0.08, fdr: "0.041", structure: "ATPase domain", escape: "ARID1B, moderate", tissue: "low", decision: "Dual knockout", accent: true },
  { gene: "ACSL4", effect: -2.31, fdr: "3.2e−7", structure: "transmembrane region", escape: "none raised", tissue: "medium", decision: "Orthogonal validation", accent: false },
  { gene: "GPX4", effect: -2.08, fdr: "8.7e−6", structure: "catalytic domain", escape: "none raised", tissue: "high", decision: "Toxicity review", accent: false },
  { gene: "FSP1", effect: -1.54, fdr: "0.002", structure: "FAD-binding domain", escape: "AIFM1, weak", tissue: "medium", decision: "Context panel", accent: false },
  { gene: "NCOA4", effect: -1.21, fdr: "0.009", structure: "coiled-coil", escape: "none raised", tissue: "low", decision: "Advance", accent: false },
] as const;

export function AdvancedWorkspace() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const exportEvidence = useCallback(() => {
    const payload = {
      schema_version: "1",
      screen: "GSE152611",
      model: "A375",
      generated_from: "illustrative advanced workspace",
      references: ["GRCh38", "Ensembl 116", "UniProt 2026_04", "AlphaFold DB v6", "GTEx v10"],
      targets,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "splicr_GSE152611_evidence.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1540px] space-y-4 px-4 py-4 md:px-6 md:py-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-muted">
            <span>Program SP-042</span>
            <span className="text-line-strong">/</span>
            <span>GSE152611</span>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">Evidence sealed</span>
          </div>
          <h1 className="mt-1 font-serif text-3xl leading-none text-ink md:text-4xl">A375 ferroptosis target dossier</h1>
          <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-muted">
            Genome-scale loss-of-function screen, RSL3 treatment vs plasmid Day-0, every decision linked to its source measurement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[10.5px] text-body">
            <Database className="h-3.5 w-3.5 text-cyan-700" aria-hidden="true" /> 412.6M reads
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[10.5px] text-body">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" /> QC passed
          </span>
          <button type="button" onClick={exportEvidence} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-900 px-3 py-2 text-[10.5px] font-medium text-white hover:bg-teal-950">
            <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> Export evidence package
          </button>
        </div>
      </header>

      <TargetScorecard />
      <LiveRun />

      <section id="candidate-evidence" aria-labelledby="candidate-title" className="scroll-mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-cyan-700">
              <Layers3 className="h-3.5 w-3.5" aria-hidden="true" /> Integrated evidence
            </div>
            <h2 id="candidate-title" className="mt-1 text-xl font-medium text-ink">Candidate decision surface</h2>
            <p className="mt-1 text-[11px] text-muted">Screen effect, protein context, escape risk and healthy-tissue exposure—kept as separate evidence channels.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="rounded-full bg-orange-50 px-2.5 py-1 text-orange-700">12 candidates at FDR ≤ 0.05</span>
            <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-cyan-700">47 guide cuts resolved</span>
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-teal-700">3 validation-ready</span>
          </div>
        </div>

        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse text-left">
            <thead className="bg-canvas text-[9.5px] uppercase tracking-[0.1em] text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Target</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Effect</th>
                <th scope="col" className="px-3 py-2.5 font-medium">FDR</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Guide / structure context</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Escape signal</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Healthy tissue</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Next decision</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">Open evidence</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {targets.map((target) => (
                <tr key={target.gene} className={target.accent ? "bg-orange-50/45" : "hover:bg-canvas/70"}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${target.accent ? "bg-orange-500" : "bg-cyan-500"}`} aria-hidden="true" />
                      <span className="text-[12px] font-medium text-ink">{target.gene}</span>
                    </div>
                  </td>
                  <td className="num px-3 py-3 text-[11px] text-ink">{target.effect.toFixed(2)}</td>
                  <td className="num px-3 py-3 text-[11px] text-body">{target.fdr}</td>
                  <td className="px-3 py-3 text-[11px] text-body">{target.structure}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${target.accent ? "bg-orange-100 text-orange-700" : "bg-mist-soft text-body"}`}>
                      {target.escape}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[11px] text-body">{target.tissue}</td>
                  <td className="px-3 py-3 text-[11px] font-medium text-ink">{target.decision}</td>
                  <td className="px-4 py-3 text-right">
                    {target.accent ? (
                      <button
                        type="button"
                        onClick={() => setDrawerOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-orange-600"
                      >
                        <Network className="h-3.5 w-3.5" aria-hidden="true" /> Open mechanism
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                        Recorded <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 border-t border-line bg-canvas px-4 py-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <p className="text-[10.5px] leading-relaxed text-muted">
            ARID1A is surfaced despite a weak single-gene effect because an independent essentiality expectation exists and this screen passed the depletion gate. The escape label remains a hypothesis until the proposed paired experiment is recorded.
          </p>
          <button type="button" onClick={() => setDrawerOpen(true)} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line-strong bg-white px-3 py-2 text-[10.5px] font-medium text-ink hover:bg-teal-50">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Inspect ARID1A validation plan
          </button>
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-line-strong px-1 pb-4 pt-3 text-[9.5px] text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>Reference lock: GRCh38, Ensembl 116, UniProt 2026_04, AlphaFold DB v6, GTEx v10</span>
        <span>Illustrative advanced workspace, no result is presented as wet-lab validation</span>
      </footer>

      <TargetDrawer open={drawerOpen} onClose={closeDrawer} />
    </div>
  );
}
