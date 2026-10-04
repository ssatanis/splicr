/**
 * The console's endpoint scorer against the engine's own verdicts.
 *
 * `scripts/validation/export_endpoints.py` generates 1,800 measurements with
 * the decision the engine gave each one. This file replays every single case
 * through the TypeScript and asserts the verdict and the per-criterion statuses
 * match. That is what makes it safe for the scoring rule to exist in two
 * languages: a divergence is a named failing case here rather than a wrong
 * badge on somebody's screen.
 *
 * The matrix is stratified, not sampled at random: every (endpoint, decision)
 * pair in the full 77,760-case product survives, and every individual input
 * value appears at least a dozen times. The generator records how it sampled,
 * and `npm run validation:check` fails when the registry moves and the fixture
 * does not.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const matrix = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "endpoint-decisions.json"), "utf8"),
);
const { decideEndpoint, endpointByKey, defaultEndpoint, allEndpoints, REGISTRY_SHA256 } =
  loadTs("lib/validation/endpoint.ts");
const model = loadTs("lib/validation/model.ts");

test("the generated registry is the one this scorer was built against", () => {
  assert.equal(REGISTRY_SHA256, matrix.registry_sha256);
  assert.match(REGISTRY_SHA256, /^[0-9a-f]{64}$/);
});

test("the fixture covers every verdict and every endpoint it claims to", () => {
  assert.equal(matrix.cases.length, matrix.n_cases);
  assert.ok(matrix.n_cases_in_full_product > matrix.n_cases);
  assert.deepEqual(
    Object.keys(matrix.decisions).sort(),
    ["failed", "inconclusive", "insufficient_record", "validated"],
  );
  for (const [verdict, count] of Object.entries(matrix.decisions)) {
    assert.ok(count > 0, `no ${verdict} case survived sampling`);
  }
  assert.ok(matrix.endpoints_covered.length >= 8);
});

test("every case decides the same way in the console as in the engine", () => {
  let checked = 0;
  const wrong = [];
  for (const kase of matrix.cases) {
    const endpoint = endpointByKey(kase.endpoint);
    assert.ok(endpoint, `the console has no endpoint ${kase.endpoint}`);
    const decision = decideEndpoint(endpoint, kase.measurement, {
      laboratoryThreshold: kase.laboratory_threshold,
    });
    if (decision.decision !== kase.expect.decision) {
      wrong.push({
        endpoint: kase.endpoint,
        measurement: kase.measurement,
        threshold: kase.laboratory_threshold,
        engine: kase.expect.decision,
        console: decision.decision,
      });
    }
    checked++;
  }
  assert.deepEqual(
    wrong.slice(0, 5),
    [],
    `${wrong.length} of ${checked} cases decided differently in the console than in the engine`,
  );
  assert.equal(checked, matrix.n_cases);
});

test("every criterion comes back with the same name and status", () => {
  const wrong = [];
  for (const kase of matrix.cases) {
    const decision = decideEndpoint(endpointByKey(kase.endpoint), kase.measurement, {
      laboratoryThreshold: kase.laboratory_threshold,
    });
    const mine = decision.criteria.map((c) => `${c.name}=${c.status}`);
    const theirs = kase.expect.criteria.map((c) => `${c.name}=${c.status}`);
    if (mine.join(",") !== theirs.join(",")) {
      wrong.push({
        endpoint: kase.endpoint,
        measurement: kase.measurement,
        engine: theirs,
        console: mine,
      });
    }
  }
  assert.deepEqual(wrong.slice(0, 3), [], `${wrong.length} cases differ in their criteria`);
});

// ---------------------------------------------------------------------------
// The distinctions the matrix exists to protect
// ---------------------------------------------------------------------------

const COMPLETE = {
  result: "validated",
  independent_perturbation: true,
  distinct_from_screen_constructs: true,
  n_perturbations: 2,
  n_replicates: 3,
  effect_size: -1.4,
  controls: { negative_control_guides: true, positive_control_guides: true },
};

test("a complete record validates", () => {
  const endpoint = defaultEndpoint("independent_guide");
  const decision = decideEndpoint(endpoint, COMPLETE, { laboratoryThreshold: 1.0 });
  assert.equal(decision.decision, "validated");
  assert.ok(decision.criteria.every((c) => c.status === "pass"));
  assert.equal(decision.because, "Every prespecified criterion was met.");
});

test("a missing criterion is not scorable, and is never a failure", () => {
  const endpoint = defaultEndpoint("independent_guide");
  for (const field of [
    "independent_perturbation",
    "distinct_from_screen_constructs",
    "n_perturbations",
    "n_replicates",
    "effect_size",
  ]) {
    const decision = decideEndpoint(
      endpoint,
      { ...COMPLETE, [field]: null },
      { laboratoryThreshold: 1.0 },
    );
    assert.equal(decision.decision, "insufficient_record", field);
    assert.equal(decision.scorable, false, field);
    assert.match(decision.because, /not recorded/, field);
  }
});

test("a missing control is not scorable either", () => {
  const endpoint = defaultEndpoint("independent_guide");
  const decision = decideEndpoint(
    endpoint,
    { ...COMPLETE, controls: { negative_control_guides: true } },
    { laboratoryThreshold: 1.0 },
  );
  assert.equal(decision.decision, "insufficient_record");
  assert.match(decision.because, /positive control guides control/);
});

test("the laboratory's threshold is required and never invented", () => {
  const endpoint = defaultEndpoint("independent_guide");
  assert.equal(endpoint.threshold_owner, "laboratory");
  assert.equal(endpoint.effect_threshold, null);
  assert.equal(decideEndpoint(endpoint, COMPLETE).decision, "insufficient_record");
  assert.equal(
    decideEndpoint(endpoint, COMPLETE, { laboratoryThreshold: 1.0 }).decision,
    "validated",
  );
  assert.equal(
    decideEndpoint(endpoint, COMPLETE, { laboratoryThreshold: 3.0 }).decision,
    "failed",
  );
});

test("an effect of the right size in the wrong direction is not a validation", () => {
  const endpoint = defaultEndpoint("independent_guide");
  const wrongWay = decideEndpoint(
    endpoint,
    { ...COMPLETE, effect_size: 1.4 },
    { laboratoryThreshold: 1.0 },
  );
  assert.equal(wrongWay.decision, "failed");
  assert.match(wrongWay.because, /wrong way/);
});

test("a rescue validates in the opposite direction", () => {
  const endpoint = defaultEndpoint("rescue");
  assert.equal(endpoint.direction, "enriched");
  const measurement = {
    result: "validated",
    n_perturbations: 1,
    n_replicates: 3,
    effect_size: 1.2,
    controls: { empty_vector_control: true, expression_confirmed: true },
  };
  assert.equal(
    decideEndpoint(endpoint, measurement, { laboratoryThreshold: 0.5 }).decision,
    "validated",
  );
  assert.equal(
    decideEndpoint(endpoint, { ...measurement, effect_size: -1.2 }, {
      laboratoryThreshold: 0.5,
    }).decision,
    "failed",
  );
});

test("pending and inconclusive are never upgraded", () => {
  const endpoint = defaultEndpoint("independent_guide");
  const pending = decideEndpoint(endpoint, { result: "pending" });
  assert.equal(pending.decision, "insufficient_record");
  assert.match(pending.because, /has not finished/);
  const inconclusive = decideEndpoint(endpoint, { result: "inconclusive" });
  assert.equal(inconclusive.decision, "inconclusive");
  assert.match(inconclusive.because, /by the laboratory that ran it/);
});

test("a boolean is never read as a count", () => {
  // Number(true) is 1. If a replicate floor read it that way, "yes there were
  // replicates" would clear a floor of one that nobody actually met.
  const endpoint = defaultEndpoint("independent_guide");
  const decision = decideEndpoint(
    endpoint,
    { ...COMPLETE, n_replicates: true },
    { laboratoryThreshold: 1.0 },
  );
  assert.equal(decision.decision, "insufficient_record");
  assert.match(decision.because, /number of biological replicates/);
});

test("every validation type except 'other' resolves to an endpoint", () => {
  for (const type of model.VALIDATION_TYPES) {
    const endpoint = defaultEndpoint(type);
    if (type === "other") {
      assert.equal(endpoint, null, "'other' has no endpoint, by design");
      continue;
    }
    assert.ok(endpoint, `${type} has no default endpoint`);
    assert.equal(
      endpoint.question,
      model.TYPE_QUESTION[type],
      `${type}'s default endpoint answers a different question`,
    );
    assert.ok(endpoint.validation_types.includes(type));
  }
});

test("every endpoint says what a negative result does not mean", () => {
  for (const endpoint of allEndpoints()) {
    assert.ok(
      endpoint.negative_means.length > 40,
      `${endpoint.key} does not say what a negative result means`,
    );
  }
  const pharmacologic = endpointByKey("pharmacologic_inhibition.v1");
  assert.match(pharmacologic.negative_means, /not evidence that the screen hit was false/);
  assert.match(pharmacologic.negative_means, /PRKDC/);
});
