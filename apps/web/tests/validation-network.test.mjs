/**
 * The console's Validation Network rules: the ladder, the probability
 * formatter, the one function allowed to describe an estimate, and the
 * guarantee that no component bypasses it.
 *
 * The last test in this file is the important one. Everything else here checks
 * that `describeEstimate` behaves; that one greps the components for a raw
 * percentage and fails if any of them learned to render one on its own.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const model = loadTs("lib/validation/model.ts");
const SRC = join(import.meta.dirname, "..", "src");

// ---------------------------------------------------------------------------
// The probability formatter
// ---------------------------------------------------------------------------

test("nothing formats as certainty", () => {
  // 100% asserts an experiment cannot fail and 0% that it cannot succeed, and
  // no finite cohort evidences either.
  assert.equal(model.formatProbability(1), ">99%");
  assert.equal(model.formatProbability(0.9999), ">99%");
  assert.equal(model.formatProbability(model.CERTAINTY_CEILING), ">99%");
  assert.equal(model.formatProbability(0), "<1%");
  assert.equal(model.formatProbability(model.CERTAINTY_FLOOR), "<1%");
  assert.equal(model.formatProbability(0.004), "<1%");
});

test("an unavailable probability formats as words, never as a number", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(model.formatProbability(value), "not available");
  }
});

test("ordinary probabilities round to whole percents", () => {
  assert.equal(model.formatProbability(0.79), "79%");
  assert.equal(model.formatProbability(0.794), "79%");
  assert.equal(model.formatProbability(0.796), "80%");
  assert.equal(model.formatProbability(0.5), "50%");
  assert.equal(model.formatProbability(0.012), "1%");
});

// ---------------------------------------------------------------------------
// describeEstimate: the chokepoint
// ---------------------------------------------------------------------------

const available = (over = {}) => ({
  available: true,
  question: "reproduces",
  gene: "CDK2",
  probability: 0.79,
  lower: 0.68,
  upper: 0.87,
  bounded: "none",
  boundNote: "",
  cohortNDecided: 327,
  cohortNLabs: 7,
  cohortNScreens: 31,
  cohortSentence:
    "Calibrated on 327 independent validation outcomes from 31 screens and 7 laboratories, knockout, ko fitness, fitness phenotype, in cancer cell lines.",
  relaxed: [],
  contributions: null,
  missingChannels: [],
  modelVersion: "splicr.validation-network.v1+reproduces+abc123def456",
  ...over,
});

const unavailable = (over = {}) => ({
  available: false,
  question: "pharmacologic",
  gene: "PRKDC",
  reason: "out_of_domain",
  because:
    "No validation probability is available for this experiment. It is outside the contexts the validation cohort covers well enough: 0 of 40 decided outcomes; 0 of 3 laboratories; 0 of 5 primary screens.",
  shortfall: ["0 of 40 decided outcomes"],
  ...over,
});

test("an available estimate always carries the clause that makes it a claim", () => {
  const described = model.describeEstimate(available());
  assert.equal(described.available, true);
  assert.equal(described.headline, "79%");
  // The sentence names the experiment. "79%" on its own is not a scientific
  // statement and this function cannot produce one.
  assert.ok(described.sentence.includes(model.QUESTION_SENTENCE.reproduces));
  assert.match(described.sentence, /95% calibration interval 68% to 87%/);
  // And the support names the cohort.
  assert.match(described.support, /Calibrated on 327/);
  assert.match(described.support, /7 laboratories/);
});

test("an unavailable estimate has no number to render", () => {
  const described = model.describeEstimate(unavailable());
  assert.equal(described.available, false);
  assert.equal(described.headline, "Not available");
  assert.doesNotMatch(described.headline, /\d/);
  assert.doesNotMatch(described.sentence, /\d+%/);
  // The reason is carried through verbatim, because it names the shortfall and
  // a laboratory that reads "0 of 5 primary screens" knows what would change it.
  assert.equal(described.support, unavailable().because);
});

test("a censored estimate reads as a bound and says why", () => {
  const upper = model.describeEstimate(
    available({
      bounded: "upper",
      probability: 0.94,
      boundNote:
        "The model put this candidate above every probability the calibration cohort contains (highest 94%), so the estimate is reported as a floor rather than extrapolating the fitted curve.",
    }),
  );
  assert.equal(upper.headline, "At least 94%");
  assert.match(upper.sentence, /^At least 94%/);
  assert.match(upper.support, /extrapolating the fitted curve/);

  const lower = model.describeEstimate(available({ bounded: "lower", probability: 0.12 }));
  assert.equal(lower.headline, "At most 12%");
  assert.match(lower.sentence, /^At most 12%/);
});

test("every question produces a describable estimate", () => {
  for (const question of model.QUESTIONS) {
    const described = model.describeEstimate(available({ question }));
    assert.ok(described.sentence.includes(model.QUESTION_SENTENCE[question]), question);
    const refused = model.describeEstimate(unavailable({ question }));
    assert.match(refused.sentence, /No .* probability is available/, question);
  }
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

const counts = (over = {}) => ({ met: 0, notMet: 0, inconclusive: 0, pending: 0, ...over });

test("a rung with agreeing outcomes is met or not met", () => {
  assert.equal(model.rungState(counts({ met: 2 })), "met");
  assert.equal(model.rungState(counts({ notMet: 3 })), "not_met");
});

test("a rung whose outcomes disagree is mixed, and both are kept", () => {
  // PTK2 in doi:10.1158/0008-5472.CAN-24-0775: one inhibitor did nothing on
  // either line, another produced a partial response in one. Neither "met" nor
  // "not met" is true, and a ladder that could not say "mixed" would have to
  // pick one and be wrong.
  const state = model.rungState(counts({ met: 1, notMet: 1 }));
  assert.equal(state, "mixed");
  assert.match(model.rungBecause(counts({ met: 1, notMet: 1 })), /Both are recorded/);
  assert.match(
    model.rungBecause(counts({ met: 1, notMet: 1 })),
    /information rather than noise/,
  );
});

test("an inconclusive outcome never marks a rung against a gene", () => {
  assert.equal(model.rungState(counts({ inconclusive: 3 })), "not_tested");
  assert.match(model.rungBecause(counts({ inconclusive: 3 })), /not a negative one/);
});

test("a pending outcome is not a result", () => {
  assert.equal(model.rungState(counts({ pending: 2 })), "not_tested");
  assert.match(model.rungBecause(counts({ pending: 2 })), /still at the bench/);
});

test("an empty rung says nobody ran it", () => {
  assert.equal(model.rungState(counts()), "not_tested");
  assert.match(model.rungBecause(counts()), /No experiment of this kind/);
});

test("the because line is grammatical for one and for many", () => {
  assert.match(model.rungBecause(counts({ met: 1 })), /1 outcome met/);
  assert.match(model.rungBecause(counts({ met: 2 })), /2 outcomes met/);
  assert.match(model.rungBecause(counts({ notMet: 1 })), /1 outcome ran/);
});

test("every validation type except 'other' lands on exactly one rung", () => {
  for (const type of model.VALIDATION_TYPES) {
    const rung = model.rungOf(type);
    if (type === "other") {
      assert.equal(rung, null);
      continue;
    }
    assert.ok(rung, `${type} is on no rung`);
    assert.equal(rung.question, model.TYPE_QUESTION[type]);
  }
});

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

test("contributions come back largest first with a readable direction", () => {
  const rows = model.contributionRows({
    primary: 2.159,
    guides: -0.123,
    screen_quality: -0.607,
    artifacts: 0.419,
    context: 0,
    independent: 0.013,
    biology: 0,
  });
  assert.equal(rows.length, 7);
  assert.equal(rows[0].family, "primary");
  assert.equal(rows[0].direction, "toward");
  assert.equal(rows[1].family, "screen_quality");
  assert.equal(rows[1].direction, "against");
  assert.equal(rows.at(-1).direction, "neutral");
  for (const row of rows) assert.ok(model.FAMILY_LABEL[row.family]);
});

test("a tree's missing decomposition is no rows, not zeroed rows", () => {
  // A boosted tree does not decompose exactly. Returning zeros would render as
  // "every family contributed nothing", which is a claim, and a false one.
  assert.deepEqual(model.contributionRows(null), []);
});

test("a non-finite contribution does not poison the ordering", () => {
  const rows = model.contributionRows({ primary: NaN, guides: 1.2 });
  assert.equal(rows[0].family, "guides");
  assert.equal(rows[1].value, 0);
  assert.equal(rows[1].direction, "neutral");
});

// ---------------------------------------------------------------------------
// The guarantee: no component formats a probability on its own
// ---------------------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

test("no validation surface builds a percentage by hand", () => {
  // `formatProbability` is the only place that can print one, and it is the
  // only place that refuses to print certainty. A component that did its own
  // `* 100` arithmetic on a probability would route around that, so the files
  // that render validation estimates are checked for it.
  const files = [
    ...walk(join(SRC, "components", "dashboard", "validation")),
    join(SRC, "lib", "data", "validation-network.ts"),
  ];
  assert.ok(files.length >= 3, "expected the validation surfaces to exist");
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Strip comments first: the prose in these files legitimately discusses
    // percentages, and a comment cannot render anything.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of [
      /probability[^;\n]*\*\s*100/,
      /\*\s*100[^;\n]*probability/,
      /toFixed\(\s*\d\s*\)\s*\}\s*%/,
      /Math\.round\([^)]*probability[^)]*\)\s*\}\s*%/,
    ]) {
      if (pattern.test(code)) offenders.push(`${file}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the validation components go through formatProbability for every number", () => {
  const view = readFileSync(
    join(SRC, "components", "dashboard", "validation", "network-view.tsx"),
    "utf8",
  );
  assert.match(view, /formatProbability/);
  // A probability rendered with `%` next to it that did not come from the
  // formatter would be a bare percentage.
  const ladder = readFileSync(
    join(SRC, "components", "dashboard", "validation", "ladder.tsx"),
    "utf8",
  );
  const code = ladder.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\d%/, "the ladder renders no percentage at all");
});

test("the network view always lists all four questions", () => {
  const view = readFileSync(
    join(SRC, "components", "dashboard", "validation", "network-view.tsx"),
    "utf8",
  );
  const code = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The questions table maps over every head it is handed, and it is handed all
  // four. A `.filter(h => h.available)` between the two would hide the unfitted
  // ones and tell the reader the product does four things well, which is the
  // overstatement this checks for.
  assert.match(code, /heads\.map\(/, "the questions table should map over every head");
  assert.match(code, /heads=\{view\.heads\}/, "and be handed the whole list");
  assert.doesNotMatch(
    code,
    /heads\.filter\([^)]*available[^)]*\)\.map/,
    "a filtered map would drop the unfitted questions",
  );
  assert.doesNotMatch(
    code,
    /heads=\{view\.heads\.filter/,
    "filtering before the table would drop them just as effectively",
  );
  // `filter` is still used for the counts, which is fine and is not the same
  // thing as filtering what gets rendered.
  assert.match(code, /heads\.filter\(\(h\) => h\.available\)/);

  const reader = readFileSync(join(SRC, "lib", "data", "validation-network.ts"), "utf8");
  assert.match(reader, /QUESTIONS\.map/);
  assert.match(reader, /emptyHead/);
});

test("every surface the engine exposes has a console read", () => {
  // The gap this release closed: rounds, slots, coverage, endpoints and
  // predictions existed in the engine and the database with no way to see or
  // use them. A table nobody can read is a table nobody will fill.
  const reader = readFileSync(join(SRC, "lib", "data", "validation-network.ts"), "utf8");
  const actions = readFileSync(join(SRC, "lib", "data", "round-actions.ts"), "utf8");
  for (const table of [
    "validation_network_status",
    "validation_coverage",
    "validation_endpoints",
    "validation_rounds",
    "validation_outcomes",
  ]) {
    assert.match(reader, new RegExp(`"${table}"`), `${table} has no console read`);
  }
  for (const table of ["validation_rounds", "validation_slots", "prediction_receipts"]) {
    assert.match(actions, new RegExp(`"${table}"`), `${table} has no console write`);
  }
});

test("a round is frozen on the server, never composed by the browser", () => {
  const actions = readFileSync(join(SRC, "lib", "data", "round-actions.ts"), "utf8");
  // "use server" and the receipt assembled from stored rows: a commitment the
  // browser can compose is a commitment somebody can compose to say anything.
  assert.match(actions, /^"use server";/m);
  assert.match(actions, /buildReceipt\(/);
  assert.match(actions, /from\("hits"\)/);
  // And the freeze refuses a round that is not a draft, before the database
  // trigger gets a chance to.
  assert.match(actions, /already \$\{round\.state\}/);
});

test("'not tested' is never styled as a failure", () => {
  const ladder = readFileSync(
    join(SRC, "components", "dashboard", "validation", "ladder.tsx"),
    "utf8",
  );
  const styles = /STATE_STYLE[\s\S]*?\n\};/.exec(ladder);
  assert.ok(styles, "the ladder's state styles should be declared in one block");
  const block = styles[0];
  const notTested = /not_tested:\s*\{[^}]*\}/.exec(block)[0];
  assert.doesNotMatch(notTested, /red|orange/);
  assert.match(notTested, /muted|line-strong/);
  // And not_met keeps the colour that reads as a result.
  assert.match(/not_met:\s*\{[^}]*\}/.exec(block)[0], /red/);
});
