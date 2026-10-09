"use client";

/**
 * One gene's guide evidence, opened from the effect plot or the gene table.
 *
 * WHAT IT SHOWS, IN THE ORDER A READER NEEDS IT
 *
 *   1. the sentence the engine wrote, which states what was measured
 *   2. the four facts behind it, each with its denominator
 *   3. every guide, with its own fold change and where it cut
 *   4. the protein track, then the structure, both optional
 *   5. the concordance table, its exact p, the smallest p it could have reached,
 *      and the correlation that makes even a small p weaker than it looks
 *   6. where the numbers came from and when
 *
 * WHAT IT DOES NOT DO
 *
 * It does not let the reader untick guides and watch a gene-level statistic
 * change. An earlier version of this drawer did, and printed a "Bonferroni p"
 * computed as the smallest guide p-value times the number of guides. That is not a
 * gene-level p-value: the guides are not independent tests of separate hypotheses,
 * MAGeCK's own gene statistic is a rank aggregation rather than a combination of
 * per-guide p-values, and a reader who can move a number until they like it will.
 * The leave-one-out range is shown instead, because that is the sensitivity
 * question a recomputation was reaching for, and the engine computes it once.
 */
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DisagreementReport, GuideEvidence } from "@/lib/data/disagreement";

import { LabEvidencePanel } from "./lab-evidence-panel";

import { ProteinTrack } from "./protein-track";
import { StructureViewer } from "./structure-viewer";

export type EscapeEvidence = {
  targetGene: string;
  paralogGene: string;
  strength: "strong" | "moderate" | "weak" | "insufficient";
  statement: string;
  channels: Array<{
    name: string;
    supports: boolean;
    availability: string;
    statement: string;
  }>;
  cas12aArray?: {
    nuclease: string;
    construct: string;
    spacers: Array<{ gene: string; sequence: string }>;
    warnings: string[];
    statement: string;
  };
};

export type DrawerState =
  | { kind: "loading"; gene: string }
  | { kind: "found"; gene: string; report: DisagreementReport; recordedAt: string | null; escape?: EscapeEvidence }
  | { kind: "message"; gene: string; title: string; body: string };

function EscapeWarning({ escape }: { escape: EscapeEvidence }) {
  const [copied, setCopied] = useState(false);

  async function copyArray() {
    if (!escape.cas12aArray?.construct) return;
    await navigator.clipboard.writeText(escape.cas12aArray.construct);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="space-y-3">
      <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-4">
        <p className="font-instrument text-[15px] leading-relaxed text-orange-900">
          Target evasion detected. Paralog{" "}
          <span className="font-medium">{escape.paralogGene}</span> is
          buffering the{" "}
          <span className="font-medium">{escape.targetGene}</span> knockout.
          {escape.cas12aArray
            ? " Generated dual-guide Cas12a multiplex library for synthetic lethal validation."
            : " Cas12a array could not be designed; see details below."}
        </p>
        <p className="mt-2 text-[11px] text-orange-700">
          Strength: {escape.strength} hypothesis.{" "}
          {escape.statement}
        </p>
      </div>

      <div className="space-y-1">
        <h4 className="text-[12px] font-medium text-ink">Evidence channels</h4>
        <ul className="space-y-0.5 text-[11px]">
          {escape.channels.map((channel) => (
            <li key={channel.name} className="flex gap-2">
              <span className={
                channel.supports ? "text-teal-600" :
                channel.availability === "available" ? "text-orange-600" : "text-muted"
              }>
                {channel.supports ? "+" : channel.availability === "available" ? "−" : "?"}
              </span>
              <span className="text-muted w-44 shrink-0">{channel.name}</span>
              <span className="text-body">{channel.statement}</span>
            </li>
          ))}
        </ul>
      </div>

      {escape.cas12aArray && (
        <div className="space-y-2 rounded-md border border-line bg-canvas px-3 py-3">
          <div className="flex items-start justify-between">
            <h4 className="text-[12px] font-medium text-ink">
              Cas12a multiplex array ({escape.cas12aArray.nuclease})
            </h4>
            <button
              type="button"
              onClick={copyArray}
              className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-body hover:bg-canvas"
            >
              {copied ? "Copied" : "Copy construct"}
            </button>
          </div>
          <p className="text-[11px] text-muted">{escape.cas12aArray.statement}</p>
          <div className="space-y-1">
            {escape.cas12aArray.spacers.map((spacer, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-muted w-24 shrink-0">{spacer.gene}</span>
                <code className="font-mono text-[10px] text-ink">{spacer.sequence}</code>
              </div>
            ))}
          </div>
          {escape.cas12aArray.warnings.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {escape.cas12aArray.warnings.map((warning, i) => (
                <p key={i} className="text-[11px] text-orange-600">{warning}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Fact({
  label, value, denominator, note,
}: {
  label: string;
  value: string;
  denominator?: string;
  note: string;
}) {
  return (
    <div className="min-w-0 border-l border-line pl-3">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[15px] text-ink">
        {value}
        {denominator && <span className="ml-1 text-[11px] text-muted">{denominator}</span>}
      </dd>
      <p className="mt-0.5 text-[11px] leading-snug text-muted">{note}</p>
    </div>
  );
}

function evidenceLabel(guide: GuideEvidence): string {
  switch (guide.annotation_evidence) {
    case "curated":
      return guide.features_hit.join(", ");
    case "cds_only":
      return "in the coding sequence, no curated feature";
    default:
      return guide.note || "not resolved";
  }
}

function GuideTable({
  report, onResidue, activeGuide,
}: {
  report: DisagreementReport;
  onResidue: (residue: number | null, guide: string | null) => void;
  activeGuide: string | null;
}) {
  const measured = report.guides.some((g) => g.measured_efficacy !== null);
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
        <caption className="sr-only">
          Every guide this comparison scored for {report.gene_symbol}, with its own
          recorded fold change and where its cut resolved to on the protein.
        </caption>
        <thead className="border-b border-line bg-canvas text-[11px] text-muted">
          <tr>
            {["Guide", "log2FC", "Residual", "Guide p", "Residue", "Where it cut",
              ...(measured ? ["Measured efficacy"] : [])].map((head) => (
              <th key={head} scope="col" className="px-3 py-2 font-normal">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {report.guides.map((guide) => (
            <tr
              key={guide.guide_key}
              className={activeGuide === guide.guide_key ? "bg-canvas" : undefined}
              onMouseEnter={() => onResidue(guide.protein_residue, guide.guide_key)}
              onMouseLeave={() => onResidue(null, null)}
            >
              <th scope="row" className="num px-3 py-2 font-normal text-ink">
                {guide.guide_key}
                {report.pivotal_guide === guide.guide_key && (
                  <span className="ml-1.5 rounded-sm bg-orange-50 px-1 py-0.5 text-[10px] text-orange-700">
                    the call turns on this one
                  </span>
                )}
              </th>
              <td className={`num px-3 py-2 ${guide.depleted ? "text-cyan-700" : "text-body"}`}>
                {guide.log2_fold_change.toFixed(2)}
              </td>
              <td className="num px-3 py-2 text-body">{guide.residual >= 0 ? "+" : ""}{guide.residual.toFixed(2)}</td>
              <td className="num px-3 py-2 text-body">
                {guide.p_value === null
                  ? <span className="text-muted">Not recorded</span>
                  : guide.p_value < 0.001 ? guide.p_value.toExponential(1) : guide.p_value.toFixed(3)}
              </td>
              <td className="num px-3 py-2 text-body">
                {guide.protein_residue ?? <span className="text-muted">Not resolved</span>}
                {guide.cds_fraction !== null && (
                  <span className="ml-1 text-[10px] text-muted">
                    {(guide.cds_fraction * 100).toFixed(0)}% of CDS
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-body">{evidenceLabel(guide)}</td>
              {measured && (
                <td className="num px-3 py-2 text-body">
                  {guide.measured_efficacy === null
                    ? <span className="text-muted">Not measured</span>
                    : <>{guide.measured_efficacy.toFixed(2)}
                        <span className="ml-1 text-[10px] text-muted">{guide.efficacy_source}</span></>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Concordance({ report }: { report: DisagreementReport }) {
  const c = report.concordance;
  return (
    <div className="space-y-2 rounded-md border border-line bg-canvas px-3 py-3 text-[12.5px] leading-snug">
      <p className="text-ink">{c.interpretation}</p>
      {c.fisher_p !== null && c.fisher_p_floor !== null && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
          <div>
            <dt className="text-muted">Fisher exact, two-sided</dt>
            <dd className="num text-ink">{c.fisher_p.toPrecision(3)}</dd>
          </div>
          <div>
            <dt className="text-muted">Smallest p these margins allow</dt>
            <dd className="num text-ink">{c.fisher_p_floor.toPrecision(3)}</dd>
          </div>
          <div>
            <dt className="text-muted">Annotated guides in the table</dt>
            <dd className="num text-ink">
              {c.n_depleting_annotated} depleting, {c.n_other_annotated} not
            </dd>
          </div>
        </dl>
      )}
      <p className="text-[11px] text-muted">{c.confound}</p>
    </div>
  );
}

/**
 * Mount one drawer per gene.
 *
 * The parent gives this component a `key` of the gene, so selecting a different
 * gene remounts it and the hovered residue starts empty. Resetting that in an
 * effect instead would render the previous gene's residue once before clearing
 * it, which is a frame of the wrong protein highlighted.
 */
export function GeneDrawer({
  state,
  screenName,
  onClose,
  screenId,
  comparisonId,
}: {
  state: DrawerState;
  screenId: string;
  comparisonId?: string;
  screenName: string;
  onClose: () => void;
}) {
  const [residue, setResidue] = useState<number | null>(null);
  const [activeGuide, setActiveGuide] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onResidue = (next: number | null, guide: string | null) => {
    setResidue(next);
    setActiveGuide(guide);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/15"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="absolute inset-y-0 right-0 flex w-full max-w-[820px] flex-col border-l border-line bg-white"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gene-drawer-title"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted">Guide evidence, {screenName}</p>
            <h2 id="gene-drawer-title" className="mt-0.5 flex items-center gap-3 truncate text-[17px] font-medium text-ink">
              <span>{state.gene}</span>
              {state.kind === "found" && state.report.ensembl_gene_id && (
                <span className="num text-[11px] font-normal text-muted">
                  {state.report.ensembl_gene_id}
                </span>
              )}
              {state.kind === "found" && state.report.uniprot_accession && (
                <a
                  href={`https://www.uniprot.org/uniprotkb/${state.report.uniprot_accession}/entry`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[10px] font-medium text-teal-800 hover:bg-teal-100"
                >
                  View on UniProt
                </a>
              )}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded border border-line text-body hover:bg-canvas"
            aria-label="Close the guide evidence"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-4"><a href={`/dashboard/memory?q=${encodeURIComponent(state.gene)}`} className="text-xs text-cyan-700 underline">Search {state.gene} across the lab</a></div>
          {state.kind === "loading" && (
            <p role="status" className="text-[12.5px] text-muted">Reading the recorded report…</p>
          )}

          {state.kind === "message" && (
            <div className="rounded-md border border-line bg-canvas px-3 py-4 text-[12.5px] leading-snug">
              <p className="text-ink">{state.title}</p>
              <p className="mt-1.5 text-muted">{state.body}</p>
            </div>
          )}

          {state.kind === "message" && <div className="mt-5"><LabEvidencePanel key={state.gene} screenId={screenId} gene={state.gene} comparisonId={comparisonId} /></div>}
          {state.kind === "found" && (
            <div className="space-y-6">
              <section>
                <p className="max-w-[68ch] text-[14.5px] leading-relaxed text-ink">
                  {state.report.summary}
                </p>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact
                    label="Guides scored"
                    value={String(state.report.n_guides)}
                    denominator={`${state.report.n_depleting} deplete individually`}
                    note={`A guide counts as depleting below log2FC ${state.report.depletion_lfc.toFixed(1)}. A descriptive cut, not a hit threshold.`}
                  />
                  <Fact
                    label="Gene mean"
                    value={`${state.report.mean_log2_fold_change >= 0 ? "+" : ""}${state.report.mean_log2_fold_change.toFixed(2)}`}
                    denominator={`median ${state.report.median_log2_fold_change.toFixed(2)}`}
                    note="The mean over this gene's guides, as recorded. Nothing here reweights it."
                  />
                  <Fact
                    label="Leaving one guide out"
                    value={`${state.report.leave_one_out_min.toFixed(2)} to ${state.report.leave_one_out_max.toFixed(2)}`}
                    note={state.report.fragile
                      ? `The call does not survive it: dropping ${state.report.pivotal_guide} moves the mean across the threshold.`
                      : "The call is the same on every leave-one-out subset."}
                  />
                  <Fact
                    label="Spread against this screen"
                    value={state.report.spread_vs_screen === null
                      ? "Unavailable"
                      : `${state.report.spread_vs_screen.toFixed(1)}×`}
                    denominator={state.report.spread === null ? undefined : `sd ${state.report.spread.toFixed(2)}`}
                    note={state.report.spread_vs_screen === null
                      ? "This comparison had too few genes with the same number of guides to form a baseline."
                      : `The median spread of ${state.report.n_guides}-guide genes in this comparison, over ${state.report.spread_baseline_n_genes ?? "?"} genes. 1× is unremarkable.`}
                  />
                </dl>
                {(state.report.fragile || state.report.discordant) && (
                  <p className="mt-3 rounded-md bg-orange-50 px-3 py-2 text-[12.5px] leading-snug text-orange-700">
                    {[state.report.fragile && "This gene's call turns on a single guide.",
                      state.report.discordant && "Its guides disagree more than this screen's own norm for genes of this size."]
                      .filter(Boolean).join(" ")}
                    {" "}
                    That is a reason to look at the guides below, not a verdict on the gene.
                  </p>
                )}
              </section>

              {state.escape && state.escape.strength !== "insufficient" && (
                <EscapeWarning escape={state.escape} />
              )}

              <section className="space-y-2">
                <h3 className="text-[13px] font-medium text-ink">Every guide</h3>
                <GuideTable report={state.report} onResidue={onResidue} activeGuide={activeGuide} />
                <p className="text-[11px] leading-snug text-muted">
                  Residual is the guide&rsquo;s distance from this gene&rsquo;s own mean. A guide p-value
                  is MAGeCK&rsquo;s per-guide statistic; it is not corrected across a gene&rsquo;s guides
                  and is not combined into a gene-level p-value here.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-[13px] font-medium text-ink">Where the guides cut</h3>
                <ProteinTrack
                  report={state.report}
                  activeResidue={residue}
                  onResidue={onResidue}
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-[13px] font-medium text-ink">Structure</h3>
                <StructureViewer
                  // Remounted per accession, so a different protein starts from
                  // "not loaded" rather than inheriting the last one's state.
                  key={state.report.uniprot_accession ?? "no-accession"}
                  accession={state.report.uniprot_accession}
                  residue={residue}
                  residueLabel={activeGuide}
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-[13px] font-medium text-ink">
                  Do the guides that moved cut somewhere the others did not?
                </h3>
                <Concordance report={state.report} />
              </section>

              <LabEvidencePanel key={state.gene} screenId={screenId} gene={state.gene} comparisonId={comparisonId} />

              <section className="space-y-1 border-t border-line pt-3 text-[11px] leading-snug text-muted">
                <h3 className="text-[12px] font-medium text-ink">Where these numbers came from</h3>
                <p>Measurements: {state.report.provenance.measurement_source}.</p>
                <p>Coordinates: {state.report.provenance.coordinate_system}.</p>
                <p>
                  References:{" "}
                  {Object.entries(state.report.provenance.reference_versions)
                    .map(([key, value]) => `${key} ${value}`)
                    .join(", ") || "not recorded"}
                  .
                </p>
                <p>
                  Recorded{" "}
                  {state.recordedAt
                    ? new Date(state.recordedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
                    : "at a time that was not recorded"}
                  . Re-reading this gene returns the same report; it does not change because a
                  reference was refreshed.
                </p>
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
