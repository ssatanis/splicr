"use client";

/**
 * The slate: which genes go to the bench this round.
 *
 * The surface this replaces was a 76-row table with nine filter chips, and it
 * handed the reader the ranking problem back. A lab does not want a filterable
 * list of 76 candidates; it has bench time for about twelve and needs to know
 * which twelve, and to be able to defend the choice to a PI.
 *
 * So the budget is the input and the slate is the output. The reader says how
 * many they can validate; the ranking fills that many; alternates sit below, one
 * click from swapping in. Everything else — thresholds, the full list, exports —
 * lives a level down, because nothing should be configurable before the reader
 * has seen what they are configuring.
 *
 * Genes whose evidence was never recorded are held out of both lists entirely and
 * counted separately. They are not weak, they are unmeasured, and a slate that
 * silently mixed the two would be the exact error this console exists to avoid.
 */
import { useMemo, useState } from "react";

import { GuideChart, GuideSpark } from "@/components/dashboard/evidence/guide-chart";
import type { CandidateRow } from "@/components/dashboard/overview/types";
import {
  compareTier,
  evidenceTier,
  flagLabel,
  NOT_CALIBRATED,
  NOT_CALIBRATED_LONG,
  type Tier,
  type TierResult,
} from "@/lib/evidence/tier";

const TIER_STYLE: Record<Tier, string> = {
  Strong: "bg-teal-800 text-white",
  Moderate: "bg-teal-800/12 text-ink",
  Weak: "bg-orange-50 text-orange-700",
  "Not enough evidence recorded": "bg-cream text-muted",
};

function TierChip({ tier }: { tier: Tier }) {
  const short = tier === "Not enough evidence recorded" ? "Not recorded" : tier;
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${TIER_STYLE[tier]}`}
    >
      {short}
    </span>
  );
}

interface Scored {
  row: CandidateRow;
  tier: TierResult;
}

export function Slate({
  rows,
  defaultBudget = 12,
}: {
  rows: CandidateRow[];
  defaultBudget?: number;
}) {
  const [budget, setBudget] = useState(defaultBudget);
  const [dropped, setDropped] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const scored = useMemo(
    () =>
      rows
        .map((row) => ({ row, tier: evidenceTier(row) }))
        .sort((a, b) => compareTier(a.tier, b.tier)),
    [rows],
  );

  // Unmeasured genes are held out of the ranking, never ranked last within it.
  const placeable = scored.filter((s) => s.tier.tier !== "Not enough evidence recorded");
  const unmeasured = scored.filter((s) => s.tier.tier === "Not enough evidence recorded");

  const eligible = placeable.filter((s) => !dropped.includes(s.row.id));
  const slate = eligible.slice(0, budget);
  const alternates = eligible.slice(budget, budget + 6);

  const strong = slate.filter((s) => s.tier.tier === "Strong").length;
  const moderate = slate.filter((s) => s.tier.tier === "Moderate").length;

  return (
    <div className="space-y-6">
      {/* ---------- the budget, the only control at this level ---------- */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-line bg-white p-5">
        <label className="flex items-center gap-3 text-[15px] text-body">
          <span>I can validate</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, placeable.length)}
            value={budget}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) setBudget(Math.max(1, Math.min(next, placeable.length || 1)));
            }}
            className="w-16 rounded-lg border border-line bg-cream px-2 py-1 text-center font-serif text-[22px] text-ink tabular-nums focus:border-teal-800/40 focus:outline-none"
            aria-label="Validation budget for this round"
          />
          <span>genes this round.</span>
        </label>

        <p className="text-[12px] text-muted">
          {slate.length} on the slate
          {strong > 0 ? ` · ${strong} Strong` : ""}
          {moderate > 0 ? ` · ${moderate} Moderate` : ""}
          {dropped.length > 0 ? ` · ${dropped.length} dropped` : ""}
        </p>
      </div>

      {/* ---------- the slate ---------- */}
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            The slate
          </h2>
          <span
            className="text-[10.5px] text-muted"
            title={NOT_CALIBRATED_LONG}
          >
            {NOT_CALIBRATED}
          </span>
        </div>

        {slate.length === 0 ? (
          <p className="rounded-xl border border-line bg-white p-6 text-[13px] text-body">
            Nothing to rank. Either no hit carries enough recorded evidence, or the
            read did not complete. Nothing is being reported as zero.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {slate.map((s, i) => (
              <GeneRow
                key={s.row.id}
                scored={s}
                position={i + 1}
                open={open === s.row.id}
                onToggle={() => setOpen(open === s.row.id ? null : s.row.id)}
                onDrop={() => setDropped([...dropped, s.row.id])}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---------- alternates ---------- */}
      {alternates.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Next in line
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white/60">
            {alternates.map((s, i) => (
              <GeneRow
                key={s.row.id}
                scored={s}
                position={budget + i + 1}
                muted
                open={open === s.row.id}
                onToggle={() => setOpen(open === s.row.id ? null : s.row.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------- held out, never merged into Weak ---------- */}
      {unmeasured.length > 0 ? (
        <section className="rounded-xl border border-line bg-cream/60 p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Waiting on data ({unmeasured.length})
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-snug text-body">
            Held out of the ranking because too little was recorded to place them.
            This is not the same as ranking badly.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {unmeasured.slice(0, 12).map((s) => (
              <li key={s.row.id} className="text-[12px] text-body">
                <span className="font-medium text-ink">{s.row.gene}</span>{" "}
                <span className="text-muted">{s.tier.missing.join(", ")} not recorded</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dropped.length > 0 ? (
        <button
          type="button"
          onClick={() => setDropped([])}
          className="text-[12px] text-teal-800/70 underline-offset-2 hover:text-ink hover:underline"
        >
          Restore {dropped.length} dropped {dropped.length === 1 ? "gene" : "genes"}
        </button>
      ) : null}
    </div>
  );
}

function GeneRow({
  scored,
  position,
  open,
  onToggle,
  onDrop,
  muted = false,
}: {
  scored: Scored;
  position: number;
  open: boolean;
  onToggle: () => void;
  onDrop?: () => void;
  muted?: boolean;
}) {
  const { row, tier } = scored;
  const mechanismFlags = row.flags ?? [];

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted">
          {position}
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
        >
          <span
            className={`w-24 shrink-0 truncate text-[14px] font-medium ${muted ? "text-body" : "text-ink"}`}
          >
            {row.gene}
          </span>

          <TierChip tier={tier.tier} />

          <GuideSpark values={row.guideLfcs} className="shrink-0" />

          {/* A reason repeated down every row is noise, not information. When
              every component agrees the row shows what it measured instead, and
              the sentence is kept for the rows that have something to explain. */}
          {tier.tier === "Strong" ? (
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
              {typeof row.lfc === "number" ? (
                <span className="tabular-nums text-body">
                  {row.lfc > 0 ? "+" : ""}
                  {row.lfc.toFixed(2)} log₂
                </span>
              ) : null}
              {typeof row.guidesAgree === "number" && typeof row.guides === "number"
                ? ` · ${row.guidesAgree}/${row.guides} guides`
                : ""}
              {typeof row.fdr === "number" ? ` · q ${row.fdr.toFixed(3)}` : ""}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
              {tier.because}
            </span>
          )}
        </button>

        {onDrop ? (
          <button
            type="button"
            onClick={onDrop}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-cream hover:text-ink"
            aria-label={`Drop ${row.gene} from the slate`}
          >
            Drop
          </button>
        ) : null}
      </div>

      {/* Level 1: the evidence behind the answer. */}
      {open ? (
        <div className="grid gap-6 border-t border-line bg-cream/50 px-4 py-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              What the guides did
            </h3>
            <GuideChart values={row.guideLfcs} goodGuides={row.guidesAgree} />
          </div>

          <div>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              Why {tier.tier}
            </h3>
            <dl className="space-y-1.5">
              {tier.components.map((c) => (
                <div key={c.field} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[11.5px] text-body">{c.label}</dt>
                  <dd
                    className={`shrink-0 text-right text-[11.5px] tabular-nums ${
                      c.value === null ? "text-muted" : "text-ink"
                    }`}
                  >
                    {c.value ?? "Not recorded"}
                  </dd>
                </div>
              ))}
            </dl>

            {mechanismFlags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {mechanismFlags.map((f) => (
                  <span
                    key={f}
                    className="rounded-md bg-orange-50 px-2 py-0.5 text-[10.5px] text-orange-700"
                  >
                    {flagLabel(f)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
