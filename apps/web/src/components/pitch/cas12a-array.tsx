"use client";

import { Check, Copy, Download, Repeat2 } from "lucide-react";
import { useMemo, useState } from "react";

const directRepeat = "TAATTTCTACTAAGTGTAGAT";
const spacers = [
  { id: "A1", gene: "ARID1A", sequence: "GTCAGCAGATGATGACCTTGGAC", residue: 711, tone: "bg-orange-100 text-orange-700 border-orange-300" },
  { id: "A2", gene: "ARID1A", sequence: "CTGTTGATGTCCACTGAGGCTCA", residue: 896, tone: "bg-orange-100 text-orange-700 border-orange-300" },
  { id: "B1", gene: "ARID1B", sequence: "AGCTGACCTTGATGACCTCGTGA", residue: 603, tone: "bg-cyan-100 text-cyan-700 border-cyan-400" },
  { id: "B2", gene: "ARID1B", sequence: "TCAGGACTACCTGATCGTGCAGT", residue: 914, tone: "bg-cyan-100 text-cyan-700 border-cyan-400" },
] as const;

export function Cas12aArray() {
  const [active, setActive] = useState<(typeof spacers)[number]>(spacers[0]);
  const [copied, setCopied] = useState(false);
  const construct = useMemo(
    () => spacers.map((spacer) => directRepeat + spacer.sequence).join(""),
    [],
  );

  async function copy() {
    await navigator.clipboard.writeText(construct);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function download() {
    const content = `>SplicR_ARID1A_ARID1B_AsCas12a\n${construct}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ARID1A_ARID1B_AsCas12a_array.fasta";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div id="validation-array" className="scroll-mt-4 overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-col gap-3 border-b border-line px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-[12px] font-medium text-ink">AsCas12a paired-validation array</h4>
          <p className="mt-0.5 text-[10.5px] text-muted">5′ → 3′, four spacers, sequence constraints and genomic specificity only</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[10.5px] text-body hover:bg-canvas">
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? "Copied" : "Copy sequence"}
          </button>
          <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-2.5 py-1.5 text-[10.5px] text-white hover:bg-teal-900">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> FASTA
          </button>
        </div>
      </div>

      <div className="thin-scroll overflow-x-auto px-3 py-4">
        <div className="flex min-w-[880px] items-stretch" aria-label="Cas12a RNA array map">
          {spacers.map((spacer, index) => (
            <div key={spacer.id} className="flex flex-1 items-stretch">
              <div className="flex w-20 shrink-0 flex-col items-center justify-center border-y border-l border-line bg-canvas px-2 py-3 text-center first:rounded-l-lg">
                <Repeat2 className="h-5 w-5 text-teal-600" strokeWidth={1.6} aria-hidden="true" />
                <span className="mt-1 text-[9px] uppercase tracking-[0.08em] text-muted">Direct repeat</span>
              </div>
              <button
                type="button"
                onMouseEnter={() => setActive(spacer)}
                onFocus={() => setActive(spacer)}
                onClick={() => setActive(spacer)}
                aria-pressed={active.id === spacer.id}
                className={`min-w-0 flex-1 border px-3 py-3 text-left transition-transform hover:-translate-y-0.5 focus:-translate-y-0.5 ${spacer.tone} ${index === spacers.length - 1 ? "rounded-r-lg" : ""} ${active.id === spacer.id ? "relative z-10 ring-2 ring-ink/20" : ""}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong className="text-[11px]">Spacer {spacer.id}</strong>
                  <span className="text-[9px] opacity-70">{spacer.gene}</span>
                </span>
                <code className="mt-2 block truncate font-mono text-[9px]">{spacer.sequence}</code>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-line bg-canvas px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div aria-live="polite">
          <p className="text-[11px] font-medium text-ink">Spacer {active.id} targets {active.gene}</p>
          <p className="mt-0.5 text-[10.5px] text-muted">
            Protein residue {active.residue}, coding exon, one perfect genomic match, activity not predicted
          </p>
        </div>
        <p className="max-w-[300px] text-[9.5px] leading-snug text-muted">
          Proposed validation construct. A paired knockout result is required before any buffering mechanism can be established.
        </p>
      </div>
    </div>
  );
}
