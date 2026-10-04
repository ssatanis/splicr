/**
 * The console's round arithmetic against the engine's.
 *
 * A results page that disagreed with the engine about a confirmation rate would
 * be worse than no results page, so every case the generator produces is
 * replayed here: the small denominators a real round has, the edges where a
 * Wilson interval pins to 0 or 1, and the states where no rate exists at all.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "arm-comparison.json"), "utf8"),
);
const {
  armRate,
  binomialTwoSided,
  compareArms,
  differenceSentence,
  discordance,
  progress,
  wilson,
} = loadTs("lib/validation/evaluate.ts");

const close = (mine, theirs, what) => {
  if (theirs === null || theirs === undefined) {
    assert.equal(mine, null, `${what}: engine said null`);
    return;
  }
  assert.ok(mine !== null, `${what}: console said null, engine said ${theirs}`);
  assert.ok(
    Math.abs(mine - theirs) < 1e-12,
    `${what}: console ${mine}, engine ${theirs}`,
  );
};

test("every arm rate matches the engine to the last digit", () => {
  assert.ok(fixture.n_cases >= 10);
  for (const kase of fixture.cases) {
    for (const side of ["a", "b"]) {
      const spec = kase[side];
      const mine = armRate(side === "a" ? "splicr" : "fdr", spec.labels, spec.n_drawn);
      const theirs = spec.expect;
      assert.equal(mine.nDrawn, theirs.n_drawn);
      assert.equal(mine.nRecorded, theirs.n_recorded);
      assert.equal(mine.nDecided, theirs.n_decided);
      assert.equal(mine.nValidated, theirs.n_validated);
      close(mine.rate, theirs.rate, `${side} rate`);
      close(mine.lower, theirs.lower, `${side} lower`);
      close(mine.upper, theirs.upper, `${side} upper`);
      close(mine.costPerConfirmation, theirs.cost_per_confirmation, `${side} cost`);
    }
  }
});

test("every difference and its interval match the engine", () => {
  for (const kase of fixture.cases) {
    const a = armRate("splicr", kase.a.labels, kase.a.n_drawn);
    const b = armRate("fdr", kase.b.labels, kase.b.n_drawn);
    const mine = compareArms(a, b);
    const theirs = kase.difference;
    close(mine.difference, theirs.difference, "difference");
    close(mine.lower, theirs.lower, "lower");
    close(mine.upper, theirs.upper, "upper");
    assert.equal(mine.separated, theirs.separated);
  }
});

test("an interval that includes zero says the round did not separate them", () => {
  // The common case at a real budget, and the one a results page must not
  // dress up. Two of three against one of three is not a finding.
  const a = armRate("splicr", [1, 1, 0], 3);
  const b = armRate("fdr", [1, 0, 0], 3);
  const sentence = differenceSentence(compareArms(a, b));
  assert.match(sentence, /does not separate them/);
  assert.doesNotMatch(sentence, /better|outperform|wins/i);
});

test("a separated interval says only that, and never that one is better", () => {
  const a = armRate("splicr", Array(20).fill(1), 20);
  const b = armRate("fdr", Array(20).fill(0), 20);
  const sentence = differenceSentence(compareArms(a, b));
  assert.match(sentence, /excludes zero/);
  assert.doesNotMatch(sentence, /better|proves|shows that/i);
});

test("no decided outcome means no rate, not a rate of nought", () => {
  const empty = armRate("splicr", [null, null], 2);
  assert.equal(empty.rate, null);
  assert.equal(empty.nDecided, 0);
  assert.equal(empty.costPerConfirmation, null);
  const sentence = differenceSentence(compareArms(empty, armRate("fdr", [1], 1)));
  assert.match(sentence, /Not comparable yet/);
});

test("pending and inconclusive stay out of the denominator", () => {
  const rate = armRate("splicr", [1, 1, null, null, 0], 8);
  assert.equal(rate.nRecorded, 5);
  assert.equal(rate.nDecided, 3);
  assert.equal(rate.nValidated, 2);
  assert.ok(Math.abs(rate.rate - 2 / 3) < 1e-12);
  // And the drawn-but-unrecorded candidates are visible, so a rate over 3 is
  // not read as a rate over 8.
  assert.equal(rate.nDrawn, 8);
});

test("cost per confirmation is bench work, and is null when nothing confirmed", () => {
  assert.equal(armRate("splicr", [1, 0, 0, 0], 4).costPerConfirmation, 4);
  assert.equal(armRate("splicr", [0, 0], 2).costPerConfirmation, null);
});

test("a Wilson interval is exactly 0 or 1 at the edges", () => {
  assert.equal(wilson(0, 3)[0], 0);
  assert.equal(wilson(3, 3)[1], 1);
  const tight = wilson(400, 500);
  const loose = wilson(4, 5);
  assert.ok(tight[1] - tight[0] < loose[1] - loose[0]);
});

test("progress separates what is outstanding from what is undecided", () => {
  const p = progress({ drawn: 20, validated: 6, failed: 3, inconclusive: 1, pending: 2 });
  assert.equal(p.nRecorded, 12);
  assert.equal(p.nDecided, 9);
  assert.equal(p.nOutstanding, 8);
  assert.equal(p.complete, false);
  const done = progress({ drawn: 4, validated: 2, failed: 2, inconclusive: 0, pending: 0 });
  assert.equal(done.complete, true);
  assert.equal(done.nOutstanding, 0);
});


// ---------------------------------------------------------------------------
// The discordant set
// ---------------------------------------------------------------------------

test("the exact binomial matches scipy on every case", () => {
  assert.ok(fixture.binomials.length >= 14);
  for (const kase of fixture.binomials) {
    const mine = binomialTwoSided(kase.successes, kase.n);
    assert.ok(
      Math.abs(mine - kase.p_value) < 1e-12,
      `binom(${kase.successes}, ${kase.n}): console ${mine}, scipy ${kase.p_value}`,
    );
  }
});

const candidate = (wantedBy, label) => ({ wantedBy, label });

test("candidates both strategies chose are set aside, not scored", () => {
  // They cannot distinguish the two however they turn out, so counting them
  // would dilute the only comparison that carries information.
  const result = discordance("splicr", "fdr", [
    candidate(["splicr", "fdr"], 1),
    candidate(["splicr", "fdr"], 1),
    candidate(["splicr"], 1),
    candidate(["fdr"], 0),
  ]);
  assert.equal(result.nShared, 2);
  assert.equal(result.nOnlyArm, 1);
  assert.equal(result.nOnlyComparator, 1);
  assert.equal(result.armConfirmed, 1);
  assert.equal(result.comparatorConfirmed, 0);
  assert.match(result.because, /set aside/);
});

test("two strategies that chose the same candidates cannot be told apart", () => {
  const result = discordance("splicr", "fdr", [
    candidate(["splicr", "fdr"], 1),
    candidate(["splicr", "fdr"], 0),
  ]);
  assert.equal(result.pValue, null);
  assert.match(result.because, /chose the same candidates/);
});

test("no confirmed discordant candidate means no test, not a null result", () => {
  const result = discordance("splicr", "fdr", [
    candidate(["splicr"], 0),
    candidate(["fdr"], 0),
    candidate(["splicr"], null),
  ]);
  assert.equal(result.pValue, null);
  assert.match(result.because, /nothing to compare/);
});

test("a clean split reports the exact p and names both counts", () => {
  const result = discordance("splicr", "fdr", [
    ...Array.from({ length: 7 }, () => candidate(["splicr"], 1)),
    ...Array.from({ length: 4 }, () => candidate(["fdr"], 1)),
    candidate(["splicr", "fdr"], 1),
  ]);
  assert.equal(result.armConfirmed, 7);
  assert.equal(result.comparatorConfirmed, 4);
  assert.equal(result.nShared, 1);
  const expected = fixture.binomials.find((b) => b.successes === 7 && b.n === 11);
  assert.ok(Math.abs(result.pValue - expected.p_value) < 1e-12);
  assert.match(result.because, /7 came from/);
  // It reports a number, never a verdict.
  assert.doesNotMatch(result.because, /better|significant|proves/i);
});

test("an undecided discordant candidate leaves the denominator", () => {
  const result = discordance("splicr", "fdr", [
    candidate(["splicr"], 1),
    candidate(["splicr"], null),
    candidate(["fdr"], null),
  ]);
  assert.equal(result.nOnlyArm, 2);
  assert.equal(result.armDecided, 1);
  assert.equal(result.comparatorDecided, 0);
});
