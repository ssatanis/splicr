"use client";

/**
 * The Atlas explorer.
 *
 * Four things here were claims the data does not support, and all four are gone.
 *
 * Three of the four selects did nothing. Only `library` reached the filter, so a
 * reader could set Organism to Mouse, watch a list of human screens stay exactly
 * where it was, and conclude the Atlas had no mouse screens. All four filter now,
 * they filter from the query string so a filtered corpus can be sent to somebody
 * else, and the panel says how many rows a filter removed.
 *
 * "Validated elsewhere" printed "3 of 4 re-tests" or "0 of 2 re-tests" from
 * `chance > 0.6`, which is the model's own score wearing the clothes of an
 * independent bench result. "Contexts" was the string "Ferroptosis, melanoma"
 * for every gene in the pool. Neither quantity is in the dataset, so neither is
 * shown.
 *
 * The KPI row read as facts about a real corpus on a page with no sample-data
 * label, and one of the four was a roadmap target rendered as a measurement.
 *
 * The corpus is a list of screens a reader compares, so it is a table on the
 * console's one dense table, not a stack of list items: eight columns that all
 * sort beats two lines of prose per row that sort not at all.
 */

import { useMemo } from "react";

import {
  ATLAS_HITS_WITH_OUTCOMES,
  ATLAS_RERUN_FROM_RAW,
  ATLAS_SCREENS_TOTAL,
  atlasScreensList,
  demoHits,
  type AtlasScreen,
} from "@/lib/mock/data";
import { formatNumber } from "@/lib/utils";

import { SampleNote } from "./console";
import { FilterBar, FilterField, useUrlSort, useUrlState, type Cell } from "./console-controls";
import {
  DenseTable,
  FootNote,
  KpiStrip,
  KpiTile,
  PageHeader,
  Panel,
  PanelSelect,
  SortTh,
} from "./ui";

/**
 * The four facets, each with the query-string key it writes to. They are in the
 * body rather than the header because a panel header holds one control, and
 * because four selects on one line is the affordance a reader is looking for.
 */
const FILTERS = {
  organism: { label: "Organism", options: ["Any", "Human", "Mouse"] },
  modality: { label: "Modality", options: ["Any", "Knockout", "CRISPRi", "CRISPRa"] },
  library: {
    label: "Library",
    options: ["Any", "Brunello", "GeCKOv2", "TKOv3", "Avana", "Dolcetto", "Calabrese", "Brie"],
  },
  source: {
    label: "Source",
    options: ["Any", "BioGRID ORCS", "DepMap", "Project Score", "GEO/SRA re-run"],
  },
} as const;

type FilterKey = keyof typeof FILTERS;

const ANY = "Any";

/** One cell reader, so a column sorts on exactly the value it prints. */
const cellOf = (screen: AtlasScreen, key: string): Cell => {
  switch (key) {
    case "title":
      return screen.title;
    case "source":
      return screen.source;
    case "model":
      return screen.cellLine;
    case "organism":
      return screen.organism;
    case "modality":
      return screen.modality;
    case "library":
      return screen.library;
    case "phenotype":
      return screen.phenotype;
    case "year":
      return screen.year;
    default:
      return null;
  }
};

export function AtlasExplorer() {
  const { get, set } = useUrlState();
  const gene = get("gene");
  const selected = (key: FilterKey) => get(key, ANY);

  const hit = useMemo(
    () => demoHits.find((h) => h.gene.toLowerCase() === gene.trim().toLowerCase()),
    [gene],
  );

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

  const organism = selected("organism");
  const modality = selected("modality");
  const library = selected("library");
  const source = selected("source");

  const rows = useMemo(
    () =>
      atlasScreensList.filter(
        (a) =>
          (organism === ANY || a.organism === organism) &&
          (modality === ANY || a.modality === modality) &&
          (library === ANY || a.library.startsWith(library)) &&
          (source === ANY || a.source === source),
      ),
    [organism, modality, library, source],
  );

  const { sorted, sortProps } = useUrlSort(rows, { key: "year", dir: "desc" }, cellOf);
  const hidden = atlasScreensList.length - sorted.length;

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PageHeader
        dense
        title="Atlas"
        body="Illustrative public-screen browsing and validation evidence layout."
      />
      <SampleNote>
        Sample data. The corpus figures and the {atlasScreensList.length} screens listed are invented
        to show the layout. These fixtures are not the ingested Atlas or a count of its coverage.
      </SampleNote>

      <KpiStrip
        className="shrink-0"
        title="Corpus"
        count={`${formatNumber(ATLAS_SCREENS_TOTAL)} screens indexed`}
        footer={<FootNote>Monthly refresh, last Sep 2026, from the sample manifest</FootNote>}
      >
        <KpiTile
          label="Screens indexed"
          value={formatNumber(ATLAS_SCREENS_TOTAL)}
          denominator="metadata only"
          definition="BioGRID ORCS, DepMap, Project Score."
        />
        {/* A target is not a measurement, so it says which it is beside the figure
            rather than in a hint below a number that reads as progress. */}
        <KpiTile
          label="Re-run from raw reads"
          value={formatNumber(ATLAS_RERUN_FROM_RAW)}
          denominator={`of ${formatNumber(ATLAS_SCREENS_TOTAL)}`}
          definition="Target 50 to 100. A plan, not a count."
          tone="cyan"
        />
        <KpiTile
          label="Hits with a logged outcome"
          value={formatNumber(ATLAS_HITS_WITH_OUTCOMES)}
          denominator="pilot answer key"
          definition="Re-tests against an indexed hit."
          tone="orange"
        />
        <KpiTile
          label="Screens in the sample list"
          value={formatNumber(atlasScreensList.length)}
          denominator={`${formatNumber(sorted.length)} shown`}
          definition="The rows this build can browse."
        />
      </KpiStrip>

      {/* The corpus is the page, so the table gets the full width: eight columns
          of nowrap metadata in an 8-of-12 panel needed 956px of a 657px panel,
          which put the library, the phenotype and the year past the right edge.
          The gene lookup is a strip underneath, where it costs 110px instead of
          a third of every row. */}
      <div className="grid min-h-0 grid-cols-12 gap-4 lg:flex-1 lg:grid-rows-[minmax(0,1fr)_auto]">
        <Panel
          span={12}
          className="min-h-[340px]"
          title="Screens in the Atlas"
          count={`${formatNumber(sorted.length)} of ${formatNumber(atlasScreensList.length)} listed`}
          body="flush"
          footer={
            <>
              <FootNote>
                Sample manifest. Source, library and year are the record&apos;s own fields
              </FootNote>
              <span aria-live="polite" className="num shrink-0">
                {hidden === 0 ? "No filter applied" : `${formatNumber(hidden)} hidden by these filters`}
              </span>
            </>
          }
        >
          {/* Wraps below sm: four selects squeezed into 343px is four selects
              nobody can read the options of. */}
          <FilterBar className="h-auto min-h-9 flex-wrap gap-1.5 py-1.5 sm:h-9 sm:flex-nowrap sm:py-0">
            {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
              <PanelSelect
                key={key}
                label={FILTERS[key].label}
                value={selected(key)}
                onChange={(event) =>
                  set({ [key]: event.target.value === ANY ? null : event.target.value })
                }
                className="min-w-0 max-w-[200px] flex-1"
              >
                {FILTERS[key].options.map((option) => (
                  <option key={option} value={option}>
                    {option === ANY ? `${FILTERS[key].label}: any` : option}
                  </option>
                ))}
              </PanelSelect>
            ))}
            <span className="ml-auto hidden shrink-0 text-[11px] text-muted lg:block">
              Every column sorts. The facets and the sort are in this page&apos;s address.
            </span>
          </FilterBar>

          <DenseTable minWidth={880}>
            <caption className="sr-only">
              Sample Atlas screens, sortable by any column heading.
            </caption>
            <thead>
              <tr>
                <SortTh label="Screen" {...sortProps("title")} />
                <SortTh label="Source" {...sortProps("source")} />
                <SortTh label="Model" {...sortProps("model")} />
                <SortTh label="Organism" {...sortProps("organism")} />
                <SortTh label="Modality" {...sortProps("modality")} />
                <SortTh label="Library" {...sortProps("library")} />
                <SortTh label="Phenotype" {...sortProps("phenotype")} />
                <SortTh label="Year" align="right" {...sortProps("year", "desc")} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((screen) => (
                <tr key={screen.id}>
                  {/* The title is the row's identity and the accession is the key
                      a reader quotes, so the accession is the cell's title rather
                      than a column of its own. */}
                  <td>
                    <span
                      className="block max-w-[300px] truncate text-ink"
                      title={`${screen.title} (${screen.id})`}
                    >
                      {screen.title}
                    </span>
                  </td>
                  <td className="text-muted">{screen.source}</td>
                  <td>{screen.cellLine}</td>
                  <td>{screen.organism}</td>
                  <td>{screen.modality}</td>
                  <td>{screen.library}</td>
                  <td className="text-body">{screen.phenotype}</td>
                  <td className="num-col">{screen.year}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    No screen in the sample list matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </DenseTable>
        </Panel>

        {/* One row, not a column: the lookup is a field and four figures, and
            four figures stacked vertically is 300px for what fits on one line. */}
        <Panel
          span={12}
          className="[animation-delay:60ms]"
          title="Gene history"
          count={hit ? hit.gene : `${formatNumber(demoHits.length)} genes in the sample hit table`}
          footer={
            <FootNote>
              Counted in the sample hit table for the demo screen, not in the corpus
            </FootNote>
          }
          bodyClassName="py-2.5"
        >
          <div className="flex flex-col items-start gap-x-6 gap-y-2 sm:flex-row">
            <FilterField
              label="Gene symbol"
              value={gene}
              onChange={(value) => set({ gene: value })}
              placeholder={`Gene symbol, for instance ${examples}`}
              className="w-full shrink-0 sm:max-w-[260px]"
            />

            {hit ? (
              <dl className="flex min-w-0 flex-1 flex-wrap items-start gap-x-6 gap-y-2">
                <GeneFact
                  term="Called in"
                  value={`${hit.atlasHits} of ${formatNumber(hit.atlasScreens)}`}
                  note="Screens that assayed it"
                />
                <GeneFact
                  term="Frequent hitter"
                  value={hit.flags.includes("Frequent hitter") ? "Yes" : "No"}
                  note="Called in unrelated screens"
                  tone={hit.flags.includes("Frequent hitter") ? "orange" : "ink"}
                />
                <GeneFact term="Re-tests elsewhere" value="Not recorded" note="Not in this dataset" />
                <GeneFact term="Cell contexts" value="Not recorded" note="Not in this dataset" />
              </dl>
            ) : (
              <p className="min-w-0 flex-1 py-1 text-[12px] leading-snug text-muted">
                {gene === ""
                  ? `Type a symbol from the demo screen, for instance ${examples}, to see how often it was called and in how many screens that assayed it.`
                  : `No record for ${gene.trim()} in the sample hit table. Try ${examples}.`}
              </p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/**
 * One figure of a gene's history, on a line rather than in a stack. The note is
 * the denominator: "3 of 41" means nothing without "screens that assayed it".
 */
function GeneFact({
  term,
  value,
  note,
  tone = "ink",
}: {
  term: string;
  value: string;
  note: string;
  tone?: "ink" | "orange";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-none text-muted">{term}</dt>
      <dd
        className={`num mt-1 text-[13px] leading-none ${tone === "orange" ? "text-orange-600" : "text-ink"}`}
      >
        {value}
      </dd>
      <dd className="mt-1 text-[11px] leading-none text-muted">{note}</dd>
    </div>
  );
}
