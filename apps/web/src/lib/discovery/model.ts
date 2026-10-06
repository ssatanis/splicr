import type { BatchDesign, DiscoveryDocument, ModelContext } from "./schema";
import { DISCOVERY_VERSION } from "./schema";

export interface DiscoveryHit {
  gene: string;
  lfc: number | null;
  fdr: number | null;
  guide_lfcs: number[] | null;
  flags: string[];
}
export type ExperimentKind = "orthogonal_confirmation" | "pharmacologic_confirmation" | "engagement" | "perturbation_check" | "partial_suppression" | "combination";
export interface Experiment {
  id: string;
  gene: string;
  partner: string | null;
  model_id: string;
  kind: ExperimentKind;
  compound: string | null;
  dose_um: number | null;
  time_hours: number | null;
  priority: number;
  allocation: "confirmation" | "exploration";
  pattern: string;
  next_experiment: string;
  alternatives: string[];
  controls: string[];
  evidence_ids: string[];
  measured_lfc: number | null;
  measured_fdr: number | null;
  reference: ReferenceSummary;
  molecular: DiscoveryDocument["molecular"][number] | null;
  drug_evidence: (DiscoveryDocument["drugs"][number] & { growth_rate: number | null })[];
  combination_evidence: (DiscoveryDocument["combination_assays"][number] & { bliss_excess: number | null })[];
  warnings: string[];
}
export interface ReferenceSummary {
  n_biological_units: number;
  n_studies: number;
  mean: number | null;
  sd: number | null;
  local_minus_reference: number | null;
  excluded: number;
  because: string;
}
const mean = (v: number[]) => v.reduce((sum, n) => sum + n, 0) / v.length;
const present = (n: number | null): n is number => n !== null && Number.isFinite(n);

/** A descriptive comparator, never a pooled screen significance or causal biomarker. */
export function matchedReference(gene: string, local: number | null, doc: DiscoveryDocument): ReferenceSummary {
  const all = doc.references.filter((r) => r.gene === gene);
  const fields = ["lineage", "culture", "medium", "matrix", "library", "modality", "endpoint", "time_hours", "effect_metric"] as const;
  const complete = fields.every((key) => doc.context[key] !== null && doc.context[key] !== "unknown" && doc.context[key] !== "other");
  const matched = complete ? all.filter((r) =>
    r.context.biological_unit !== doc.context.biological_unit && r.context.model_id !== doc.context.model_id &&
    fields.every((key) => r.context[key] === doc.context[key]) &&
    (doc.context.subtype === null || r.context.subtype === doc.context.subtype),
  ) : [];
  // A patient's repeated models, sources and replicates contribute one value.
  const byUnit = new Map<string, typeof matched>();
  for (const row of matched) byUnit.set(row.context.biological_unit, [...(byUnit.get(row.context.biological_unit) ?? []), row]);
  const values = [...byUnit.values()].map((rows) => mean(rows.map((r) => r.effect)));
  const average = values.length > 0 ? mean(values) : null;
  const studies = new Set(matched.map((r) => r.study_id)).size;
  return {
    n_biological_units: values.length, n_studies: studies,
    mean: average,
    sd: values.length >= 3 ? Math.sqrt(values.reduce((s, v) => s + (v - average!) ** 2, 0) / (values.length - 1)) : null,
    local_minus_reference: average !== null && present(local) ? local - average : null,
    excluded: all.length - matched.length,
    because: !complete ? "Local context is incomplete; reference matching is unavailable."
      : values.length === 0 ? "No independent references match assay scale, lineage, culture, medium, matrix, library and timing."
      : `${values.length} independent biological units in ${studies} studies; descriptive effects only. Repeated units were averaged.`,
  };
}

export function growthRate(initial: number | null, control: number | null, treated: number | null): number | null {
  if (!present(initial) || !present(control) || !present(treated) || initial <= 0 || control <= initial || treated < 0) return null;
  if (treated === 0) return -1;
  const gr = 2 ** (Math.log2(treated / initial) / Math.log2(control / initial)) - 1;
  return Number.isFinite(gr) ? gr : null;
}

/** Fractional viabilities at the SAME doses/time: positive excess means stronger killing than Bliss. */
export function blissExcess(singleA: number, singleB: number, combination: number): number {
  if (![singleA, singleB, combination].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("Bliss requires fractional viabilities from 0 to 1 with matched controls, doses and timing.");
  return singleA * singleB - combination;
}

function key(gene: string, kind: ExperimentKind, compound: string | null, dose: number | null, partner: string | null, time: number | null) {
  const targets = kind === "combination" && partner ? [gene, partner].sort() : [gene, partner ?? ""];
  return [targets[0], kind, compound === null ? "" : encodeURIComponent(compound), dose ?? "", targets[1], time ?? ""].join("|");
}

export function buildWorklist(hits: DiscoveryHit[], doc: DiscoveryDocument): Experiment[] {
  const byGene = new Map(hits.map((h) => [h.gene.toUpperCase(), h]));
  if (byGene.size !== hits.length) throw new Error("This comparison contains duplicate normalized gene symbols; resolve their identity before building a worklist.");
  const genes = new Set([...byGene.keys()].filter((gene) => {
    const h = byGene.get(gene)!;
    return present(h.fdr) && present(h.lfc) && h.fdr <= doc.thresholds.fdr && h.lfc <= -doc.thresholds.depletion_lfc;
  }));
  for (const gene of [...doc.drugs.map((d) => d.gene), ...doc.molecular.map((m) => m.gene), ...doc.partial_suppression.map((p) => p.gene), ...doc.pairs.flatMap((p) => [p.gene, p.partner]), ...doc.nominations.map((n) => n.gene), ...doc.combination_assays.map((c) => c.gene)]) genes.add(gene);
  const result: Experiment[] = [];
  for (const gene of [...genes].sort()) {
    const hit = byGene.get(gene);
    const lfc = hit?.lfc ?? null;
    const fdr = hit?.fdr ?? null;
    const baseline = ["knockout", "crispri", "rnai"].includes(doc.context.modality) && doc.context.effect_metric === "log2_fold_change";
    const signal = baseline && present(lfc) && present(fdr) && fdr <= doc.thresholds.fdr && lfc <= -doc.thresholds.depletion_lfc;
    const agreeing = hit?.guide_lfcs?.filter((v) => Number.isFinite(v) && v < 0).length ?? null;
    const reliable = signal && agreeing !== null && agreeing >= 2 && !(hit?.flags ?? []).some((f) => ["single_guide", "low_coverage", "bottleneck", "low_plasmid_representation", "copy_number_cluster"].includes(f));
    const molecular = doc.molecular.find((m) => m.gene === gene) ?? null;
    const ref = matchedReference(gene, lfc, doc);
    const warnings = [
      ...(!baseline ? ["This comparison is not a baseline genetic depletion assay; its effect cannot establish baseline essentiality."] : []),
      ...(!hit ? ["No recorded screen statistic for this target."] : []),
      ...(agreeing === null ? ["Guide-level support was not recorded."] : agreeing < 2 ? ["Fewer than two depleted guides; inspect perturbation and assay power."] : []),
      ...(hit?.flags ?? []).map((f) => `Screen flag: ${f}.`),
      ...(molecular?.copy_number !== null && molecular?.copy_number !== undefined && molecular.copy_number > 4 ? ["Amplification may cause cutting toxicity or incomplete disruption. Copy number does not identify which mechanism occurred."] : []),
      ...(molecular?.pan_essential ? ["Pan-essential knockout status does not rule out selective partial suppression or establish a therapeutic window."] : []),
    ];
    const base = { gene, model_id: doc.context.model_id, measured_lfc: lfc, measured_fdr: fdr, reference: ref, molecular, warnings, drug_evidence: [] as Experiment["drug_evidence"], combination_evidence: [] as Experiment["combination_evidence"] };
    const add = (kind: ExperimentKind, pattern: string, next: string, priority: number, allocation: Experiment["allocation"], evidence: string[], alternatives: string[], drug: DiscoveryDocument["drugs"][number] | null = null, partner: string | null = null) => {
      result.push({ ...base, id: key(gene, kind, drug?.compound ?? null, drug?.dose_um ?? null, partner, drug?.time_hours ?? doc.context.time_hours), kind, pattern, next_experiment: next,
        priority, allocation, compound: drug?.compound ?? null, dose_um: drug?.dose_um ?? null, time_hours: drug?.time_hours ?? doc.context.time_hours,
        partner, evidence_ids: [...new Set(evidence)], alternatives,
        drug_evidence: drug ? doc.drugs.filter((d) => d.gene === gene && d.model_id === doc.context.model_id && d.compound === drug.compound && d.dose_um === drug.dose_um && d.time_hours === drug.time_hours).map((d) => ({ ...d, growth_rate: growthRate(d.initial_cells, d.control_cells, d.treated_cells) })) : [],
        controls: kind === "combination" ? ["Each single perturbation at matched doses", "Nontargeting and matched cutting controls", "Independent constructs", "Measured efficiency of both perturbations", "Replicated interaction against a prespecified null"]
          : ["Independent perturbation or orthogonal reagent", "Nontargeting or vehicle control", "Biological replicates", "Measured protein loss or target engagement"],
      });
    };
    const localDrugs = doc.drugs.filter((d) => d.gene === gene && d.model_id === doc.context.model_id);
    // Different doses/replicates remain separate; no best-dose claim of an IC50.
    const drugGroups = new Map<string, typeof localDrugs>();
    for (const d of localDrugs) {
      const id = `${d.compound}|${d.dose_um}|${d.time_hours}`;
      drugGroups.set(id, [...(drugGroups.get(id) ?? []), d]);
    }
    for (const rows of drugGroups.values()) {
      const d = rows[0];
      const adequate = rows.every((r) => r.biological_replicates >= doc.thresholds.minimum_drug_replicates);
      const active = adequate && rows.every((r) => r.relative_viability <= doc.thresholds.drug_viability);
      const inactive = adequate && rows.every((r) => r.relative_viability > doc.thresholds.drug_viability);
      const evidence = rows.map((r) => r.id);
      if (reliable && active) {
        add("orthogonal_confirmation", "Genetic depletion and drug activity agree", "Confirm with independent constructs and an orthogonal perturbation; assess target specificity separately.", 6, "confirmation", evidence, ["Compound activity may involve additional targets", "Agreement does not establish cross-model selectivity"], d);
        add("pharmacologic_confirmation", "Compound response needs independent on-target confirmation", "Repeat the compound response with measured engagement, selective chemistry and appropriate specificity controls.", 5, "confirmation", evidence, ["Drug activity does not establish on-target action", "No normal-tissue therapeutic window was measured"], d);
      }
      else if (signal && inactive) add("engagement", "Genetic depletion with no activity at the measured dose", rows.every((r) => r.engagement === "yes") ? "Compare partial suppression, degradation and catalytic inhibition at measured engagement." : "Measure target engagement and protein loss at this dose before interpreting the absent drug phenotype.", 5, "exploration", evidence, ["Insufficient engagement", "Catalytic versus scaffolding functions", "Genetic cutting artifact or assay context"], d);
      else if (!signal && active) add("perturbation_check", "Drug activity without supported genetic depletion", "Measure knockout/protein loss, repeat with independent guides, and test alternative compound targets.", 5, "exploration", evidence, ["Incomplete perturbation or low assay power", "Drug off-target activity", "Partial suppression differs from complete knockout"], d);
      else add("engagement", "Drug/genetic comparison is unresolved", "Repeat the dose-response with biological replicates and engagement measurements.", 2, "exploration", evidence, ["Insufficient or conflicting drug measurements", "Assay timing or depletion floor"], d);
      if (rows.some((r) => r.selective !== "yes")) result[result.length - 1].warnings = [...warnings, "Compound selectivity is unknown or not supported; activity is not on-target proof."];
    }
    if (signal && localDrugs.length === 0) add(reliable ? "orthogonal_confirmation" : "perturbation_check", reliable ? "Supported genetic depletion; pharmacology unmeasured" : "Genetic depletion needs guide and artifact checks", reliable ? "Repeat with independent constructs, measure protein loss, and test an orthogonal perturbation." : "Resolve guide disagreement, coverage and cutting artifacts before advancing the target.", reliable ? 4 : 3, reliable ? "confirmation" : "exploration", [], ["Genetic reproduction does not establish inhibitor activity", "Model or culture-specific dependency"]);
    const partial = doc.partial_suppression.filter((p) => p.gene === gene && p.selective_dependency && p.context.lineage !== null && p.context.lineage === doc.context.lineage && ["crispri", "rnai"].includes(p.context.modality));
    if (partial.length > 0) add("partial_suppression", "Context-related partial-suppression evidence", "Titrate CRISPRi or another orthogonal suppression assay, measure protein loss and compare independent models.", 4, "exploration", partial.map((p) => p.id), ["RNAi off-target effects", "Reference culture may differ", "Selective dependency requires independent-model validation"]);
    for (const p of doc.pairs.filter((p) => p.gene === gene && p.reagents_available && p.model_id === doc.context.model_id && p.biological_unit === doc.context.biological_unit)) {
      add("combination", `Combination hypothesis from ${p.evidence.replaceAll("_", " ")}`, "Test the pair with each single perturbation and measured efficiency; quantify an interaction against a prespecified null.", p.evidence === "independent_pair_screen" ? 4 : 3, "exploration", [p.id], ["Double depletion alone is not synthetic lethality", "Interaction may depend on context or dose"], null, p.partner);
    }
    if (!result.some((e) => e.gene === gene) && molecular) add("perturbation_check", "Nominated target without supported depletion", "Measure perturbation efficiency and assay power with independent constructs before interpreting a negative phenotype.", 1, "exploration", [], ["Perturbation failure", "True negative or buffering", "A molecular feature alone is not a dependency"]);
    for (const n of doc.nominations.filter((n) => n.gene === gene)) {
      // Expert candidates outside the heuristic hit list remain eligible in the
      // same candidate universe and can be scored with the same frozen endpoint.
      const nominated: Experiment = { ...base, id: key(gene, n.assay, n.compound, n.dose_um, null, n.time_hours ?? doc.context.time_hours),
        kind: n.assay, partner: null, compound: n.compound, dose_um: n.dose_um, time_hours: n.time_hours ?? doc.context.time_hours,
        priority: 0, allocation: "exploration", pattern: "Explicit laboratory nomination", next_experiment: n.rationale,
        evidence_ids: [n.id], alternatives: ["Laboratory nomination is not evidence of a confirmed dependency"],
        controls: ["Independent perturbation", "Biological replicates", "Matched controls", "Measured perturbation success or engagement"] };
      result.push(nominated);
    }
    for (const c of doc.combination_assays.filter((c) => c.gene === gene && c.model_id === doc.context.model_id && c.biological_unit === doc.context.biological_unit)) {
      const adequate = c.matched_controls && c.biological_replicates >= doc.thresholds.minimum_drug_replicates;
      const excess = adequate ? blissExcess(c.single_a_viability, c.single_b_viability, c.combination_viability) : null;
      const reagents = [`${encodeURIComponent(c.compound_a)}:${c.dose_a_um}`, `${encodeURIComponent(c.compound_b)}:${c.dose_b_um}`].sort().join("+");
      result.push({ ...base, id: `${key(gene, "combination", null, null, c.partner, c.time_hours)}|${reagents}`, kind: "combination", partner: c.partner,
        compound: null, dose_um: null, time_hours: c.time_hours, priority: adequate && excess !== null && excess > 0 ? 4 : 2, allocation: "exploration",
        pattern: adequate ? "Measured combination response; descriptive Bliss comparison" : "Combination assay needs replication or matched controls",
        next_experiment: `Repeat ${c.compound_a} at ${c.dose_a_um} µM with ${c.compound_b} at ${c.dose_b_um} µM, including each single agent and engagement controls.`,
        evidence_ids: [c.id], alternatives: ["Bliss excess alone is not statistical significance or synthetic lethality", "A different interaction null may answer a different biological question"],
        controls: ["Single-agent curves at the same doses and timing", "Matched vehicle controls", "Independent biological replicates", "Target engagement of both compounds", "Prespecified interaction null"],
        combination_evidence: [{ ...c, bliss_excess: excess }] });
    }
  }
  // Equivalent hypotheses from multiple sources produce one experiment, preserving provenance.
  const unique = new Map<string, Experiment>();
  for (const exp of result) {
    const old = unique.get(exp.id);
    if (old) {
      old.evidence_ids = [...new Set([...old.evidence_ids, ...exp.evidence_ids])];
      old.combination_evidence = [...old.combination_evidence, ...exp.combination_evidence];
    }
    else unique.set(exp.id, exp);
  }
  return [...unique.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export interface BatchPlan {
  version: string;
  design: BatchDesign;
  splicr_ids: string[];
  investigator_ids: string[];
  missed_ids: string[];
  experiments: (Experiment & { cost: number; wanted_by: string[] })[];
  universe: Experiment[];
  splicr_cost: number;
  investigator_cost: number;
  union_cost: number;
  exploration_cost: number;
  notes: string[];
}

/** Deterministic cost-constrained heuristic. No calibrated utility or claimed optimum. */
export function selectBatch(universe: Experiment[], design: BatchDesign): BatchPlan {
  const byId = new Map(universe.map((e) => [e.id, e]));
  if (byId.size !== universe.length) throw new Error("Experiment identities must be unique.");
  for (const id of [...design.investigator_ids, ...design.missed_ids, ...Object.keys(design.costs)]) if (!byId.has(id)) throw new Error(`Unknown experiment: ${id}`);
  const cost = (e: Experiment) => design.costs[e.id] ?? design.default_cost;
  const picked: Experiment[] = [];
  let spent = 0;
  let exploration = 0;
  const take = (e: Experiment, cap: number) => {
    if (picked.some((p) => p.id === e.id) || spent + cost(e) > cap) return false;
    picked.push(e); spent += cost(e); return true;
  };
  const exploreCap = design.budget * design.exploration_fraction;
  // Diverse first pass: one target per allocation, then deeper follow-ups.
  const diverse = (rows: Experiment[]) => {
    const seen = new Set<string>();
    const first: Experiment[] = [], rest: Experiment[] = [];
    for (const e of rows) { (seen.has(e.gene) ? rest : first).push(e); seen.add(e.gene); }
    return [...first, ...rest];
  };
  for (const e of diverse(universe.filter((e) => e.allocation === "exploration"))) if (take(e, exploreCap)) exploration += cost(e);
  for (const e of diverse(universe.filter((e) => e.allocation === "confirmation"))) take(e, design.budget);
  for (const e of diverse(universe)) if (take(e, design.budget) && e.allocation === "exploration") exploration += cost(e);
  if (picked.length === 0) throw new Error("No experiment fits this budget. Review assay costs.");
  const investigator = design.investigator_ids.map((id) => byId.get(id)!);
  const investigatorCost = investigator.reduce((s, e) => s + cost(e), 0);
  if (investigatorCost > design.budget) throw new Error("The investigator worklist exceeds the same declared budget.");
  const splicrIds = picked.map((e) => e.id);
  if (design.missed_ids.some((id) => splicrIds.includes(id) || design.investigator_ids.includes(id))) throw new Error("The missed-candidate sample must be outside both selected lists.");
  const union = [...new Set([...splicrIds, ...design.investigator_ids, ...design.missed_ids])];
  const experiments = union.map((id) => ({ ...byId.get(id)!, cost: cost(byId.get(id)!), wanted_by: [
    ...(splicrIds.includes(id) ? ["splicr"] : []), ...(design.investigator_ids.includes(id) ? ["investigator"] : []), ...(design.missed_ids.includes(id) ? ["missed_sample"] : []),
  ] }));
  return { version: DISCOVERY_VERSION, design, universe, experiments, splicr_ids: splicrIds, investigator_ids: design.investigator_ids, missed_ids: design.missed_ids,
    splicr_cost: spent, investigator_cost: investigatorCost, union_cost: experiments.reduce((s, e) => s + e.cost, 0), exploration_cost: exploration,
    notes: ["Evidence-based heuristic worklist; superiority and information gain are unestablished.", "Each strategy has the same selection budget. Testing their union and the missed sample may require additional bench spending.", ...(exploration < exploreCap ? ["The exploration reserve could not be fully spent on eligible experiments; remaining capacity was made available to other candidates."] : []), ...(design.investigator_ids.length === 0 ? ["No investigator ranking was supplied; this batch cannot compare against expert practice."] : []), "Reference differences are descriptive; they are not new p-values, biomarker validation or normal-tissue therapeutic windows."] };
}

export function blankDocument(context: ModelContext): DiscoveryDocument {
  return { version: 1, context, sources: [], molecular: [], drugs: [], references: [], partial_suppression: [], pairs: [], nominations: [], combination_assays: [], thresholds: { fdr: 0.1, depletion_lfc: 0.5, drug_viability: 0.5, minimum_drug_replicates: 3 } };
}
