import type { BatchPlan } from "./model";

export interface RecordedResult {
  experiment_id: string;
  decision: string;
  measurement: Record<string, unknown>;
}

/** Experiment-level endpoint yield. Separate modalities; no causal superiority test. */
export function evaluateBatch(plan: BatchPlan, outcomes: RecordedResult[]) {
  const byId = new Map(outcomes.map((o) => [o.experiment_id, o]));
  if (byId.size !== outcomes.length) throw new Error("Duplicate experiment outcomes cannot be counted as independent validation.");
  const arms = ["splicr", "investigator", "missed_sample"].map((arm) => {
    const selected = plan.experiments.filter((e) => e.wanted_by.includes(arm));
    const recorded = selected.flatMap((e) => byId.has(e.id) ? [byId.get(e.id)!] : []);
    const decided = recorded.filter((o) => ["validated", "failed"].includes(o.decision));
    const actualCost = recorded.reduce((s, o) => s + (typeof o.measurement.actual_cost === "number" && Number.isFinite(o.measurement.actual_cost) ? o.measurement.actual_cost : 0), 0);
    const modalities = [...new Set(selected.map((e) => e.kind))].map((kind) => {
      const ids = new Set(selected.filter((e) => e.kind === kind).map((e) => e.id));
      const complete = decided.filter((o) => ids.has(o.experiment_id));
      const confirmed = complete.filter((o) => o.decision === "validated");
      return { kind, selected: ids.size, decided: complete.length, confirmed: confirmed.length,
        confirmed_targets: new Set(confirmed.map((o) => selected.find((e) => e.id === o.experiment_id)!.gene)).size };
    });
    return { arm, selected: selected.length, recorded: recorded.length, decided: decided.length,
      confirmed: decided.filter((o) => o.decision === "validated").length,
      inconclusive: recorded.filter((o) => o.decision === "inconclusive").length,
      unscored: recorded.filter((o) => ["insufficient_record", "reported_only"].includes(o.decision)).length,
      outstanding: selected.length - recorded.length, actual_cost: actualCost, modalities };
  });
  const overlap = plan.experiments.filter((e) => e.wanted_by.includes("splicr") && e.wanted_by.includes("investigator")).length;
  return { arms, overlap, comparable: plan.investigator_ids.length > 0 && arms.slice(0, 2).every((a) => a.decided === a.selected && a.selected > 0),
    notes: "These are descriptive experiment-level endpoint results. Engagement checks and unscored combinations are not confirmations. Genetic, pharmacologic and partial-suppression results remain separate. A single batch cannot establish biological superiority, a biomarker or a therapeutic window." };
}
