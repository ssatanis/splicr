/**
 * The Validation Network page, server-rendered, in both of its states.
 *
 * The end-to-end suite can only reach the unfitted branch, because reaching the
 * other one would mean writing a synthetic calibrated model into the shared
 * database and changing what the product claims for everybody. So the fitted
 * branch is rendered here against a head fixture shaped exactly like
 * `getNetworkView` returns, and checked for the two things that matter:
 *
 *   a probability never appears without the cohort that licensed it
 *   all four questions appear whether or not they are calibrated
 *
 * React's server renderer is used directly rather than a DOM library, because
 * what is being asserted is the output string, and a string is what a reader
 * actually receives.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { renderToStaticMarkup } = await import("react-dom/server");

/**
 * `server-only` is a build-time guard, not a runtime module: Next.js fails the
 * build if a client bundle reaches it, and it has nothing to do at runtime. The
 * page's panels reach it through the round controls' server actions, which is
 * the ordinary Next.js pattern — and whether that boundary is legal is the
 * build's job to decide, not this test's.
 */
const mocks = { "server-only": {} };

const view = loadTs("components/dashboard/validation/network-view.tsx", { mocks });
const ladderModule = loadTs("components/dashboard/validation/ladder.tsx", { mocks });
const model = loadTs("lib/validation/model.ts");

/** Markup with tags removed, entities decoded, and whitespace collapsed. */
function visibleText(element) {
  return renderToStaticMarkup(element)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Ampersand last, or an already-decoded entity would be decoded twice.
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const unfittedHead = (question) => ({
  question,
  available: false,
  modelVersion: null,
  algorithm: null,
  calibrator: null,
  calibrationSource: null,
  nDecided: null,
  nLabs: null,
  nTest: null,
  testLabs: [],
  brier: null,
  brierBaseRate: null,
  beatsBaseRate: null,
  ece: null,
  calibrationSlope: null,
  calibrationIntercept: null,
  evidencedLow: null,
  evidencedHigh: null,
  reliabilityBins: [],
  cohortSha256: null,
  fittedAt: null,
  nOpenStrata: 0,
  nStrata: 0,
});

const fittedHead = (question, over = {}) => ({
  ...unfittedHead(question),
  available: true,
  modelVersion: `splicr.validation-network.v1+${question}+230f8876b41b`,
  algorithm: "hierarchical_logistic",
  calibrator: "beta",
  calibrationSource:
    "out-of-fold scores across 6 laboratory-grouped folds of the training set",
  nDecided: 389,
  nLabs: 8,
  nTest: 96,
  testLabs: ["LAB2", "LAB5"],
  brier: 0.1085,
  brierBaseRate: 0.1171,
  beatsBaseRate: true,
  ece: 0.0357,
  calibrationSlope: 0.93,
  calibrationIntercept: 0.08,
  evidencedLow: 0.688,
  evidencedHigh: 1.0,
  reliabilityBins: [
    { label: "0-20%", n: 0, predicted: null, observed: null, observedLower: null, observedUpper: null, sparse: true },
    { label: "20-40%", n: 4, predicted: 0.31, observed: 0.25, observedLower: 0.01, observedUpper: 0.7, sparse: true },
    { label: "40-60%", n: 54, predicted: 0.5, observed: 0.52, observedLower: 0.38, observedUpper: 0.65, sparse: false },
    { label: "60-80%", n: 140, predicted: 0.71, observed: 0.69, observedLower: 0.61, observedUpper: 0.76, sparse: false },
    { label: "80-100%", n: 191, predicted: 0.9, observed: 0.91, observedLower: 0.86, observedUpper: 0.94, sparse: false },
  ],
  cohortSha256: "b18ed39cf64bdf8ed0d88bbdd7d723e8d4e22581f072830532b6ca69137283b9",
  fittedAt: "2026-10-03T12:00:00Z",
  nOpenStrata: 4,
  nStrata: 4,
  ...over,
});

const networkView = (heads, over = {}) => ({
  status: "ready",
  heads,
  contribution: [],
  nUnclassified: 0,
  nRounds: 0,
  nFrozenRounds: 0,
  nReceipts: 0,
  canWrite: true,
  ...over,
});

const ENDPOINTS = [
  {
    key: "ko_fitness_independent_guide.v1",
    label: "Independent guide, knockout fitness",
    question: "reproduces",
    assayClass: "ko_fitness",
    direction: "depleted",
    effectMetric: "log2_fold_change",
    thresholdOwner: "laboratory",
    minPerturbations: 1,
    minReplicates: 2,
    controls: ["negative_control_guides"],
    negativeMeans: "A negative result here says this guide did not reproduce it.",
    source: null,
  },
  {
    key: "pharmacologic_inhibition.v1",
    label: "Selective small-molecule inhibition",
    question: "pharmacologic",
    assayClass: "other",
    direction: "depleted",
    effectMetric: "viability_relative_to_vehicle",
    thresholdOwner: "laboratory",
    minPerturbations: 1,
    minReplicates: 2,
    controls: ["vehicle_control"],
    negativeMeans: "It is not evidence that the screen hit was false.",
    source: "10.1158/0008-5472.CAN-24-0775",
  },
];

/** The page as a server component takes four lists beside the view. */
const panels = (heads, over = {}) =>
  view.NetworkPanels({
    view: networkView(heads, over.view ?? {}),
    strata: over.strata ?? [],
    endpoints: over.endpoints ?? ENDPOINTS,
    rounds: over.rounds ?? [],
    screens: over.screens ?? [{ id: "s1", name: "RSL3 screen", nHits: 1200 }],
    results: over.results ?? null,
  });

// ---------------------------------------------------------------------------
// Unfitted: what the product says today
// ---------------------------------------------------------------------------

test("the page leads with the thing you do, not with reference material", () => {
  const markup = renderToStaticMarkup(panels(model.QUESTIONS.map(unfittedHead)));
  const text = visibleText(panels(model.QUESTIONS.map(unfittedHead)));

  // The setup form is on the page, open, not behind a button.
  assert.match(text, /Set up a round/);
  assert.match(text, /This will draw/);
  assert.match(markup, /<form/);
  assert.match(markup, /<select/);
  // And the list of rounds it adds to is visible at the same time, which is
  // what a drawer over the page made impossible.
  assert.match(text, /Rounds/);

  // And nothing else. With nothing calibrated there is no calibration section
  // at all: a permanent line saying no probability is available is a true
  // sentence a researcher cannot act on, and it was on the page every visit.
  assert.doesNotMatch(markup, /<details/);
  assert.doesNotMatch(text, /No calibrated probability is available/);
  assert.doesNotMatch(text, /questions calibrated/);
});

test("one short description, and no wall of text", () => {
  const markup = renderToStaticMarkup(panels(model.QUESTIONS.map(unfittedHead)));
  const text = visibleText(panels(model.QUESTIONS.map(unfittedHead)));
  assert.match(text, /Test your top hits at the bench and find out which way of picking them works/);

  // Prose is measured over paragraphs and list items; a table's cells carry
  // figures and are not prose. The budget is asserted because prose creeps
  // back one sentence at a time.
  const prose = [...markup.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(([, , inner]) => inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const words = prose.join(" ").split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 120, `the page has grown to ${words} words of prose`);
});

test("nothing on the page uses a long dash", () => {
  // Asked for, and easy to reintroduce by accident in a placeholder.
  const text = visibleText(panels(model.QUESTIONS.map(unfittedHead)));
  assert.doesNotMatch(text, /[\u2014\u2013]/);
});

test("with nothing calibrated no percentage appears anywhere", () => {
  const text = visibleText(panels(model.QUESTIONS.map(unfittedHead)));
  // Not a single probability, because there is nothing to put one on. The
  // lookbehind lets a bin label like "80-100%" through; there are none here.
  assert.doesNotMatch(text, /(?<![-\u2013])\b\d{1,3}%/);
});

test("the calibration section appears only once something is calibrated", () => {
  const nothing = renderToStaticMarkup(panels(model.QUESTIONS.map(unfittedHead)));
  assert.doesNotMatch(nothing, /<details/);

  const some = renderToStaticMarkup(
    panels([fittedHead("reproduces"), ...model.QUESTIONS.slice(1).map(unfittedHead)]),
  );
  assert.match(some, /<details/);
});

test("all four questions are listed once the section exists, fitted or not", () => {
  const heads = [
    fittedHead("reproduces"),
    fittedHead("target_specific"),
    fittedHead("cross_model"),
    unfittedHead("pharmacologic"),
  ];
  const text = visibleText(panels(heads));
  assert.match(text, /3 of 4 questions calibrated/);
  for (const question of model.QUESTIONS) {
    assert.ok(text.includes(model.QUESTION_LABEL[question]), question);
  }
  // The unfitted one appears rather than being dropped so the page looks whole.
  assert.match(text, /Not available/);
});

test("a calibrated question reports its cohort and its held-out measurement", () => {
  const heads = model.QUESTIONS.map((question) =>
    question === "reproduces" ? fittedHead(question) : unfittedHead(question),
  );
  const text = visibleText(panels(heads));
  assert.match(text, /389/); // decided outcomes
  assert.match(text, /0\.108/); // Brier
  assert.match(text, /0\.93/); // calibration slope
  assert.match(text, /69% to >99%/); // evidenced range
});

test("the evidenced range never prints as certainty", () => {
  // evidencedHigh is exactly 1.0 in the fixture. A page formatting it itself
  // would print 100%, which asserts an experiment cannot fail.
  const heads = [fittedHead("reproduces"), ...model.QUESTIONS.slice(1).map(unfittedHead)];
  const text = visibleText(panels(heads));
  assert.match(text, /69% to >99%/);
  assert.doesNotMatch(text, /(?<![-\u2013])\b100%/);
});

test("coverage lists shut contexts, not only open ones", () => {
  // The shut ones are the useful ones: they say how far off a context is.
  const heads = [fittedHead("reproduces"), ...model.QUESTIONS.slice(1).map(unfittedHead)];
  const text = visibleText(
    panels(heads, {
      strata: [
        {
          key: "a", question: "reproduces",
          describe: "knockout, ko fitness, fitness phenotype, in cancer cell lines",
          nDecided: 41, nValidated: 30, nFailed: 11, nLabs: 4, nScreens: 9,
          isOpen: true, shortfall: [], minOutcomes: 40, minLabs: 3, minScreens: 5,
        },
        {
          key: "b", question: "pharmacologic",
          describe: "knockout, other, fitness phenotype, in organoids",
          nDecided: 12, nValidated: 5, nFailed: 7, nLabs: 2, nScreens: 3,
          isOpen: false, shortfall: ["12 of 40 decided outcomes"],
          minOutcomes: 40, minLabs: 3, minScreens: 5,
        },
      ],
    }),
  );
  assert.match(text, /in cancer cell lines/);
  assert.match(text, /in organoids/);
  assert.match(text, /Open/);
  assert.match(text, /Short/);
});

test("the endpoint registry sits beside the calibration it belongs with", () => {
  const heads = [fittedHead("reproduces"), ...model.QUESTIONS.slice(1).map(unfittedHead)];
  const text = visibleText(panels(heads));
  assert.match(text, /Independent guide, knockout fitness/);
  assert.match(text, /Selective small-molecule inhibition/);
  // The pass bar is the laboratory's, and the table says so in one word.
  assert.match(text, /\bYou\b/);
});

test("the endpoint a round will use explains itself in the form, always", () => {
  // The registry's one genuinely operational line is the endpoint's own
  // meaning, and it is under the control that picks it rather than only in a
  // section that may not be there.
  const text = visibleText(panels(model.QUESTIONS.map(unfittedHead)));
  assert.match(text, /What counts as validated/);
  // The chosen endpoint's own meaning, rendered under the control that picks it.
  assert.ok(text.includes(ENDPOINTS[0].negativeMeans), ENDPOINTS[0].negativeMeans);
});

test("rounds show their state, their stamp and the next thing to do", () => {
  const text = visibleText(
    panels(model.QUESTIONS.map(unfittedHead), {
      rounds: [
        {
          id: "r1", name: "Kinome round one", screenId: "s1", screenName: "RSL3 screen",
          state: "frozen", design: "stratified_arms", budget: 20,
          endpoint: "ko_fitness_independent_guide.v1", laboratoryThreshold: 1,
          receiptSha256: "a".repeat(64), frozenAt: "2026-10-03T10:00:00Z",
          revealedAt: null, createdAt: "2026-10-02T10:00:00Z",
          nSlots: 20, nRecorded: 6, nDecided: 5,
        },
        {
          id: "r2", name: "Draft round", screenId: "s1", screenName: "RSL3 screen",
          state: "draft", design: "rank_stratified", budget: 70,
          endpoint: null, laboratoryThreshold: null, receiptSha256: null,
          frozenAt: null, revealedAt: null, createdAt: "2026-10-03T09:00:00Z",
          nSlots: 70, nRecorded: 0, nDecided: 0,
        },
      ],
      view: { nRounds: 2, nFrozenRounds: 1 },
    }),
  );
  assert.match(text, /1 of 2 frozen/);
  assert.match(text, /Kinome round one/);
  assert.match(text, /Frozen/);
  assert.match(text, /Draft/);
  assert.match(text, /aaaaaaaaaa/);
  // Every state offers its own next step.
  assert.match(text, /Freeze/);
  assert.match(text, /Record results/);
  assert.match(text, /Reveal/);
});

test("a workspace with no analysed screen says so instead of offering a form", () => {
  const text = visibleText(panels(model.QUESTIONS.map(unfittedHead), { screens: [] }));
  assert.match(text, /Analyse a screen first/);
  assert.doesNotMatch(text, /This will draw/);
});

test("selecting a round shows its results instead of the setup form", () => {
  const results = {
    round: {
      id: "r1", name: "Kinome round one", screenId: "s1", screenName: "RSL3 screen",
      state: "revealed", design: "stratified_arms", budget: 8,
      endpoint: "ko_fitness_independent_guide.v1", laboratoryThreshold: 1,
      receiptSha256: "a".repeat(64), frozenAt: null, revealedAt: null,
      createdAt: "2026-10-03T09:00:00Z", nSlots: 8, nRecorded: 6, nDecided: 5,
    },
    progress: {
      nDrawn: 8, nRecorded: 6, nDecided: 5, nPending: 0, nInconclusive: 1,
      nOutstanding: 2, complete: false,
    },
    arms: [
      { arm: "splicr", label: "SplicR", nDrawn: 6, nRecorded: 5, nDecided: 4,
        nValidated: 3, rate: 0.75, lower: 0.3, upper: 0.95, costPerConfirmation: 1.3 },
      { arm: "fdr", label: "FDR ranking", nDrawn: 6, nRecorded: 5, nDecided: 5,
        nValidated: 3, rate: 0.6, lower: 0.23, upper: 0.88, costPerConfirmation: 1.7 },
    ],
    comparisons: [
      {
        difference: { arm: "splicr", comparator: "fdr", rate: 0.75, comparatorRate: 0.6,
          difference: 0.15, lower: -0.38, upper: 0.57, separated: false },
        sentence: "SplicR confirmed 15% more of its candidates than FDR ranking. The interval includes zero, so this round does not separate them.",
      },
    ],
    discordances: [
      { arm: "splicr", comparator: "fdr", nShared: 4, nOnlyArm: 2, nOnlyComparator: 2,
        armConfirmed: 0, comparatorConfirmed: 0, armDecided: 1, comparatorDecided: 1,
        pValue: null, because: "No candidate that only one of them chose has been confirmed yet." },
    ],
    candidates: [
      { gene: "HIT01", arm: "splicr", wantedBy: ["splicr", "fdr"], rankOverall: 1,
        result: "validated", endpointDecision: "validated", effectSize: -1.8,
        labId: "LAB-1", outcomeId: "o1" },
      { gene: "HIT07", arm: "splicr", wantedBy: ["splicr"], rankOverall: 7,
        result: null, endpointDecision: null, effectSize: null, labId: null, outcomeId: null },
    ],
    complete: false,
  };
  const text = visibleText(panels(model.QUESTIONS.map(unfittedHead), { results }));

  // The results, not the form.
  assert.doesNotMatch(text, /This will draw/);
  assert.match(text, /Kinome round one/);
  assert.match(text, /All rounds/);
  // The figures a researcher came for.
  assert.match(text, /Recorded/);
  assert.match(text, /Confirmed/);
  assert.match(text, /Validations per confirmation/);
  assert.match(text, /By strategy/);
  assert.match(text, /SplicR/);
  assert.match(text, /FDR ranking/);
  // The comparison, and what it is entitled to say.
  assert.match(text, /does not separate them/);
  assert.doesNotMatch(text, /\bbetter\b|outperform/i);
  // A candidate with nothing recorded offers the way to record it.
  assert.match(text, /Not recorded/);
  assert.match(text, /Record/);
  // A shared candidate is labelled as shared, not credited to one strategy.
  assert.match(text, /Both \(2\)/);
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

const rung = (key, label, state, over = {}) => ({
  key,
  label,
  gloss: "gloss",
  question: key === "primary" ? null : "reproduces",
  state,
  because: "because",
  nOutcomes: 0,
  nMet: 0,
  nNotMet: 0,
  nInconclusive: 0,
  nPending: 0,
  estimateAvailable: false,
  estimateBecause: "No calibrated probability is available for this question.",
  ...over,
});

test("the ladder renders every state with its own word", () => {
  const text = visibleText(
    ladderModule.ValidationLadder({
      view: {
        status: "ready",
        gene: "PRKDC",
        nOutcomes: 4,
        nUnplaced: 0,
        next: { label: "Orthogonal genetic evidence", why: "the earliest rung with no outcome" },
        rungs: [
          rung("primary", "Primary screen", "met"),
          rung("guide", "Guide reproducibility", "met", { nOutcomes: 1, nMet: 1 }),
          rung("orthogonal", "Orthogonal genetic evidence", "not_tested"),
          rung("pharmacologic", "Pharmacologic evidence", "not_met", { nOutcomes: 2, nNotMet: 2 }),
          rung("another_model", "Another model", "mixed", { nOutcomes: 2, nMet: 1, nNotMet: 1 }),
          rung("in_vivo", "In vivo", "not_tested"),
        ],
      },
      span: 12,
    }),
  );
  assert.match(text, /Validation ladder: PRKDC/);
  assert.match(text, /Guide reproducibility Met/);
  assert.match(text, /Pharmacologic evidence Not met/);
  assert.match(text, /Another model Mixed/);
  assert.match(text, /Orthogonal genetic evidence Not tested/);
  assert.match(text, /1 met, 1 did not/);
  assert.match(text, /Next: Orthogonal genetic evidence/);
  assert.match(text, /not a negative result about this gene/);
  // No probability anywhere, because none is calibrated.
  assert.doesNotMatch(text, /\b\d{1,3}%/);
  assert.match(text, /No calibrated probability is available for this question/);
});
