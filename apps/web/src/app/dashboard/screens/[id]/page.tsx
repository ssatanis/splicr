/**
 * One screen: the demonstration workspace for a demo session, and the Hit Report
 * for a workspace member.
 *
 * The Hit Report shows what the run recorded and keeps three kinds of evidence
 * apart. Statistics (effect, p-value, FDR) are as recorded. Artifact flags are the
 * problems the engine looked for, with the reason, and a flag is a reason to
 * check, not a verdict. Atlas history and bench status are context: how often
 * other published screens called the gene, and whether it has been re-tested.
 * Missing evidence is written as missing, never as zero and never as a default.
 *
 * Nothing here ranks genes by likelihood of validating. Validation probabilities
 * are not available, and the page says so where a reader would look for one.
 */
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EffectExplorer } from "@/components/dashboard/evidence/effect-explorer";
import { HitFilters } from "@/components/dashboard/hit-report/filters";
import { HitTable } from "@/components/dashboard/hit-report/table";
import {
  Card,
  FootLink,
  FootNote,
  KpiStrip,
  KpiTile,
  PageHeader,
  Panel,
  StatusChip,
  statusTone,
} from "@/components/dashboard/ui";
import { geneEvidence, type GeneEvidence } from "@/lib/atlas/query";
import { getAtlasGenes } from "@/lib/atlas/store";
import { getEffectPoints } from "@/lib/data/disagreement";
import { getCurrentContext } from "@/lib/data/org";
import { getGeneOutcomes } from "@/lib/data/outcomes";
import { DETAIL_PAGE_SIZE, SIGNIFICANT_FDR, getScreenDetail } from "@/lib/data/screen-detail";
import { hitHref, isFiltered, parseHitQuery } from "@/lib/report/hit-query";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const HUMAN = 9606;

export default async function ScreenPage(props: PageProps<"/dashboard/screens/[id]">) {
  const [{ id }, search, context] = await Promise.all([props.params, props.searchParams, getCurrentContext()]);
  const query = parseHitQuery(search);
  const result = await getScreenDetail(id, query.page, query);
  if (result.status === "not_found") notFound();
  if (result.status === "unavailable") {
    return (
      <Card title="Screen results unavailable">
        <p className="text-sm">The workspace records could not be read. Reload to try again.</p>
      </Card>
    );
  }

  const { screen, run, stages, comparisons, hits, total, summary } = result.detail;
  const base = `/dashboard/screens/${screen.id}`;

  // A bookmarked page past the end goes to the last page that exists.
  const lastPage = Math.max(1, Math.ceil(total / DETAIL_PAGE_SIZE));
  if (query.page > lastPage) redirect(hitHref(base, query, { page: lastPage }));

  const comparisonNames = new Map(comparisons.map((comparison) => [comparison.id, comparison.name]));
  const humanOnly = screen.taxid !== null && screen.taxid !== HUMAN;

  // Atlas evidence is read from the snapshot on disk, so it does not depend on
  // the workspace database and cannot fail the page. If it cannot be read the
  // column says "Not looked up" instead of implying the Atlas has no record.
  let evidence: Map<string, GeneEvidence> | null = null;
  if (!humanOnly && hits.length > 0) {
    try {
      const index = getAtlasGenes();
      evidence = new Map(hits.map((hit) => [hit.gene_symbol.toUpperCase(), geneEvidence(index, hit.gene_symbol)]));
    } catch (error) {
      console.error(`[screens/page] atlas: ${error instanceof Error ? error.message : "read failed"}`);
    }
  }
  const outcomes = hits.length > 0 ? await getGeneOutcomes(screen.id, [...new Set(hits.map((hit) => hit.gene_symbol))]) : new Map();

  // The plot draws one comparison at a time. When the table is filtered to a
  // comparison that is the one plotted, so the two views never disagree about
  // which contrast the reader is looking at; otherwise it is the primary one.
  const plotComparison =
    comparisons.find((comparison) => comparison.id === query.comparison)
    ?? comparisons.find((comparison) => comparison.is_primary)
    ?? comparisons[0]
    ?? null;
  const points = plotComparison
    ? await getEffectPoints(screen.id, plotComparison.id)
    : ({ status: "unavailable" } as const);

  const role = context.role;
  const canLog = role === "member" || role === "admin" || role === "owner";
  const first = total === 0 ? 0 : (query.page - 1) * DETAIL_PAGE_SIZE + 1;
  const last = (query.page - 1) * DETAIL_PAGE_SIZE + hits.length;
  const filtered = isFiltered(query);
  const link = "rounded px-1.5 py-0.5 text-cyan-600 hover:bg-cyan-50";

  return (
    <div className="flex flex-col gap-3 pb-6">
      <PageHeader
        dense
        title={screen.name}
        body="Recorded results from your workspace"
        actions={
          <>
            <Link href="/dashboard/screens" className="inline-flex h-7 items-center gap-1 text-[12px] text-cyan-600 underline decoration-line-strong underline-offset-2">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All screens
            </Link>
            {run && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                Export
                {(["csv", "json"] as const).map((format) => (
                  <a
                    key={format}
                    href={`/api/report/${screen.id}?format=${format}`}
                    className="rounded-sm uppercase text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
                  >
                    {format}
                    <span className="sr-only"> export of this screen&apos;s recorded results</span>
                  </a>
                ))}
              </span>
            )}
          </>
        }
      />

      <Panel title="Experiment" bodyClassName="py-3">
        <dl className="grid gap-x-8 gap-y-2.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Cell line", screen.cell_line],
            ["Perturbation", screen.modality],
            ["Phenotype", screen.phenotype],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="text-[11px] text-muted">{term}</dt>
              <dd className="text-ink">{value ?? <span className="text-muted">Not recorded</span>}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[11px] text-muted">Screen and QC</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <StatusChip tone={statusTone(screen.status)}>{screen.status}</StatusChip>
              <StatusChip tone={statusTone(screen.qc)}>QC {screen.qc}</StatusChip>
            </dd>
          </div>
        </dl>
        {screen.description && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-[12.5px] leading-snug text-body">{screen.description}</p>}
        {screen.qc === "fail" && (
          <p role="alert" className="mt-3 rounded-md bg-orange-50 px-3 py-2 text-[12.5px] leading-snug text-orange-700">
            QC failed. Review the recorded stage evidence below before interpreting any gene result.
          </p>
        )}
      </Panel>

      {!run ? (
        <Card title="Analysis not recorded">
          <p className="text-sm">
            This screen has no recorded run yet. Gene results and validation confidence are unavailable, and their absence says
            nothing about whether the experiment has hits.
          </p>
        </Card>
      ) : (
        <>
          <KpiStrip
            title="This run"
            count={`${formatNumber(summary.recorded)} gene and comparison records`}
            className="shrink-0"
            footer={<FootNote>Counted over the whole run, whatever filter the table has</FootNote>}
          >
            <KpiTile
              label="Recorded"
              value={formatNumber(summary.recorded)}
              denominator="records"
              definition="One per gene per comparison, exactly as the engine wrote them."
            />
            <KpiTile
              label={`FDR at most ${SIGNIFICANT_FDR}`}
              value={formatNumber(summary.significant)}
              denominator={`of ${formatNumber(summary.recorded)}`}
              definition="A record with no recorded FDR is not counted here, and is not called insignificant."
              tone="cyan"
              href={hitHref(base, query, { maxFdr: SIGNIFICANT_FDR })}
            />
            <KpiTile
              label="Depleted / enriched"
              value={`${formatNumber(summary.depleted)} / ${formatNumber(summary.enriched)}`}
              denominator="records"
              definition="The two arms of the comparison. Together they are every record."
            />
            <KpiTile
              label="With artifact flags"
              value={formatNumber(summary.flagged)}
              denominator={`of ${formatNumber(summary.recorded)}`}
              definition="A flag is a reason to check the hit, not a verdict on it."
              tone="orange"
              href={hitHref(base, query, { flagged: true })}
            />
          </KpiStrip>

          {plotComparison && (
            <Panel
              title="Effect and significance"
              count={
                points.status === "found"
                  ? `${formatNumber(points.recorded)} recorded genes`
                  : "unavailable"
              }
              caveat="Recorded values only. The thresholds emphasise dots and recompute nothing."
              body="flush"
              className="min-h-[460px]"
              footer={
                <FootNote>
                  Click a gene to read its per-guide evidence: how much its guides disagreed
                  against this screen&rsquo;s own spread, whether its call survives dropping one
                  guide, and where each guide cut.
                </FootNote>
              }
            >
              {points.status === "found" ? (
                <EffectExplorer
                  screenId={screen.id}
                  screenName={screen.name}
                  comparisonName={plotComparison.name}
                  points={points.points}
                  recorded={points.recorded}
                  truncatedBy={points.recorded - points.points.length}
                  defaultMaxFdr={SIGNIFICANT_FDR}
                />
              ) : (
                <p className="px-4 py-10 text-center text-[12.5px] text-muted">
                  The recorded effects could not be read. Reload to try again. Their absence
                  here says nothing about what the run recorded.
                </p>
              )}
            </Panel>
          )}

          <Panel
            title="Gene-level evidence"
            count={filtered ? `${formatNumber(total)} match` : `${formatNumber(total)} records`}
            caveat="FDR, effect and artifact flags are different evidence. Validation probabilities are not available."
            body="flush"
            className="min-h-[320px]"
            footer={
              <>
                <FootNote className="hidden md:block">
                  Ordered by {query.sort === "gene" ? "gene" : query.sort === "lfc" ? "effect" : query.sort === "p_value" ? "p-value" : "recorded FDR"}
                  . Engine {run.engine_version ?? "version not recorded"}.
                </FootNote>
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  <nav aria-label="Gene result pages" className="flex items-center gap-2 text-[11px] text-muted">
                    <span className="num" aria-live="polite">
                      {first === 0 ? "No rows" : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)}`}
                    </span>
                    {query.page > 1 ? (
                      <Link className={link} href={hitHref(base, query, { page: query.page - 1 })} replace scroll={false}>Previous</Link>
                    ) : (
                      <span className="px-1.5 text-muted/60" aria-disabled="true">Previous</span>
                    )}
                    <span className="num">Page {query.page} of {lastPage}</span>
                    {query.page < lastPage ? (
                      <Link className={link} href={hitHref(base, query, { page: query.page + 1 })} replace scroll={false}>Next</Link>
                    ) : (
                      <span className="px-1.5 text-muted/60" aria-disabled="true">Next</span>
                    )}
                  </nav>
                  <FootLink href={`/api/report/${screen.id}?format=csv`} download>
                    Export CSV
                    <span className="sr-only"> of every recorded result in this run</span>
                  </FootLink>
                </span>
              </>
            }
          >
            <HitFilters
              comparisons={comparisons.map((comparison) => ({ id: comparison.id, name: comparison.name }))}
              matching={total}
              recorded={summary.recorded}
            />
            {hits.length === 0 ? (
              <p className="px-4 py-10 text-center text-[12.5px] text-muted">
                {summary.recorded === 0
                  ? "No gene results were recorded for this run. This does not establish that the experiment had no hits."
                  : filtered
                    ? "No record matches these filters."
                    : "This page contains no records."}{" "}
                {filtered && (
                  <Link href={base} replace className="text-cyan-600 underline decoration-line-strong underline-offset-2">
                    Clear the filters
                  </Link>
                )}
              </p>
            ) : (
              <HitTable
                hits={hits}
                comparisonNames={comparisonNames}
                query={query}
                basePath={base}
                screenId={screen.id}
                evidence={evidence}
                humanOnly={humanOnly}
                outcomes={outcomes}
                canLog={canLog}
              />
            )}
          </Panel>

          <Panel title="Analysis provenance" count={`run ${run.id.slice(0, 8)}`} bodyClassName="py-3">
            <dl className="grid gap-x-8 gap-y-2.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-[11px] text-muted">Run status</dt>
                <dd><StatusChip tone={statusTone(run.status)}>{run.status}</StatusChip></dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">Engine version</dt>
                <dd className="text-ink">{run.engine_version ?? <span className="text-muted">Not recorded</span>}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-muted">Container digest</dt>
                <dd className="break-all text-ink">{run.image_digest ?? <span className="text-muted">Not recorded</span>}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-muted">Run ID</dt>
                <dd className="break-all font-mono text-[11px] text-ink">{run.id}</dd>
              </div>
            </dl>
            {run.error && <p className="mt-3 whitespace-pre-wrap text-[12.5px] text-orange-700">{run.error}</p>}
            {stages.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-muted">No stage evidence was recorded.</p>
            ) : (
              <ol className="mt-4 divide-y divide-line border-t border-line">
                {stages.map((stage) => (
                  <li key={stage.stage} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-[12.5px]">
                    <span className="w-28 shrink-0 font-medium text-ink">{stage.stage}</span>
                    <StatusChip tone={statusTone(stage.status)}>{stage.status}</StatusChip>
                    {stage.tool && <span className="text-muted">{stage.tool}</span>}
                    {stage.detail && <span className="basis-full whitespace-pre-wrap text-[12px] text-muted">{stage.detail}</span>}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-[11.5px] text-muted">
              For programmatic access, use a workspace key on the{" "}
              <Link href="/dashboard/connect" className="text-cyan-600 underline">Connect hits API</Link>. A PDF is not built for workspace runs.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
