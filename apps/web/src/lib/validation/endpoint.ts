/**
 * Scoring a recorded measurement against an endpoint, in the browser.
 *
 * WHY THIS LOGIC EXISTS TWICE
 *
 * The engine already decides this, in `engine/splicr/validation/endpoints.py`.
 * The console needs it too, because it shows the reader which criterion carried
 * the decision while they are still looking at the form, and a round trip to
 * Python for every keystroke is not a design.
 *
 * Two copies of a rule is how a console comes to disagree with the engine about
 * whether an experiment validated. So neither the endpoint definitions nor the
 * expected behaviour is retyped:
 *
 *   `endpoints.generated.json`  the registry, written by
 *                               scripts/validation/export_endpoints.py
 *   `tests/fixtures/endpoint-decisions.json`
 *                               1,800 measurements with the engine's own
 *                               verdict on each, replayed against this file by
 *                               apps/web/tests/endpoint-decisions.test.mjs
 *
 * A divergence is a failing test naming the case, and
 * `npm run validation:check` fails the build when the registry has moved and
 * the generated files have not.
 *
 * THE ONE RULE THAT MATTERS MOST
 *
 * A criterion that was not recorded makes the record unscorable. It does not
 * make it a failure. `insufficient_record` keeps the outcome out of a rate's
 * numerator *and* its denominator, which is the only treatment that does not
 * manufacture a statistic out of an incomplete form.
 */

import generated from "./endpoints.generated.json";

import type { EndpointDecision, Question, ValidationType } from "./model";

export interface EndpointDefinition {
  key: string;
  endpoint_id: string;
  version: number;
  label: string;
  question: Question;
  assay_class: string;
  validation_types: readonly string[];
  requires_independent_perturbation: boolean;
  requires_distinct_constructs: boolean;
  min_independent_perturbations: number;
  min_biological_replicates: number;
  direction: "depleted" | "enriched" | "either";
  effect_metric: string;
  effect_threshold: number | null;
  threshold_owner: "laboratory" | "splicr" | "published";
  control_criteria: readonly string[];
  published_example: Record<string, unknown> | null;
  negative_means: string;
  notes: string;
  definition_sha256: string;
}

interface Registry {
  registry_sha256: string;
  endpoints: Record<string, EndpointDefinition>;
  default_endpoint: Record<string, string | null>;
  type_question: Record<string, Question | null>;
}

const REGISTRY = generated as unknown as Registry;

export const REGISTRY_SHA256 = REGISTRY.registry_sha256;

export function allEndpoints(): EndpointDefinition[] {
  return Object.values(REGISTRY.endpoints);
}

export function endpointByKey(key: string): EndpointDefinition | null {
  return REGISTRY.endpoints[key] ?? null;
}

/** The endpoint an outcome of this type is scored against unless told otherwise. */
export function defaultEndpoint(type: ValidationType): EndpointDefinition | null {
  const key = REGISTRY.default_endpoint[type];
  return key ? (REGISTRY.endpoints[key] ?? null) : null;
}

export function endpointsFor(type: ValidationType): EndpointDefinition[] {
  return allEndpoints().filter((endpoint) =>
    endpoint.validation_types.includes(type),
  );
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type CriterionStatus = "pass" | "fail" | "not_recorded";

export interface Criterion {
  name: string;
  label: string;
  status: CriterionStatus;
  detail: string;
}

export interface Decision {
  decision: EndpointDecision;
  endpointKey: string;
  question: Question;
  criteria: Criterion[];
  because: string;
  /** False when the record cannot be scored against this endpoint at all. */
  scorable: boolean;
}

/**
 * A finite number, or null. A boolean is not a number here.
 *
 * `Number(true)` is 1, which would turn "yes, there were replicates" into "one
 * replicate" and let a record clear a floor it never met.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

function controlStatus(
  measurement: Record<string, unknown>,
  control: string,
): boolean | null {
  const controls = measurement.controls;
  if (typeof controls !== "object" || controls === null) return null;
  const value = (controls as Record<string, unknown>)[control];
  return value === null || value === undefined ? null : Boolean(value);
}

/** The threshold shown in a criterion label, formatted the way the engine does. */
function barLabel(threshold: number | null, direction: string): string {
  const bar =
    threshold === null
      ? "the laboratory's prespecified bar"
      : formatBar(Math.abs(threshold));
  return direction !== "either"
    ? `Effect in the ${direction} direction past ${bar}`
    : `Effect past ${bar}`;
}

/**
 * Python's `:g` format, which is what the engine's criterion labels use.
 *
 * Shortest round-trippable representation, trailing zeros dropped, exponent
 * notation outside 1e-5..1e16. Reproduced rather than approximated, because the
 * decision matrix compares criterion names and the label is part of one.
 */
function formatBar(value: number): string {
  if (value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (exponent < -5 || exponent >= 16) {
    return value
      .toExponential(5)
      .replace(/\.?0+e/, "e")
      .replace(/e([+-])(\d)$/, "e$10$2");
  }
  const fixed = value.toPrecision(6);
  return String(Number(fixed));
}

/**
 * Score one measurement against one endpoint.
 *
 * Every clause is evaluated and reported, including the ones that passed, so a
 * reader can see which criterion carried the decision rather than being told a
 * verdict. A required clause whose input was never recorded forces
 * `insufficient_record`, because the alternative is to guess.
 *
 * `pending` and `inconclusive` are never upgraded. A pending assay has no
 * measurement to score, and an inconclusive one was declared undecidable by the
 * people who ran it; this function does not overrule either.
 */
export function decideEndpoint(
  endpoint: EndpointDefinition,
  measurement: Record<string, unknown>,
  options: { laboratoryThreshold?: number | null } = {},
): Decision {
  const base = {
    endpointKey: endpoint.key,
    question: endpoint.question,
  };
  const recorded = measurement.result;
  if (recorded === "pending") {
    return {
      ...base,
      decision: "insufficient_record",
      criteria: [],
      because: "The assay has not finished, so there is nothing to score.",
      scorable: false,
    };
  }
  if (recorded === "inconclusive") {
    return {
      ...base,
      decision: "inconclusive",
      criteria: [],
      because: "Recorded inconclusive by the laboratory that ran it.",
      scorable: true,
    };
  }

  const criteria: Criterion[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const add = (
    name: string,
    label: string,
    status: CriterionStatus,
    detail = "",
  ) => {
    criteria.push({ name, label, status, detail });
  };

  // 1. independence of the perturbation
  if (endpoint.requires_independent_perturbation) {
    const value = measurement.independent_perturbation;
    if (value === null || value === undefined) {
      add("independent_perturbation", "Independent perturbation used", "not_recorded");
      missing.push("whether the perturbation was independent");
    } else if (value) {
      add("independent_perturbation", "Independent perturbation used", "pass");
    } else {
      add(
        "independent_perturbation",
        "Independent perturbation used",
        "fail",
        "The primary screen's own perturbation was reused.",
      );
      failed.push("the perturbation was not independent");
    }
  }

  // 2. distinct from the screen's constructs, where the endpoint asks
  if (endpoint.requires_distinct_constructs) {
    const value = measurement.distinct_from_screen_constructs;
    const label = "Not one of the original screen constructs";
    if (value === null || value === undefined) {
      add("distinct_constructs", label, "not_recorded");
      missing.push("whether the constructs differed from the screen's");
    } else if (value) {
      add("distinct_constructs", label, "pass");
    } else {
      add(
        "distinct_constructs",
        label,
        "fail",
        "The validation reused a construct from the screening library.",
      );
      failed.push("the constructs came from the screening library");
    }
  }

  // 3. how many independent perturbations
  const nPerturbations = int(measurement.n_perturbations);
  const perturbationLabel = `At least ${endpoint.min_independent_perturbations} independent perturbation(s)`;
  if (nPerturbations === null) {
    add("n_perturbations", perturbationLabel, "not_recorded");
    missing.push("the number of independent perturbations");
  } else if (nPerturbations >= endpoint.min_independent_perturbations) {
    add("n_perturbations", perturbationLabel, "pass", `${nPerturbations} used`);
  } else {
    add("n_perturbations", perturbationLabel, "fail", `only ${nPerturbations} used`);
    failed.push(`only ${nPerturbations} independent perturbation(s)`);
  }

  // 4. biological replicates
  const nReplicates = int(measurement.n_replicates);
  const replicateLabel = `At least ${endpoint.min_biological_replicates} biological replicate(s)`;
  if (nReplicates === null) {
    add("n_replicates", replicateLabel, "not_recorded");
    missing.push("the number of biological replicates");
  } else if (nReplicates >= endpoint.min_biological_replicates) {
    add("n_replicates", replicateLabel, "pass", `${nReplicates} recorded`);
  } else {
    add("n_replicates", replicateLabel, "fail", `only ${nReplicates} recorded`);
    failed.push(`only ${nReplicates} biological replicate(s)`);
  }

  // 5. direction and effect size against the prespecified bar
  const threshold =
    endpoint.threshold_owner !== "laboratory"
      ? endpoint.effect_threshold
      : (options.laboratoryThreshold ?? null);
  const effect = num(measurement.effect_size);
  const label = barLabel(threshold, endpoint.direction);
  if (effect === null) {
    add("effect_size", label, "not_recorded");
    missing.push(`the measured ${endpoint.effect_metric}`);
  } else if (threshold === null) {
    add(
      "effect_size",
      label,
      "not_recorded",
      "This endpoint's threshold belongs to the laboratory's assay and was not supplied for this round.",
    );
    missing.push("the laboratory's prespecified effect threshold");
  } else {
    const rightWay =
      endpoint.direction === "either" ||
      (endpoint.direction === "depleted" && effect < 0) ||
      (endpoint.direction === "enriched" && effect > 0);
    const bigEnough = Math.abs(effect) >= Math.abs(threshold);
    if (rightWay && bigEnough) {
      add(
        "effect_size",
        label,
        "pass",
        `${signed(effect)} against a bar of ${Math.abs(threshold).toFixed(3)}`,
      );
    } else if (!rightWay) {
      add(
        "effect_size",
        label,
        "fail",
        `${signed(effect)} is in the opposite direction to the prespecified ${endpoint.direction} effect`,
      );
      failed.push("the effect ran the wrong way");
    } else {
      add(
        "effect_size",
        label,
        "fail",
        `${signed(effect)} does not reach a bar of ${Math.abs(threshold).toFixed(3)}`,
      );
      failed.push("the effect did not reach the prespecified bar");
    }
  }

  // 6. named controls
  for (const control of endpoint.control_criteria) {
    const passed = controlStatus(measurement, control);
    const controlLabel = `Control: ${control.replace(/_/g, " ")}`;
    if (passed === null) {
      add(`control:${control}`, controlLabel, "not_recorded");
      missing.push(`the ${control.replace(/_/g, " ")} control`);
    } else if (passed) {
      add(`control:${control}`, controlLabel, "pass");
    } else {
      add(`control:${control}`, controlLabel, "fail");
      failed.push(`the ${control.replace(/_/g, " ")} control did not pass`);
    }
  }

  if (missing.length > 0) {
    return {
      ...base,
      decision: "insufficient_record",
      criteria,
      because: `Not scorable against this endpoint: ${missing.join(", ")} was not recorded.`,
      scorable: false,
    };
  }
  if (failed.length > 0) {
    return {
      ...base,
      decision: "failed",
      criteria,
      because: `Did not meet the endpoint: ${failed.join("; ")}.`,
      scorable: true,
    };
  }
  return {
    ...base,
    decision: "validated",
    criteria,
    because: "Every prespecified criterion was met.",
    scorable: true,
  };
}

/** `+1.400` / `-0.050`, the way Python's `:+.3f` writes it. */
function signed(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(3)}`;
}

/**
 * Score an outcome where its type implies its endpoint.
 *
 * Returns null when the type bears on no question (`other`), because there is
 * no endpoint to score it against and inventing one would place the record on a
 * rung it does not belong to.
 */
export function decideOutcome(
  type: ValidationType,
  measurement: Record<string, unknown>,
  options: { endpointKey?: string | null; laboratoryThreshold?: number | null } = {},
): Decision | null {
  const endpoint = options.endpointKey
    ? endpointByKey(options.endpointKey)
    : defaultEndpoint(type);
  if (!endpoint) return null;
  return decideEndpoint(endpoint, measurement, {
    laboratoryThreshold: options.laboratoryThreshold ?? null,
  });
}
