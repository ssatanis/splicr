"use client";

/**
 * The Atlas explorer.
 *
 * Four things here were claims the data does not support, and all four are gone.
 *
 * Three of the four selects did nothing. Only `library` reached the filter, so a
 * reader could set Organism to Mouse, watch a list of human screens stay exactly
 * where it was, and conclude the Atlas had no mouse screens. All four filter now,
 * and the list says how many rows a filter removed.
 *
 * "Validated elsewhere" printed "3 of 4 re-tests" or "0 of 2 re-tests" from
 * `chance > 0.6`, which is the model's own score wearing the clothes of an
 * independent bench result. "Contexts" was the string "Ferroptosis, melanoma"
 * for every gene in the pool. Neither quantity is in the dataset, so neither is
 * shown.
 *
 * The KPI row read as facts about a real corpus on a page with no sample-data
 * label, and one of the four was a roadmap target rendered as a measurement.
 */

import { Info, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  ATLAS_HITS_WITH_OUTCOMES,
  ATLAS_RERUN_FROM_RAW,
  ATLAS_SCREENS_TOTAL,
  atlasScreensList,
  demoHits,
} from "@/lib/mock/data";
import { formatNumber } from "@/lib/utils";

import { Card, Chance, Kpi } from "./ui";

const FILTERS = {
  organism: { label: "Organism", options: ["Any", "Human", "Mouse"] },
  modality: { label: "Modality", options: ["Any", "Knockout", "CRISPRi", "CRISPRa"] },
  library: { label: "Library", options: ["Any", "Brunello", "GeCKOv2", "TKOv3", "Avana", "Dolcetto", "Calabrese", "Brie"] },
  source: { label: "Source", options: ["Any", "BioGRID ORCS", "DepMap", "Project Score", "GEO/SRA re-run"] },
} as const;

type FilterKey = keyof typeof FILTERS;

const ANY = "Any";

export function AtlasExplorer() {
  const [gene, setGene] = useState("");
  const [sel, setSel] = useState<Record<FilterKey, string>>({
    organism: ANY,
    modality: ANY,
    library: ANY,
    source: ANY,
  });
  const geneId = useId();
  const filterIdBase = useId();
  const hit = useMemo(() => demoHits.find((h) => h.gene.toLowerCase() === gene.trim().toLowerCase()), [gene]);
  // Taken from the demo table rather than written into the placeholder, so the
  // symbols it suggests are always symbols the search can actually find.
  const examples = useMemo(
    () =>
      [...demoHits]
        .sort((a, b) => b.chance - a.chance)
        .slice(0, 3)
        .map((h) => h.gene)
        .join(", "),
    [],
  );

  const rows = useMemo(
    () =>
      atlasScreensList.filter(
        (a) =>
          (sel.organism === ANY || a.organism === sel.organism) &&
          (sel.modality === ANY || a.modality === sel.modality) &&
          (sel.library === ANY || a.library.startsWith(sel.library)) &&
          (sel.source === ANY || a.source === sel.source),
      ),
    [sel],
  );

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Sample data. The corpus figures below and the {atlasScreensList.length} screens listed are invented to show
          the layout. The Atlas is not built yet, so none of this is a count of anything.
        </span>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Screens indexed" value={formatNumber(ATLAS_SCREENS_TOTAL)} hint="BioGRID ORCS, DepMap and re-runs" />
        {/* A target is not a measurement, so it is labelled as one rather than
            sitting in the hint slot beside a figure that reads as progress. */}
        <Kpi
          label="Re-run from raw reads"
          value={formatNumber(ATLAS_RERUN_FROM_RAW)}
          hint={`Target for Atlas v0 is 50 to 100. That is a plan, not a count.`}
          tone="cyan"
        />
        <Kpi label="Hits with a logged outcome" value={formatNumber(ATLAS_HITS_WITH_OUTCOMES)} hint="Pilot answer key" tone="orange" />
        <Kpi label="Last refresh" value="Sep 2026" hint="Monthly" />
      </div>

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-4">
        <Card title="Gene history" subtitle="How often a gene was called, and in how many screens that assayed it">
          <label htmlFor={geneId} className="block text-xs uppercase tracking-[0.06em] text-muted">
            Gene symbol
          </label>
          <div className="mt-1.5 flex items-center gap-3 rounded-full border border-line px-4 py-2 focus-within:border-cyan-500">
            <Search className="w-4 h-4 text-muted" aria-hidden="true" />
            <input
              id={geneId}
              type="search"
              value={gene}
              onChange={(e) => setGene(e.target.value)}
              placeholder={`Try ${examples}`}
              className="w-full outline-none text-sm text-ink"
            />
          </div>
          {hit ? (
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <div className="text-2xl text-ink font-medium">{hit.gene}</div>
                <Chance value={hit.chance} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Called in</dt>
                  <dd className="text-ink font-medium">
                    {hit.atlasHits} of {formatNumber(hit.atlasScreens)} screens that assayed it
                  </dd>
                </div>
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Frequent hitter</dt>
                  <dd className="text-ink font-medium">
                    {hit.flags.includes("Frequent hitter") ? "Yes" : "No"}
                  </dd>
                </div>
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Re-tests recorded elsewhere</dt>
                  <dd className="text-ink font-medium">Not recorded</dd>
                </div>
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Contexts</dt>
                  <dd className="text-ink font-medium">Not recorded</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">
                The per-screen breakdown, the cell contexts and other labs&apos; re-tests are what the Atlas is being
                built to hold. The sample dataset carries a count and nothing else, so nothing else is shown rather than
                being derived from this screen&apos;s own score.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Type a gene symbol from the demo screen to see its history.</p>
          )}
        </Card>

        <Card title="Browse screens">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
              // The label is a sibling with htmlFor rather than a wrapper: a
              // label that wraps a select has every option folded into the
              // control's accessible name, so a screen reader reads
              // "Organism Any Human Mouse" as the name of the field.
              <div key={key}>
                <label
                  htmlFor={`${filterIdBase}-${key}`}
                  className="block text-xs uppercase tracking-[0.06em] text-muted"
                >
                  {FILTERS[key].label}
                </label>
                <select
                  id={`${filterIdBase}-${key}`}
                  value={sel[key]}
                  onChange={(e) => setSel((s) => ({ ...s, [key]: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm bg-white text-ink"
                >
                  {FILTERS[key].options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No screen in the sample list matches these filters.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((a) => (
                <li key={a.id} className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-ink font-medium">{a.title}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {a.id} · {a.source} · {a.cellLine} · {a.organism} · {a.modality} · {a.library} · {a.year}
                    </div>
                  </div>
                  <span className="chip text-xs bg-mist-soft shrink-0">{a.phenotype}</span>
                </li>
              ))}
            </ul>
          )}
          <p aria-live="polite" className="mt-3 text-xs text-muted">
            Showing {rows.length} of the {atlasScreensList.length} screens in the sample list. Browsing the full corpus
            arrives with the Atlas API.
          </p>
        </Card>
      </div>
    </div>
  );
}
