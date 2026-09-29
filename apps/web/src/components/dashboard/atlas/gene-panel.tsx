/**
 * What the Atlas knows about one gene, and what it does not.
 *
 * Three rules shape every figure here, and each is printed beside the figure
 * rather than left to a footnote.
 *
 * A rate names its denominator. The hit rate is over the background screens
 * that measured the gene, with its Wilson interval, because "called in 3 of 10
 * screens" and "called in 420 of 1,400" are the same 30% and only one of them
 * is evidence.
 *
 * A count of screens is not a count of effects. Each screen used its authors'
 * own hit rule, so the panel says how many screens called the gene and never
 * adds their scores together.
 *
 * A gene the Atlas cannot judge is not judged. Fewer than ten background
 * screens gives no frequent-hitter verdict in either direction, because
 * "rarely measured" is not "measured and rarely called".
 */
import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { atlasGeneHref, modalityLabel } from "@/lib/atlas/links";
import { hrefWith } from "@/lib/atlas/params";
import { FREQUENT_HITTER_RATE, MIN_SCREENS_FOR_FREQUENT_HITTER } from "@/lib/atlas/query";
import { ncbiGeneUrl, orcsGeneUrl } from "@/lib/atlas/links";
import type { GeneLookup, PhenotypeCall, ScreenQuery } from "@/lib/atlas/types";
import { formatNumber } from "@/lib/utils";

import { Panel, StatusChip } from "../ui";

/**
 * One term and its value, as a real definition-list entry. `DefRow` from the
 * console is a pair of divs and is not valid directly inside a `<dl>`; a screen
 * reader would lose the term-to-value pairing.
 */
function Fact({
  term,
  value,
  note,
  tone = "ink",
}: {
  term: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "ink" | "cyan";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <dt className="min-w-0">
        <span className="block text-[12px] leading-tight text-ink">{term}</span>
        {note && <span className="mt-0.5 block text-[11px] leading-snug text-muted">{note}</span>}
      </dt>
      <dd className={`num shrink-0 text-[12px] leading-tight ${tone === "cyan" ? "text-cyan-600" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function percent(value: number): string {
  const pct = value * 100;
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

function Bars({ title, rows, limit = 5 }: { title: string; rows: PhenotypeCall[]; limit?: number }) {
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((row) => row.called));
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-[11px] uppercase tracking-[0.06em] text-muted">{title}</h3>
      {shown.length === 0 ? (
        <p className="text-[12px] text-muted">No screen called this gene.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((row) => (
            <li key={row.phenotype} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-[12px]">
              <div className="min-w-0">
                <div className="truncate text-body" title={row.phenotype}>
                  {row.phenotype}
                </div>
                <div className="mt-0.5 h-1 rounded-full bg-mist-soft" aria-hidden="true">
                  <div className="h-1 rounded-full bg-cyan-500" style={{ width: `${Math.max(2, (row.called / max) * 100)}%` }} />
                </div>
              </div>
              <span className="num text-ink">{formatNumber(row.called)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && (
        <p className="mt-1 text-[11px] text-muted">
          and {formatNumber(rows.length - limit)} more, in the table below
        </p>
      )}
    </div>
  );
}

const VERDICT: Record<
  "above_threshold" | "below_threshold" | "not_enough_screens",
  { tone: "run" | "ok" | "idle"; label: string }
> = {
  above_threshold: { tone: "run", label: "Above the rule" },
  below_threshold: { tone: "ok", label: "Below the rule" },
  not_enough_screens: { tone: "idle", label: "Not judged" },
};

export function GenePanel({ lookup, query }: { lookup: GeneLookup; query: ScreenQuery }) {
  if (lookup.status === "not_found") {
    return (
      <Panel title="Gene not found" count={lookup.query} span={12}>
        <p className="text-[13px] text-body">
          The Atlas has no gene called <span className="font-medium text-ink">{lookup.query}</span>. Symbols are
          matched by their current name or a known alias, and only genes ORCS resolved to an NCBI Gene
          identifier, or that some screen called a hit, are listed.
        </p>
        {lookup.suggestions.length > 0 && (
          <p className="mt-2 text-[13px] text-body">
            Did you mean{" "}
            {lookup.suggestions.map((suggestion, index) => (
              <span key={suggestion.symbol}>
                {index > 0 && ", "}
                <Link
                  href={atlasGeneHref(suggestion.symbol)}
                  replace
                  className="font-medium text-cyan-600 underline decoration-line-strong underline-offset-2"
                >
                  {suggestion.symbol}
                </Link>
              </span>
            ))}
            ?
          </p>
        )}
        <p className="mt-2">
          <Link
            href={hrefWith("/dashboard/atlas", query, { gene: null })}
            replace
            className="text-[12px] text-cyan-600 underline decoration-line-strong underline-offset-2"
          >
            Back to all screens
          </Link>
        </p>
      </Panel>
    );
  }

  const { gene } = lookup;
  const verdict = VERDICT[gene.frequentHitter];
  const interval = gene.hitRateInterval;

  return (
    <Panel
      title={
        <span className="flex items-baseline gap-2">
          <span>{gene.symbol}</span>
          {gene.resolvedFrom && (
            <span className="text-[11px] font-normal text-muted">shown for &ldquo;{gene.resolvedFrom}&rdquo;</span>
          )}
        </span>
      }
      count={gene.entrez === null ? "no NCBI Gene id" : `NCBI Gene ${gene.entrez}`}
      control={
        <Link
          href={hrefWith("/dashboard/atlas", query, { gene: null })}
          replace
          className="text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
        >
          Clear gene
        </Link>
      }
      footer={
        <>
          <span className="min-w-0 truncate text-[11px] text-muted">
            Counts screens, not effect sizes. Each screen used its own authors&apos; hit rule.
          </span>
          {gene.entrez !== null && (
            <span className="flex shrink-0 items-center gap-3 text-[11px]">
              <a
                href={orcsGeneUrl(gene.entrez)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-cyan-600 underline decoration-line-strong underline-offset-2"
              >
                ORCS <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">gene page, opens in a new tab</span>
              </a>
              <a
                href={ncbiGeneUrl(gene.entrez)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-cyan-600 underline decoration-line-strong underline-offset-2"
              >
                NCBI Gene <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">record, opens in a new tab</span>
              </a>
            </span>
          )}
        </>
      }
      span={12}
      bodyClassName="py-3"
    >
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
        <dl>
          <Fact
            term="Called a hit in"
            value={`${formatNumber(gene.called)} screens`}
            note={`of ${formatNumber(gene.tested)} whose rows include this gene`}
            tone={gene.called > 0 ? "cyan" : "ink"}
          />
          <Fact
            term="Seen across"
            value={`${formatNumber(gene.cellLines)} cell lines`}
            note={`${formatNumber(gene.phenotypes)} phenotypes, ${formatNumber(gene.conditions)} conditions`}
          />
        </dl>

        <dl>
          <Fact
            term="Hit rate, background screens"
            value={gene.hitRate === null ? "Unknown" : percent(gene.hitRate)}
            note={
              gene.hitRate === null
                ? "No background screen measured this gene, so there is no rate to state."
                : `${formatNumber(gene.hitsBackground)} of ${formatNumber(gene.testedBackground)} screens that measured it${
                    interval ? `. 95% interval ${percent(interval.lower)} to ${percent(interval.upper)}` : ""
                  }`
            }
          />
          <div className="flex items-center justify-between gap-3 py-1.5">
            <dt className="min-w-0">
              <span className="block text-[12px] leading-tight text-ink">Frequent-hitter rule</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                {gene.frequentHitter === "not_enough_screens"
                  ? `Needs ${MIN_SCREENS_FOR_FREQUENT_HITTER} or more background screens; this gene has ${formatNumber(gene.testedBackground)}. No verdict either way.`
                  : `SplicR flags a rate above ${percent(FREQUENT_HITTER_RATE)} across ${MIN_SCREENS_FOR_FREQUENT_HITTER} or more screens. Here every background screen is counted, because no run supplies a context.`}
              </span>
            </dt>
            <dd className="shrink-0">
              <StatusChip tone={verdict.tone}>{verdict.label}</StatusChip>
            </dd>
          </div>
        </dl>

        <Bars title="Called, by phenotype" rows={lookup.byPhenotype} />
        <Bars
          title="Called, by modality"
          rows={lookup.byModality.map((row) => ({ ...row, phenotype: modalityLabel(row.phenotype) }))}
          limit={4}
        />
      </div>
    </Panel>
  );
}
