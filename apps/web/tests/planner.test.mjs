/**
 * The planner's arithmetic, checked against values worked out independently.
 *
 * Nothing here compares the model to itself. Expected numbers come from closed
 * forms written out in the test, from published constants (a Poisson(10) has
 * P(X <= 4) = 0.0292527), from a seeded Monte Carlo of the exact process the
 * model integrates, and from properties that must hold for every input.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const model = loadTs("lib/planner/model.ts");
const libs = loadTs("lib/planner/libraries.ts");

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} expected ${expected}, got ${actual}`);
const rel = (actual, expected, tolerance = 1e-9, message) =>
  close(actual / expected, 1, tolerance, message);

// --- a seeded generator, so a failure is reproducible ----------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}
function poissonDraw(lambda, rand) {
  // Inversion from the pmf recurrence: exact, and fine for the means used here.
  const u = rand();
  let p = Math.exp(-lambda);
  let cdf = p;
  let k = 0;
  while (u > cdf && k < 10000) {
    k++;
    p *= lambda / k;
    cdf += p;
  }
  return k;
}

test("poissonCdf matches published values", () => {
  close(model.poissonCdf(4, 10), 0.029252688, 1e-8);
  close(model.poissonCdf(0, 3), Math.exp(-3), 1e-15);
  close(model.poissonCdf(9, 10), 0.4579297, 1e-6);
  assert.equal(model.poissonCdf(-1, 10), 0);
  assert.equal(model.poissonCdf(5, 0), 1);
  // Very large means underflow cleanly to zero rather than NaN.
  assert.equal(model.poissonCdf(30, 1e5), 0);
});

test("skew ratio and lognormal sigma invert each other", () => {
  for (const ratio of [1, 2, 6, 10, 30]) {
    const sigma = model.skewToSigma(ratio);
    close(Math.exp(2 * 1.2815515655446004 * sigma), Math.max(1, ratio), 1e-9);
  }
  assert.equal(model.skewToSigma(1), 0);
  assert.equal(model.skewToSigma(0.4), 0);
});

test("with no skew the mixture is exactly the Poisson tail", () => {
  for (const [mean, floor] of [[100, 30], [50, 30], [500, 30], [8, 5]]) {
    close(model.fractionBelow(mean, 0, floor), model.poissonCdf(floor - 1, mean), 1e-15);
  }
});

test("the Poisson-lognormal mixture agrees with a Monte Carlo of the same process", () => {
  const rand = mulberry32(20260929);
  for (const [mean, ratio, floor] of [[60, 6, 30], [200, 10, 30], [40, 3, 20]]) {
    const sigma = model.skewToSigma(ratio);
    const n = 120_000;
    let below = 0;
    for (let i = 0; i < n; i++) {
      const abundance = Math.exp(sigma * gaussian(rand) - (sigma * sigma) / 2);
      if (poissonDraw(mean * abundance, rand) < floor) below++;
    }
    const observed = below / n;
    const numeric = model.fractionBelow(mean, sigma, floor);
    const standardError = Math.sqrt((observed * (1 - observed)) / n) + 1e-5;
    assert.ok(
      Math.abs(observed - numeric) < 4.5 * standardError + 2e-4,
      `mean ${mean} skew ${ratio} floor ${floor}: simulated ${observed}, integrated ${numeric}`,
    );
  }
});

test("with a huge mean the mixture reduces to the lognormal itself", () => {
  // Counting noise vanishes, so the fraction below floor is P(a < floor/mean),
  // which is a normal CDF in z = (ln(t) + sigma^2/2) / sigma.
  const sigma = model.skewToSigma(6);
  const mean = 1e6;
  const floor = 200_000; // t = 0.2 of the mean; the Poisson sum is skipped, so use a smaller mean:
  void floor;
  const smallMean = 4000;
  const smallFloor = 800; // t = 0.2
  const z = (Math.log(0.2) + (sigma * sigma) / 2) / sigma;
  const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  close(model.fractionBelow(smallMean, sigma, smallFloor), phi(z), 5e-3);
  void mean;
});

function erf(x) {
  // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

test("meanNeeded is the smallest mean that reaches the target, and is monotone in the target", () => {
  for (const [target, ratio, floor] of [[0.99, 1, 30], [0.99, 6, 30], [0.999, 10, 30], [0.9, 6, 100]]) {
    const sigma = model.skewToSigma(ratio);
    const need = model.meanNeeded(target, sigma, floor);
    assert.ok(model.fractionBelow(need, sigma, floor) <= 1 - target + 1e-12, "reaches the target");
    assert.ok(model.fractionBelow(need - 2, sigma, floor) > 1 - target - 1e-3, "and one step fewer does not by much");
  }
  const a = model.meanNeeded(0.9, model.skewToSigma(6), 30);
  const b = model.meanNeeded(0.99, model.skewToSigma(6), 30);
  const c = model.meanNeeded(0.999, model.skewToSigma(6), 30);
  assert.ok(a < b && b < c);
  // More skew needs more cells.
  assert.ok(model.meanNeeded(0.99, model.skewToSigma(3), 30) < model.meanNeeded(0.99, model.skewToSigma(10), 30));
});

test("the default plan is the arithmetic a reader would do by hand", () => {
  const { inputs } = model.sanitizeInputs({});
  const plan = model.buildPlan(inputs);

  assert.equal(plan.library.guides, 77_441);
  assert.equal(plan.library.targeting, 76_441);
  assert.equal(plan.library.controls, 1_000);

  const pInfected = 1 - Math.exp(-0.3);
  rel(plan.transduction.pInfected, pInfected);
  rel(plan.transduction.multiFraction, 1 - (0.3 * Math.exp(-0.3)) / pInfected);
  close(plan.transduction.multiFraction, 0.1425, 1e-3);
  rel(plan.transduction.cellsToTransduce, (77_441 * 500) / pInfected);

  assert.equal(plan.samples.arms, 2);
  assert.equal(plan.samples.flasks, 6);
  assert.equal(plan.samples.total, 7);
  assert.equal(plan.samples.cellsPerSample, 38_720_500);
  close(plan.samples.doublings, 14, 1e-12);

  rel(plan.sequencing.gdnaPerSampleUg, 38_720_500 * 6.6e-6);
  assert.equal(plan.sequencing.pcrPerSample, 26);
  assert.equal(plan.sequencing.readsPerSample, 77_441 * 500);
  assert.equal(plan.sequencing.totalReads, 77_441 * 500 * 7);
  rel(plan.sequencing.runFraction, (77_441 * 500 * 7) / 400e6);
  assert.equal(plan.sequencing.runsNeeded, 1);

  const guideSe = Math.sqrt((2 * (1 / 500 + 1 / 500)) / 3) / Math.LN2;
  rel(plan.noise.guideSeLog2, guideSe);
  rel(plan.noise.geneSeLog2, guideSe / Math.sqrt(76_441 / 19_114));
  rel(plan.noise.geneHalfWidth95, 1.959963984540054 * plan.noise.geneSeLog2);
});

test("the protocol's worked example, and where the Poisson form differs from it", () => {
  // Joung et al. divide by the MOI: 100,000 guides x 500 cells / 0.3 = 1.67e8.
  // The planner divides by 1 - exp(-MOI) = 0.2592, which is what an MOI of 0.3
  // actually infects, so it asks for more cells: 1.93e8.
  const plan = model.buildPlan(model.sanitizeInputs({ library: "custom", genes: 25_000, guidesPerGene: 4, controls: 0, coverage: 500, moi: 0.3 }).inputs);
  assert.equal(plan.library.guides, 100_000);
  rel(plan.transduction.cellsToTransduce, (100_000 * 500) / (1 - Math.exp(-0.3)));
  close(plan.transduction.cellsToTransduce / 1e8, 1.929, 0.001);
  close((100_000 * 500) / 0.3 / 1e8, 1.667, 0.001);
});

test("the default timeline adds up to the low end of the published 12 to 20 weeks", () => {
  const plan = model.buildPlan(model.sanitizeInputs({}).inputs);
  const days = Object.fromEntries(plan.timeline.phases.map((phase) => [phase.id, phase.days]));
  assert.equal(days.library, 14);
  assert.equal(days.virus, 14);
  assert.equal(days.screen, 14);
  // log2(149.4e6 / 20e6) = 2.9 doublings at 24 h is 2.9 days, rounded up.
  assert.equal(days.expand, 3);
  // A week of selection plus log2(6) = 2.585 days to fill six flasks, rounded up.
  assert.equal(days.select, 7 + 3);
  assert.equal(plan.timeline.totalDays, Object.values(days).reduce((a, b) => a + b, 0));
  assert.equal(plan.timeline.totalWeeks, Math.ceil(plan.timeline.totalDays / 7));
  assert.equal(plan.timeline.totalWeeks, 12);
});

test("costs are drivers times the unit costs the reader can see, and sum to the total", () => {
  const { inputs } = model.sanitizeInputs({});
  const plan = model.buildPlan(inputs);
  const byId = Object.fromEntries(plan.costs.lines.map((line) => [line.id, line.amount]));
  rel(byId.sequencing, (plan.sequencing.totalReads / 1e6) * 8);
  rel(byId.pcr, plan.sequencing.pcrTotal * 6);
  rel(byId.gdna, plan.sequencing.gdnaTotalUg * 0.5);
  rel(byId.culture, (plan.samples.cellsGrown / 1e9) * 200);
  assert.equal(byId.library, 600);
  close(plan.costs.total, Object.values(byId).reduce((a, b) => a + b, 0), 1e-6);
  // Consumables are a fraction of what a service charges, and the plan says so
  // by showing the published price next to it rather than claiming to match it.
  assert.ok(plan.costs.total < model.PUBLISHED_REFERENCE.usd);
  const free = model.buildPlan({ ...inputs, costLibrary: 0, costVirus: 0, costCulturePerBillion: 0, costGdnaPerUg: 0, costPcr: 0, costSeqPerMillion: 0 });
  assert.equal(free.costs.total, 0);
});

test("a custom library is genes times guides per gene, plus controls", () => {
  const plan = model.buildPlan(model.sanitizeInputs({ library: "custom", genes: 1200, guidesPerGene: 4, controls: 500 }).inputs);
  assert.equal(plan.library.guides, 5300);
  assert.equal(plan.library.targeting, 4800);
  assert.equal(plan.library.fromCatalog, false);
  assert.equal(plan.library.guidesPerGene, 4);
});

test("every catalogued library is internally consistent", () => {
  assert.ok(libs.PLANNER_LIBRARIES.length >= 5);
  for (const library of libs.PLANNER_LIBRARIES) {
    assert.ok(library.controls <= library.guides, library.slug);
    assert.ok(library.genes > 10_000 && library.genes < library.guides, library.slug);
    const perGene = (library.guides - library.controls) / library.genes;
    assert.ok(perGene >= 2.5 && perGene <= 5, `${library.slug}: ${perGene} guides per gene`);
  }
  assert.equal(new Set(libs.PLANNER_LIBRARIES.map((l) => l.slug)).size, libs.PLANNER_LIBRARIES.length);
  assert.equal(libs.findLibrary("brunello").guides, 77_441);
  assert.equal(libs.findLibrary("not-a-library"), null);
});

test("sanitising clamps, rounds and names every change, and never throws", () => {
  const { inputs, issues } = model.sanitizeInputs({
    coverage: "10", moi: "5", replicates: "2.6", genes: "abc", screenDays: "", readsPerGuide: Infinity,
    doublingHours: "-4", library: "nope", design: "chaos", costPcr: "-1",
  });
  assert.equal(inputs.coverage, 20);
  assert.equal(inputs.moi, 2);
  assert.equal(inputs.replicates, 3);
  assert.equal(inputs.genes, model.DEFAULT_INPUTS.genes);
  assert.equal(inputs.screenDays, model.DEFAULT_INPUTS.screenDays);
  assert.equal(inputs.readsPerGuide, model.DEFAULT_INPUTS.readsPerGuide);
  assert.equal(inputs.doublingHours, 6);
  assert.equal(inputs.library, "brunello");
  assert.equal(inputs.design, "treatment");
  assert.equal(inputs.costPcr, 0);
  const named = new Set(issues.map((issue) => issue.key));
  for (const key of ["coverage", "moi", "genes", "screenDays", "readsPerGuide", "doublingHours", "costPcr"]) {
    assert.ok(named.has(key), `${key} change is reported`);
  }
  assert.ok(!named.has("replicates") || issues.find((i) => i.key === "replicates").used === 3);
  for (const issue of issues) assert.match(issue.message, /Using|must be/);
  for (const junk of [null, undefined, {}, { coverage: null }, { coverage: {} }, { moi: [] }, { __proto__: { coverage: 1 } }]) {
    assert.doesNotThrow(() => model.buildPlan(model.sanitizeInputs(junk ?? {}).inputs));
  }
});

test("every legal input yields a finite plan (property test over the whole input box)", () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 150; i++) {
    const raw = { library: rand() < 0.5 ? "custom" : "brunello", design: rand() < 0.5 ? "dropout" : "treatment" };
    for (const key of model.NUMERIC_KEYS) {
      const f = model.FIELDS[key];
      const v = f.min + rand() * (f.max - f.min);
      raw[key] = f.integer ? Math.round(v) : v;
    }
    const { inputs, issues } = model.sanitizeInputs(raw);
    assert.equal(issues.length, 0, JSON.stringify(issues));
    const plan = model.buildPlan(inputs);
    const flat = JSON.stringify(plan, (_, value) => (typeof value === "number" && !Number.isFinite(value) ? "NON-FINITE" : value));
    assert.ok(!flat.includes("NON-FINITE"), `non-finite value for ${JSON.stringify(raw)}`);
    assert.ok(plan.representation.cellsBelowFloor >= 0 && plan.representation.cellsBelowFloor <= 1);
    assert.ok(plan.representation.readsBelowFloor >= 0 && plan.representation.readsBelowFloor <= 1);
    assert.ok(plan.costs.total >= 0);
    assert.ok(plan.timeline.totalWeeks >= 0);
  }
});

test("more coverage, depth or replicates never makes the design noisier or more lossy", () => {
  const base = model.sanitizeInputs({}).inputs;
  const at = (patch) => model.buildPlan({ ...base, ...patch });
  for (const key of ["coverage", "readsPerGuide", "replicates"]) {
    const low = key === "replicates" ? 2 : 100;
    const high = key === "replicates" ? 6 : 900;
    assert.ok(at({ [key]: high }).noise.guideSeLog2 < at({ [key]: low }).noise.guideSeLog2, key);
  }
  let previous = 1;
  for (const coverage of [20, 50, 100, 200, 400, 800, 1600]) {
    const fraction = at({ coverage }).representation.cellsBelowFloor;
    assert.ok(fraction <= previous + 1e-12, `coverage ${coverage}`);
    previous = fraction;
  }
  assert.ok(at({ skew: 20, coverage: 60 }).representation.cellsBelowFloor > at({ skew: 2, coverage: 60 }).representation.cellsBelowFloor);
  assert.ok(at({ coverage: 1000 }).costs.total > at({ coverage: 100 }).costs.total);
});

test("checks warn when they should and stay quiet when they should not", () => {
  const base = model.sanitizeInputs({}).inputs;
  const level = (patch, id) => model.buildPlan({ ...base, ...patch }).checks.find((c) => c.id === id)?.level;
  assert.equal(level({}, "coverage"), "ok");
  assert.equal(level({ coverage: 300 }, "coverage"), "info");
  assert.equal(level({ coverage: 100 }, "coverage"), "warn");
  assert.equal(level({ moi: 0.8 }, "moi"), "warn");
  assert.equal(level({ moi: 0.3 }, "moi"), "ok");
  assert.equal(level({ readsPerGuide: 60 }, "depth"), "warn");
  assert.equal(level({ readsPerGuide: 300 }, "depth"), "info");
  assert.equal(level({}, "depth"), "ok");
  assert.equal(level({ moi: 0.4 }, "moi"), "info");
  assert.equal(level({ skew: 15 }, "skew"), "warn");
  assert.equal(level({ skew: 6 }, "skew"), undefined);
  assert.equal(level({ replicates: 1 }, "replicates"), "warn");
  assert.equal(level({}, "replicates"), undefined);
  assert.equal(level({ design: "dropout", screenDays: 7 }, "days"), "info");
  assert.equal(level({ startingCellsM: 0.1, doublingHours: 48 }, "expansion"), "warn");
  assert.equal(level({ runReadsM: 50 }, "run"), "info");
  assert.equal(level({}, "run"), undefined);
  const noControls = model.buildPlan({ ...base, library: "tkov3" });
  assert.equal(noControls.checks.find((c) => c.id === "controls").level, "info");
  // The wording of a warning quotes the numbers it is about.
  const warning = model.buildPlan({ ...base, coverage: 100 }).checks.find((c) => c.id === "coverage");
  assert.match(warning.detail, /100 cells per guide/);
});

test("a shared link round-trips every field, and carries only what differs from the defaults", () => {
  const rand = mulberry32(99);
  for (let i = 0; i < 100; i++) {
    const raw = { library: i % 3 === 0 ? "custom" : "dolcetto-a", design: i % 2 ? "dropout" : "treatment" };
    for (const key of model.NUMERIC_KEYS) {
      const f = model.FIELDS[key];
      const v = f.min + rand() * (f.max - f.min);
      raw[key] = f.integer ? Math.round(v) : Number(v.toFixed(2));
    }
    const original = model.sanitizeInputs(raw).inputs;
    const params = model.inputsToParams(original);
    const restored = model.sanitizeInputs(model.paramsToRaw(new URLSearchParams(params.toString()))).inputs;
    assert.deepEqual(restored, original);
  }
  assert.equal(model.inputsToParams(model.DEFAULT_INPUTS).toString(), "");
  const changed = model.inputsToParams({ ...model.DEFAULT_INPUTS, coverage: 250 });
  assert.equal(changed.toString(), "cov=250");
  // The page reads it from the server's search params object as well.
  assert.deepEqual(model.paramsToRaw({ cov: "250", moi: ["0.4", "0.5"], junk: "x" }), { coverage: "250", moi: "0.4" });
});

test("every preset is valid and produces a plan without a single correction", () => {
  assert.ok(model.PRESETS.length >= 3);
  for (const preset of model.PRESETS) {
    const applied = model.applyPreset(preset);
    const again = model.sanitizeInputs(applied);
    assert.equal(again.issues.length, 0, preset.id);
    const plan = model.buildPlan(applied);
    assert.ok(plan.library.guides > 1000, preset.id);
    assert.ok(plan.timeline.totalWeeks > 0, preset.id);
  }
  // The focused primary-cell preset has slower cells and a shorter screen.
  const focused = model.applyPreset(model.PRESETS.find((p) => p.id === "focused-primary"));
  assert.equal(focused.library, "custom");
  assert.equal(model.buildPlan(focused).library.guides, 5300);
});

test("the export has a stable header and a row for every quantity the page shows", () => {
  const { inputs } = model.sanitizeInputs({});
  const plan = model.buildPlan(inputs);
  const rows = model.planRows(inputs, plan);
  assert.deepEqual([...model.PLAN_COLUMNS], ["section", "quantity", "value", "unit", "note"]);
  assert.ok(rows.every((row) => row.length === model.PLAN_COLUMNS.length));
  const sections = new Set(rows.map((row) => row[0]));
  for (const section of ["Library", "Transduction", "Samples", "Sequencing", "Representation", "Noise floor", "Timeline", "Cost"]) {
    assert.ok(sections.has(section), section);
  }
  assert.equal(rows.find((row) => row[1] === "Total guides")[2], 77_441);
  const total = rows.filter((row) => row[0] === "Cost" && row[1] === "Total")[0];
  close(total[2], plan.costs.total, 0.01);
  assert.match(total[4], /Excludes labour/);
});

test("the CSV carries its own disclaimer, quotes every text field and defuses formulas", () => {
  const exporter = loadTs("lib/planner/export.ts");
  const { inputs } = model.sanitizeInputs({});
  const plan = model.buildPlan(inputs);
  const rows = model.planRows(inputs, plan);
  rows.push(["Test", "=cmd|' /C calc'!A0", "+1", "x", "@SUM(A1)"]);
  const csv = exporter.planCsv(inputs, rows);
  assert.ok(csv.startsWith("\uFEFF# SplicR screen plan"));
  assert.match(csv, /# model: planner-model-2026-09/);
  assert.match(csv, /not a statistical power calculation, a quote or a guarantee/);
  assert.match(csv, /# inputs: library=brunello; genes=19114/);
  const lines = csv.trimEnd().split("\r\n");
  const header = lines.findIndex((line) => line === "section,quantity,value,unit,note");
  assert.ok(header > 0);
  assert.equal(lines.length - header - 1, rows.length);
  const injected = lines.at(-1);
  assert.match(injected, /^"Test","'=cmd/);
  assert.match(injected, /"'\+1"/);
  assert.match(injected, /"'@SUM\(A1\)"$/);
  // Every non-numeric cell is quoted, so a comma inside a note cannot shift columns.
  assert.ok(lines.slice(header + 1).every((line) => line.startsWith('"')));
});
