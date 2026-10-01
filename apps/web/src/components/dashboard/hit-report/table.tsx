/**
 * The Hit Report's table: what was measured for each gene, what could be wrong
 * with it, and what is already known.
 *
 * Three kinds of evidence sit side by side and are kept apart. The statistics
 * (effect, p-value, FDR) are recorded from the run. The flags are the artifacts
 * the engine looked for, printed with the reason; a flagged gene can still be a
 * genuine dependency and an unflagged one is not thereby confirmed. The Atlas
 * and bench columns are context: how often other published screens called the
 * gene, and whether anyone has put it back on a plate.
 *
 * Nothing here ranks genes by likelihood of validating. The order is the
 * recorded FDR unless the reader picks another column.
 */
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import Link from "next/link";

import { atlasGeneHref } from "@/lib/atlas/links";
import type { GeneEvidence } from "@/lib/atlas/query";
import type { WorkspaceHit } from "@/lib/data/screen-detail";
import { RESULT_COPY, type OutcomeResult } from "@/lib/outcomes/model";
import { formatPercent, formatSigned, formatStat, guidesAgreeing } from "@/lib/report/format";
import { defaultHitDirection, hitHref, type HitQuery, type HitSort } from "@/lib/report/hit-query";
import { cn, formatNumber } from "@/lib/utils";

import { DenseTable, StatusChip, statusTone } from "../ui";
import { GuideStrip } from "./guide-strip";
import { ExpandableHitRow } from "./row";

export type OutcomeMap = Map<string, { id: string; result: OutcomeResult }> | null;

interface Column {
  key: string;
  label: string;
  sort?: HitSort;
  align?: "right";
  title?: string;
}

const COLUMNS: Column[] = [
  { key: "gene", label: "Gene", sort: "gene" },
  { key: "direction", label: "Direction" },
  { key: "lfc", label: "Effect", sort: "lfc", align: "right", title: "Log fold change, signed. Negative is depleted." },
  { key: "p", label: "p-value", sort: "p_value", align: "right" },
  { key: "fdr", label: "FDR", sort: "fdr", align: "right", title: "The FDR recorded for this comparison" },
  { key: "guides", label: "Guide effects", title: "Recorded per-guide effects; the count is guides that agree in direction with the gene" },
  { key: "flags", label: "Artifact flags" },
  { key: "atlas", label: "Atlas", title: "Background screens that called this gene, over those that measured it" },
  { key: "bench", label: "Bench" },
];

function SortLinkTh({ column, query, basePath }: { column: Column; query: HitQuery; basePath: string }) {
  if (!column.sort) {
    return (
      <th scope="col" className={cn(column.align === "right" && "num-col")} title={column.title}>
        <span className="inline-flex h-7 items-center uppercase tracking-[0.06em] text-muted">{column.label}</span>
      </th>
    );
  }
  const active = query.sort === column.sort;
  const nextDir = active ? (query.dir === "asc" ? "desc" : "asc") : defaultHitDirection(column.sort);
  const Icon = !active ? ChevronsUpDown : query.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(column.align === "right" && "num-col")}
    >
      <Link
        href={hitHref(basePath, query, { sort: column.sort, dir: nextDir })}
        scroll={false}
        title={column.title}
        className={cn(
          "inline-flex h-7 w-full items-center gap-1 rounded-sm uppercase tracking-[0.06em]",
          column.align === "right" ? "justify-end" : "justify-start",
          active ? "text-ink" : "text-muted hover:text-ink",
        )}
      >
        {column.label}
        <Icon className={cn("h-3 w-3 shrink-0", active ? "opacity-100" : "opacity-45")} aria-hidden="true" />
        <span className="sr-only">{active ? `, sorted ${query.dir === "asc" ? "ascending" : "descending"}, select to reverse` : ", select to sort"}</span>
      </Link>
    </th>
  );
}

function AtlasCell({ evidence, humanOnly }: { evidence: GeneEvidence | undefined; humanOnly: boolean }) {
  if (humanOnly) return <span className="text-muted">Human Atlas only</span>;
  if (!evidence) return <span className="text-muted">Not looked up</span>;
  if (!evidence.found) return <span className="text-muted">Not in the Atlas</span>;
  if (evidence.testedBackground === 0) {
    return <span className="text-muted" title="No background screen measured this gene, so it has no hit rate.">Not measured</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`Called a hit in ${evidence.hitsBackground} of the ${evidence.testedBackground} background screens that measured it. Each screen used its own authors' rule.`}
    >
      <span className="num text-ink">
        {formatNumber(evidence.hitsBackground)} of {formatNumber(evidence.testedBackground)}
      </span>
      {evidence.frequentHitter === "above_threshold" && <StatusChip tone="run">Frequent hitter</StatusChip>}
    </span>
  );
}

function FlagChips({ flags }: { flags: WorkspaceHit["hit_flags"] }) {
  if (!flags || flags.length === 0) return <span className="text-muted">None recorded</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <StatusChip key={flag.flag} tone={flag.severity === "info" ? "idle" : "run"} className="max-w-[170px]">
          <span title={flag.message}>{flag.flag.replace(/_/g, " ")}</span>
        </StatusChip>
      ))}
    </span>
  );
}

function BenchCell({
  gene,
  screenId,
  outcome,
  outcomesKnown,
  canLog,
}: {
  gene: string;
  screenId: string;
  outcome: { id: string; result: OutcomeResult } | undefined;
  outcomesKnown: boolean;
  canLog: boolean;
}) {
  if (outcome) {
    return (
      <Link
        href={`/dashboard/validation?q=${encodeURIComponent(gene)}&screen=${screenId}`}
        title={`${RESULT_COPY[outcome.result].label}. See this gene in the Truth Loop.`}
        className="inline-block hover:opacity-80"
      >
        <StatusChip tone={statusTone(outcome.result)}>{RESULT_COPY[outcome.result].short}</StatusChip>
      </Link>
    );
  }
  if (!outcomesKnown) return <span className="text-muted">Not looked up</span>;
  if (!canLog) return <span className="text-muted">No outcome</span>;
  return (
    <Link
      href={`/dashboard/validation?log=${encodeURIComponent(gene)}&logScreen=${screenId}`}
      className="text-[11.5px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
    >
      Log outcome<span className="sr-only"> for {gene}</span>
    </Link>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-0">
      <dt className="text-[11.5px] text-muted">{term}</dt>
      <dd className="num text-right text-[12px] text-ink">{children}</dd>
    </div>
  );
}

function HitDetail({
  hit,
  comparison,
  evidence,
  humanOnly,
  screenId,
  outcome,
  canLog,
}: {
  hit: WorkspaceHit;
  comparison: string;
  evidence: GeneEvidence | undefined;
  humanOnly: boolean;
  screenId: string;
  outcome: { id: string; result: OutcomeResult } | undefined;
  canLog: boolean;
}) {
  const agree = guidesAgreeing(hit.guide_lfcs, hit.lfc);
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
      <dl>
        <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted">Recorded statistics</div>
        <Fact term="Comparison">{comparison}</Fact>
        <Fact term="Direction">{hit.direction}</Fact>
        <Fact term="Log fold change">{formatSigned(hit.lfc)}</Fact>
        <Fact term="p-value">{formatStat(hit.p_value)}</Fact>
        <Fact term="FDR">{formatStat(hit.fdr)}</Fact>
        <Fact term="BAGEL2 Bayes factor">{formatStat(hit.bayes_factor)}</Fact>
        <Fact term="Good / total guides">
          {hit.n_good_guides === null ? "Not recorded" : formatNumber(hit.n_good_guides)} / {hit.n_guides === null ? "Not recorded" : formatNumber(hit.n_guides)}
        </Fact>
      </dl>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted">Why it might be an artifact</div>
        {hit.hit_flags && hit.hit_flags.length > 0 ? (
          <ul className="space-y-1.5">
            {hit.hit_flags.map((flag) => (
              <li key={flag.flag} className="text-[12px] leading-snug text-body">
                <span className="font-medium text-ink">{flag.flag.replace(/_/g, " ")}</span>{" "}
                <span className="text-muted">({flag.severity})</span>
                <span className="block">{flag.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] leading-snug text-muted">No artifact flag was recorded. That is not confirmation that the hit is real.</p>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted">A flagged region can still contain a genuine dependency.</p>

        <div className="mb-1 mt-4 text-[11px] uppercase tracking-[0.08em] text-muted">Guide effects</div>
        {hit.guide_lfcs && hit.guide_lfcs.length > 0 ? (
          <p className="num text-[12px] leading-snug text-body">
            {hit.guide_lfcs.map((value) => formatSigned(value)).join(", ")}
            {agree && <span className="block text-[11px] text-muted">{agree.agree} of {agree.total} point the way the gene does.</span>}
          </p>
        ) : (
          <p className="text-[12px] text-muted">Not recorded</p>
        )}
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted">Already known</div>
        {humanOnly ? (
          <p className="text-[12px] leading-snug text-muted">The Atlas holds human screens only, so it has nothing to say about this screen&apos;s organism.</p>
        ) : evidence && evidence.found ? (
          <p className="text-[12px] leading-snug text-body">
            {evidence.testedBackground === 0
              ? `${evidence.symbol} was not measured by any background screen, so it has no hit rate. `
              : `${evidence.symbol} was called a hit in ${formatNumber(evidence.hitsBackground)} of ${formatNumber(evidence.testedBackground)} background screens that measured it (${formatPercent(evidence.rate)}). `}
            Each of those screens used its own authors&apos; hit rule.{" "}
            <Link href={atlasGeneHref(evidence.symbol)} className="text-cyan-600 underline decoration-line-strong underline-offset-2">
              Open its Atlas history
            </Link>
            .
          </p>
        ) : (
          <p className="text-[12px] leading-snug text-muted">The Atlas has no gene with this symbol.</p>
        )}

        <div className="mb-1 mt-4 text-[11px] uppercase tracking-[0.08em] text-muted">Stored model output</div>
        <p className="text-[12px] leading-snug text-body">
          {hit.chance_real === null ? (
            "Not recorded."
          ) : (
            <>
              <span className="num text-ink">{formatStat(hit.chance_real)}</span>
              <span className="text-muted"> from model {hit.model_version ?? "not recorded"}. An uncalibrated model output, not a probability of validating.</span>
            </>
          )}
        </p>

        <div className="mb-1 mt-4 text-[11px] uppercase tracking-[0.08em] text-muted">Bench</div>
        <p className="text-[12px] leading-snug text-body">
          {outcome ? (
            <>
              {RESULT_COPY[outcome.result].label}.{" "}
              <Link
                href={`/dashboard/validation?q=${encodeURIComponent(hit.gene_symbol)}&screen=${screenId}`}
                className="text-cyan-600 underline decoration-line-strong underline-offset-2"
              >
                Open in the Truth Loop
              </Link>
            </>
          ) : canLog ? (
            <Link
              href={`/dashboard/validation?log=${encodeURIComponent(hit.gene_symbol)}&logScreen=${screenId}`}
              className="text-cyan-600 underline decoration-line-strong underline-offset-2"
            >
              Log an outcome for {hit.gene_symbol}
            </Link>
          ) : (
            "No outcome recorded."
          )}
        </p>
      </div>
    </div>
  );
}

export function HitTable({
  hits,
  comparisonNames,
  query,
  basePath,
  screenId,
  evidence,
  humanOnly,
  outcomes,
  canLog,
}: {
  hits: WorkspaceHit[];
  comparisonNames: Map<string, string>;
  query: HitQuery;
  basePath: string;
  screenId: string;
  evidence: Map<string, GeneEvidence> | null;
  humanOnly: boolean;
  outcomes: OutcomeMap;
  canLog: boolean;
}) {
  return (
    <DenseTable minWidth={900}>
      <caption className="sr-only">
        Recorded results for this screen&apos;s current run, ordered by the column selected. Open a gene to see every statistic,
        each artifact flag with its reason, and the Atlas history.
      </caption>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <SortLinkTh key={column.key} column={column} query={query} basePath={basePath} />
          ))}
        </tr>
      </thead>
      <tbody>
        {hits.map((hit) => {
          const key = hit.gene_symbol.toUpperCase();
          const geneEvidence = evidence?.get(key);
          const outcome = outcomes?.get(key);
          const comparison = comparisonNames.get(hit.comparison_id) ?? "Not recorded";
          return (
            <ExpandableHitRow
              key={hit.id}
              gene={hit.gene_symbol}
              columns={COLUMNS.length}
              cells={
                <>
                  <td className="capitalize text-body">{hit.direction}</td>
                  <td className="num-col">{formatSigned(hit.lfc)}</td>
                  <td className="num-col">{formatStat(hit.p_value)}</td>
                  <td className="num-col">{formatStat(hit.fdr)}</td>
                  <td>
                    <GuideStrip values={hit.guide_lfcs} geneLfc={hit.lfc} />
                  </td>
                  <td>
                    <FlagChips flags={hit.hit_flags} />
                  </td>
                  <td>
                    <AtlasCell evidence={geneEvidence} humanOnly={humanOnly} />
                  </td>
                  <td>
                    <BenchCell gene={hit.gene_symbol} screenId={screenId} outcome={outcome} outcomesKnown={outcomes !== null} canLog={canLog} />
                  </td>
                </>
              }
              detail={
                <HitDetail
                  hit={hit}
                  comparison={comparison}
                  evidence={geneEvidence}
                  humanOnly={humanOnly}
                  screenId={screenId}
                  outcome={outcome}
                  canLog={canLog}
                />
              }
            />
          );
        })}
      </tbody>
    </DenseTable>
  );
}
