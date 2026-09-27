import type { Outcome } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

/**
 * A bench result, in the words of the bench.
 *
 * This is deliberately not VerdictBadge. A verdict is the engine's call about
 * whether a signal is the gene; an outcome is what happened when somebody put
 * the gene back on a plate. Running the second through the first is how the
 * Truth Loop came to print "Uncertain" over an experiment that was still
 * running and "Artifact" over one that simply did not validate, which is a
 * mechanistic claim the bench never made.
 *
 * One map, exported, so the overview and the Truth Loop cannot word the same
 * row two different ways again.
 */
export const OUTCOME_RESULT: Record<Outcome["result"], { label: string; tone: string }> = {
  validated: { label: "Validated at the bench", tone: "bg-cyan-50 text-cyan-700" },
  failed: { label: "Did not validate", tone: "bg-orange-50 text-orange-700" },
  inconclusive: { label: "Inconclusive", tone: "bg-mist-soft text-muted" },
  pending: { label: "Still at the bench", tone: "bg-mist-soft text-muted" },
};

export function OutcomeBadge({ result }: { result: Outcome["result"] }) {
  const { label, tone } = OUTCOME_RESULT[result];
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs whitespace-nowrap", tone)}>{label}</span>
  );
}
