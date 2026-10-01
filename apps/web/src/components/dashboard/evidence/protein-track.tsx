"use client";

/**
 * Where each guide cut, along the protein.
 *
 * WHAT IS DRAWN
 *
 * The bar is the MANE Select transcript's protein, 1 to n residues. A pin is one
 * guide whose cut resolved to a residue. A band is one curated UniProt feature
 * that at least one of those cuts falls inside. Nothing else: there is no feature
 * here that no guide touches, because the report only carries the features its
 * own cuts hit, and inventing the rest of the domain map would mean drawing
 * annotation the report never checked.
 *
 * WHAT IS NOT DRAWN, AND WHY
 *
 * A guide with no resolved residue gets no pin. It is listed under the track
 * instead, with the reason the residue is missing, because a pin at an arbitrary
 * position is a claim about where a guide cut and the report does not support one.
 *
 * Feature colours are assigned by position in the feature list, not by what the
 * feature is: nothing about a colour here means "catalytic" or "important". The
 * legend names each band.
 */
import { useId, useState } from "react";

import type { DisagreementReport, GuideEvidence } from "@/lib/data/disagreement";

/** Bands are distinguished, not ranked. No colour here carries a meaning. */
const BAND_CLASSES = [
  "fill-cyan-200 stroke-cyan-700",
  "fill-orange-200 stroke-orange-700",
  "fill-teal-200 stroke-teal-700",
  "fill-amber-200 stroke-amber-700",
  "fill-slate-200 stroke-slate-600",
];

const WIDTH = 720;
const BAR_Y = 54;
const BAR_HEIGHT = 16;

interface Band {
  name: string;
  /** Residues of this feature that a guide actually cut. */
  residues: number[];
}

/**
 * One band per curated feature the report's own cuts hit.
 *
 * The report gives a feature's name against each cut, not its extent, so a band
 * spans the residues that were cut inside it and nothing more. It is drawn with a
 * minimum width so a single-residue band stays visible, and the label says how
 * many cuts it covers so a one-cut band is not mistaken for a domain boundary.
 */
function bands(guides: readonly GuideEvidence[]): Band[] {
  const byFeature = new Map<string, number[]>();
  for (const guide of guides) {
    if (guide.protein_residue === null) continue;
    for (const feature of guide.features_hit) {
      const list = byFeature.get(feature) ?? [];
      list.push(guide.protein_residue);
      byFeature.set(feature, list);
    }
  }
  return [...byFeature.entries()]
    .map(([name, residues]) => ({ name, residues: [...residues].sort((a, b) => a - b) }))
    .sort((a, b) => a.residues[0] - b.residues[0]);
}

export function ProteinTrack({
  report,
  activeResidue,
  onResidue,
}: {
  report: DisagreementReport;
  activeResidue: number | null;
  onResidue: (residue: number | null, guide: string | null) => void;
}) {
  const titleId = useId();
  const [zoom, setZoom] = useState(false);
  const placed = report.guides.filter((g) => g.protein_residue !== null);
  const unplaced = report.guides.filter((g) => g.protein_residue === null);
  const length = report.n_residues;

  if (length === null || placed.length === 0) {
    return (
      <div className="rounded-md border border-line bg-canvas px-3 py-4 text-[12.5px] leading-snug text-body">
        <p className="text-ink">No guide cut could be placed on the protein.</p>
        <ul className="mt-2 space-y-1 text-muted">
          {report.guides.map((guide) => (
            <li key={guide.guide_key}>
              <span className="num text-ink">{guide.guide_key}</span>
              {" — "}
              {guide.note || "no residue recorded"}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted">
          That is a statement about the annotation available for this run, not about
          the measurements: every fold change above is as recorded.
        </p>
      </div>
    );
  }

  // Zoom is honest framing, not resampling: it narrows the residue window to the
  // cuts that exist, with a margin, and says which window is shown.
  const lo = zoom ? Math.max(1, Math.min(...placed.map((g) => g.protein_residue as number)) - 20) : 1;
  const hi = zoom ? Math.min(length, Math.max(...placed.map((g) => g.protein_residue as number)) + 20) : length;
  const span = Math.max(1, hi - lo);
  const x = (residue: number) => 28 + ((residue - lo) / span) * (WIDTH - 56);
  const featureBands = bands(report.guides);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>
          {report.mane_transcript
            ? <>Residue index of <span className="num text-ink">{report.mane_transcript}</span> (MANE Select)</>
            : "Residue index of the MANE Select transcript"}
        </span>
        <span className="num">
          {zoom ? `showing residues ${lo}–${hi} of ${length}` : `1–${length} residues`}
        </span>
        {report.uniprot_accession && (
          <a
            className="text-cyan-600 underline decoration-line-strong underline-offset-2"
            href={`https://www.uniprot.org/uniprotkb/${report.uniprot_accession}/entry`}
            target="_blank"
            rel="noreferrer"
          >
            UniProt {report.uniprot_accession}
          </a>
        )}
        <button
          type="button"
          onClick={() => setZoom((current) => !current)}
          className="ml-auto rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-canvas"
          aria-pressed={zoom}
        >
          {zoom ? "Show the whole protein" : "Zoom to the cuts"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-canvas p-2">
        <svg
          viewBox={`0 0 ${WIDTH} 132`}
          className="block min-w-[560px]"
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            {`${report.gene_symbol}: ${placed.length} guide cuts placed on residues `
             + `${lo} to ${hi} of ${length}, and the ${featureBands.length} curated `
             + "UniProt features those cuts fall inside."}
          </title>

          <rect x={28} y={BAR_Y} width={WIDTH - 56} height={BAR_HEIGHT} className="fill-surface stroke-line-strong" strokeWidth={1} />
          {featureBands.map((band, index) => {
            const start = x(band.residues[0]);
            const end = x(band.residues[band.residues.length - 1]);
            return (
              <g key={band.name}>
                <rect
                  x={start - 4}
                  y={BAR_Y - 3}
                  width={Math.max(8, end - start + 8)}
                  height={BAR_HEIGHT + 6}
                  className={BAND_CLASSES[index % BAND_CLASSES.length]}
                  strokeWidth={0.75}
                  fillOpacity={0.55}
                />
              </g>
            );
          })}

          {placed.map((guide, index) => {
            const residue = guide.protein_residue as number;
            const at = x(residue);
            const stem = BAR_Y + BAR_HEIGHT + 8 + (index % 2) * 14;
            const active = activeResidue === residue;
            return (
              <g
                key={guide.guide_key}
                tabIndex={0}
                role="button"
                aria-label={
                  `${guide.guide_key}, cut at residue ${residue}, `
                  + `log2 fold change ${guide.log2_fold_change.toFixed(2)}`
                  + (guide.features_hit.length ? `, inside ${guide.features_hit.join(", ")}` : ", no curated feature")
                }
                className="cursor-pointer focus:outline-none [&:focus-visible>circle]:stroke-ink [&:focus-visible>circle]:stroke-2"
                onMouseEnter={() => onResidue(residue, guide.guide_key)}
                onMouseLeave={() => onResidue(null, null)}
                onFocus={() => onResidue(residue, guide.guide_key)}
                onBlur={() => onResidue(null, null)}
                onClick={() => onResidue(residue, guide.guide_key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onResidue(residue, guide.guide_key);
                  }
                }}
              >
                <line
                  x1={at} y1={BAR_Y + BAR_HEIGHT} x2={at} y2={stem}
                  className={guide.depleted ? "stroke-cyan-700" : "stroke-muted"}
                  strokeWidth={active ? 2 : 1.25}
                />
                <circle
                  cx={at} cy={stem} r={active ? 5 : 3.5}
                  className={guide.depleted ? "fill-cyan-700" : "fill-muted"}
                />
                <text x={at} y={stem + 14} textAnchor="middle" className="num fill-body text-[9px]">
                  {guide.guide_key.length > 12 ? `${guide.guide_key.slice(0, 11)}…` : guide.guide_key}
                </text>
              </g>
            );
          })}

          <text x={28} y={BAR_Y - 8} className="num fill-muted text-[9px]">{lo}</text>
          <text x={WIDTH - 28} y={BAR_Y - 8} textAnchor="end" className="num fill-muted text-[9px]">{hi}</text>
        </svg>
      </div>

      {featureBands.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-body">
          {featureBands.map((band, index) => (
            <li key={band.name} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 rounded-sm border ${BAND_CLASSES[index % BAND_CLASSES.length].replace("fill-", "bg-").replace("stroke-", "border-")}`}
              />
              {band.name}
              <span className="num text-muted">
                {band.residues.length === 1
                  ? `1 cut, residue ${band.residues[0]}`
                  : `${band.residues.length} cuts, residues ${band.residues[0]}–${band.residues[band.residues.length - 1]}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-muted">
        A band covers the residues this run&rsquo;s guides cut inside that feature, not the
        feature&rsquo;s full extent, which the report does not carry. Band colours distinguish
        features and mean nothing else.
        {" "}
        Curated UniProt residue features, resolved against{" "}
        {Object.entries(report.provenance.reference_versions)
          .map(([key, value]) => `${key} ${value}`)
          .join(", ") || "the releases recorded with this run"}.
      </p>

      {unplaced.length > 0 && (
        <details className="rounded-md border border-line bg-canvas px-3 py-2 text-[12px]">
          <summary className="cursor-pointer text-ink">
            {unplaced.length} guide{unplaced.length === 1 ? "" : "s"} could not be placed on the protein
          </summary>
          <ul className="mt-2 space-y-1 text-muted">
            {unplaced.map((guide) => (
              <li key={guide.guide_key}>
                <span className="num text-ink">{guide.guide_key}</span>
                {" — "}
                {guide.note || "no residue recorded"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
