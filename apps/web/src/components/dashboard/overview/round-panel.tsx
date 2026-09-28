"use client";

/**
 * "This round": what the shortlist is for.
 *
 * WHY THE PAGE NEEDED THIS. The overview exists so that somebody can choose about
 * ten genes out of a few hundred. It grew a checkbox, and then nothing consumed
 * it: the picks went into one browser's local storage, had exactly one reader,
 * which was the checkbox itself, and there was no route from ten ticked genes to a
 * construct list, a guide set or an order. A control whose output nothing reads is
 * a control that does not work.
 *
 * So the picks land here, beside the table, and they land as three things a
 * validation round actually needs: the genes, the assay each one would be re-tested
 * in, and a file. The file is the same shape as the plate order list the screen
 * workspace already writes, and for the same reason it carries no oligos: there is
 * no guide table behind these rows, so inventing one would put sequences somebody
 * could order into a file that came from a demo.
 *
 * It also absorbs the slack in this column. Before, the outcomes panel above it
 * grew instead, which put a measured 282px of empty white inside a panel at 1728
 * wide, directly beside a table that was hiding fifty-four rows.
 */

import { ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo } from "react";

import {
  Empty,
  FootNote,
  Panel,
  PanelLink,
} from "@/components/dashboard/ui";
import { formatNumber } from "@/lib/utils";

import { candidatesCsv, downloadCsv } from "./export-rows";
import { pickKey, useShortlist } from "./shortlist";
import type { CandidateRow } from "./types";
import { usePanelUrl } from "./url-state";

/**
 * Genes in one validation round, as a target rather than a limit.
 *
 * A PI approves thirty to fifty arrayed constructs, which is ten to twelve genes
 * at four guides each. It is printed as the denominator so a reader can see how
 * much of their round is spent, and nothing enforces it: a reader who wants
 * fifteen is not wrong, they are making a different argument to their PI.
 */
const ROUND_TARGET = 12;

export function RoundPanel({
  rows,
  sample,
  caveat,
  className,
}: {
  /** Every candidate on the page, so a pick can be resolved to its evidence. */
  rows: CandidateRow[];
  sample: boolean;
  /** The QC caveat, repeated into the exported file rather than onto the panel. */
  caveat: string | null;
  className?: string;
}) {
  // The candidates panel's own slice of the query string, so a pick made in the
  // table and a pick removed here are the same parameter and cannot disagree.
  const { get, set } = usePanelUrl("c");
  const { picked, toggle, clear } = useShortlist(get, set);

  const chosen = useMemo(
    () => rows.filter((row) => picked.includes(pickKey(row.screenId, row.gene))),
    [rows, picked],
  );

  // A pick can outlive the rows it was made against: a gene answered at the bench
  // leaves the queue, and a link can arrive carrying a gene from another
  // workspace. Counted separately rather than dropped, because silently losing a
  // pick a reader made is worse than saying the row is gone.
  const orphans = picked.length - chosen.length;

  const onExport = useCallback(() => {
    const csv = candidatesCsv(chosen, {
      filter: `the ${chosen.length} candidates shortlisted for this validation round`,
      sort: "the order they were picked in",
      provenance: "Shortlist assembled in the SplicR console overview",
      caveat,
      sample,
      picked,
      keyOf: (row) => pickKey(row.screenId, row.gene),
    });
    downloadCsv(`splicr-round-${chosen.length}-genes.csv`, csv);
  }, [chosen, caveat, sample, picked]);

  return (
    <Panel
      id="panel-round"
      title="This round"
      count={
        picked.length === 0
          ? undefined
          : `${formatNumber(picked.length)} of about ${ROUND_TARGET} genes`
      }
      span={6}
      className={className}
      bodyClassName="py-2.5"
      control={
        picked.length === 0 ? (
          <PanelLink href="/dashboard/planner">Cost a round</PanelLink>
        ) : (
          <button
            type="button"
            onClick={clear}
            className="btn btn-ghost h-7 rounded-md px-2.5 py-0 text-[11px]"
          >
            Clear
          </button>
        )
      }
      footer={
        picked.length === 0 ? undefined : (
          <>
            {/* The one thing a reader has to know about where their picks live,
                said where they can see it rather than in a source comment. */}
            <FootNote>In this page&rsquo;s address, so the link carries the round.</FootNote>
            <button
              type="button"
              onClick={onExport}
              disabled={chosen.length === 0}
              className="shrink-0 text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600 disabled:text-muted disabled:no-underline"
            >
              Round list (CSV)
            </button>
          </>
        )
      }
    >
      {picked.length === 0 ? (
        <Empty
          title="Nothing picked yet"
          body="Tick a gene in Validate next. The picks go into this page's address, so the shortlist is something you can send to a PI rather than something trapped in this browser."
        />
      ) : (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {chosen.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => toggle(pickKey(row.screenId, row.gene))}
                  title={
                    row.benchAssay === null
                      ? `Drop ${row.gene} from this round`
                      : `${row.gene}: ${row.benchAssay}. Select to drop it from this round.`
                  }
                  className="inline-flex items-center gap-1 rounded-md bg-mist-soft px-1.5 py-0.5 text-[11px] text-ink transition-colors duration-[var(--dur-1)] hover:bg-orange-50 hover:text-orange-700 motion-reduce:transition-none"
                >
                  <span className="num">{row.gene}</span>
                  <X className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">, drop from this round</span>
                </button>
              </li>
            ))}
          </ul>

          {orphans > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-muted">
              {orphans === 1
                ? "One pick is not in the candidate list on this page, so it is counted but not listed."
                : `${formatNumber(orphans)} picks are not in the candidate list on this page, so they are counted but not listed.`}{" "}
              That happens when a gene has since been answered at the bench, or when
              the link came from another workspace.
            </p>
          )}

          <p className="mt-2 text-[11px] leading-snug text-muted">
            {chosen.length >= ROUND_TARGET
              ? `That is a full round at four guides a gene. ${formatNumber(chosen.length * 4)} constructs.`
              : `${formatNumber(ROUND_TARGET - chosen.length)} more would fill a plate at four guides a gene.`}{" "}
            <Link
              href="/dashboard/planner"
              className="text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
            >
              Cost it in the planner
              <ArrowUpRight className="inline h-3 w-3" aria-hidden="true" />
            </Link>
          </p>
        </>
      )}
    </Panel>
  );
}
