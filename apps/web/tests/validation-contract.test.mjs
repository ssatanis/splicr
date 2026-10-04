/**
 * One vocabulary, three languages.
 *
 * The Validation Network's enums exist in Python (the engine computes with
 * them), in SQL (the database constrains to them) and in TypeScript (the
 * console renders them). Three copies is two copies too many, and the only
 * thing that makes it safe is this file: it parses all three and fails naming
 * the term and the file when they disagree.
 *
 * Nothing here imports the engine. It reads the Python and SQL as text, which
 * means these tests run in CI with Node alone — the same constraint the
 * evidence gate works under — and a Python environment is never a prerequisite
 * for catching drift.
 *
 * WHAT A FAILURE HERE MEANS
 *
 * A validation type the console can submit and the database will reject. A
 * question the engine scores and the console cannot name. A probability floor
 * the engine enforces and the console formats past. Each of those is a bug that
 * would otherwise reach a scientist as a wrong number or a silent write
 * failure, and each of them is a one-line diff to fix once this test says which
 * file is behind.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");
const ENGINE = join(REPO, "engine", "splicr", "validation");
const MIGRATION = join(
  REPO,
  "supabase",
  "migrations",
  "20261003000100_validation_network.sql",
);

const ts = loadTs("lib/validation/model.ts");
const py = {
  endpoints: readFileSync(join(ENGINE, "endpoints.py"), "utf8"),
  outcomes: readFileSync(join(ENGINE, "outcomes.py"), "utf8"),
  features: readFileSync(join(ENGINE, "features.py"), "utf8"),
  coverage: readFileSync(join(ENGINE, "coverage.py"), "utf8"),
  network: readFileSync(join(ENGINE, "network.py"), "utf8"),
  report: readFileSync(join(ENGINE, "report.py"), "utf8"),
  cohort: readFileSync(join(ENGINE, "cohort.py"), "utf8"),
};
const sql = readFileSync(MIGRATION, "utf8");

/** Members of a Python `NAME: tuple[str, ...] = ( "a", "b" )` assignment. */
function pythonTuple(source, name) {
  const re = new RegExp(`^${name}\\s*(?::[^=]+)?=\\s*\\(`, "m");
  const start = re.exec(source);
  assert.ok(start, `could not find the Python tuple ${name}`);
  const open = start.index + start[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > open, `unbalanced parentheses in ${name}`);
  return [...source.slice(open + 1, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Python source with implicit string concatenation joined up.
 *
 * Python writes a long message as adjacent literals across lines:
 *
 *     negative_means="It is not evidence that the screen hit was "
 *                    "false."
 *
 * which is one string to Python and two to a regex. Joining `" "` boundaries
 * lets a test assert on the sentence a reader actually sees rather than on how
 * it happened to wrap.
 */
function pythonProse(source) {
  return source.replace(/"\s*\n\s*"/g, "");
}

/** A Python module-level numeric constant. */
function pythonNumber(source, name) {
  const match = new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "m").exec(source);
  assert.ok(match, `could not find the Python constant ${name}`);
  return Number(match[1]);
}

/** Members of a `create type public.NAME as enum (...)`. */
function sqlEnum(name) {
  const re = new RegExp(`create type public\\.${name} as enum\\s*\\(([^)]*)\\)`, "i");
  const match = re.exec(sql);
  assert.ok(match, `could not find the SQL enum public.${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Members of a `check (col in ('a','b'))` clause for one column. */
function sqlCheckIn(column) {
  const re = new RegExp(`${column}[^,]*?check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "is");
  const match = re.exec(sql);
  assert.ok(match, `could not find a check-in constraint for ${column}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// The vocabularies
// ---------------------------------------------------------------------------

const VOCABULARIES = [
  {
    what: "validation types",
    ts: () => [...ts.VALIDATION_TYPES],
    py: () => pythonTuple(py.endpoints, "VALIDATION_TYPES"),
    sql: () => sqlEnum("validation_type"),
  },
  {
    what: "questions",
    ts: () => [...ts.QUESTIONS],
    py: () => pythonTuple(py.endpoints, "QUESTIONS"),
    sql: () => sqlEnum("validation_question"),
  },
  {
    what: "assay classes",
    ts: () => [...ts.ASSAY_CLASSES],
    py: () => pythonTuple(py.endpoints, "ASSAY_CLASSES"),
    sql: () => sqlEnum("assay_class"),
  },
  {
    what: "phenotype families",
    ts: () => [...ts.PHENOTYPE_FAMILIES],
    py: () => pythonTuple(py.outcomes, "PHENOTYPE_FAMILIES"),
    sql: () => sqlEnum("phenotype_family"),
  },
  {
    what: "model types",
    ts: () => [...ts.MODEL_TYPES],
    py: () => pythonTuple(py.outcomes, "MODEL_TYPES"),
    sql: () => sqlEnum("model_type"),
  },
  {
    what: "validation arms",
    ts: () => [...ts.VALIDATION_ARMS],
    py: () => pythonTuple(py.outcomes, "ARMS"),
    sql: () => sqlEnum("validation_arm"),
  },
  {
    what: "round states",
    ts: () => [...ts.ROUND_STATES],
    py: () => pythonTuple(py.rounds ?? "", "STATES"),
    sql: () => sqlEnum("round_state"),
    pySource: "rounds",
  },
  {
    what: "endpoint decisions",
    ts: () => [...ts.ENDPOINT_DECISIONS],
    py: () => pythonTuple(py.endpoints, "DECISIONS"),
    sql: () => sqlEnum("endpoint_decision"),
  },
  {
    what: "rung states",
    ts: () => [...ts.RUNG_STATES],
    py: () => pythonTuple(py.report, "RUNG_STATES"),
    sql: () => sqlEnum("rung_state"),
  },
  {
    what: "evidence families",
    ts: () => [...ts.FAMILIES],
    py: () => pythonTuple(py.features, "FAMILIES"),
    sql: null,
  },
];

py.rounds = readFileSync(join(ENGINE, "rounds.py"), "utf8");

for (const vocabulary of VOCABULARIES) {
  test(`${vocabulary.what}: the engine, the database and the console agree`, () => {
    const inTs = vocabulary.ts();
    const inPy = vocabulary.py();
    assert.deepEqual(
      inTs,
      inPy,
      `${vocabulary.what} differ between apps/web/src/lib/validation/model.ts and the engine. ` +
        `Console has [${inTs}], engine has [${inPy}].`,
    );
    if (vocabulary.sql) {
      const inSql = vocabulary.sql();
      assert.deepEqual(
        inSql,
        inPy,
        `${vocabulary.what} differ between the migration and the engine. ` +
          `SQL has [${inSql}], engine has [${inPy}].`,
      );
    }
  });
}

test("the order is the same everywhere, not just the set", () => {
  // Order is load-bearing: a select renders options in it, and a SQL enum's
  // sort order is its declaration order, so two lists with the same members in
  // different orders will render differently and sort differently.
  assert.deepEqual(
    [...ts.VALIDATION_TYPES],
    pythonTuple(py.endpoints, "VALIDATION_TYPES"),
  );
  assert.equal(ts.VALIDATION_TYPES[0], "independent_guide");
  assert.equal(ts.VALIDATION_TYPES.at(-1), "other");
});

// ---------------------------------------------------------------------------
// The mapping from what was done to what it answers
// ---------------------------------------------------------------------------

test("every validation type maps to the same question in all three layers", () => {
  const engine = {};
  const body = py.endpoints.slice(py.endpoints.indexOf("TYPE_QUESTION"));
  for (const [, kind, answer] of body.matchAll(/"([a-z_]+)":\s*(None|"[a-z_]+")/g)) {
    if (!ts.VALIDATION_TYPES.includes(kind)) continue;
    if (kind in engine) continue;
    engine[kind] = answer === "None" ? null : answer.replace(/"/g, "");
  }
  assert.deepEqual(
    Object.fromEntries(ts.VALIDATION_TYPES.map((k) => [k, ts.TYPE_QUESTION[k]])),
    engine,
  );

  // And the SQL function that the ladder view depends on.
  const fn = sql.slice(sql.indexOf("function public.validation_type_question"));
  const inSql = {};
  for (const [, kind, answer] of fn.matchAll(/when '([a-z_]+)'\s+then '([a-z_]+)'/g)) {
    inSql[kind] = answer;
  }
  for (const kind of ts.VALIDATION_TYPES) {
    const expected = ts.TYPE_QUESTION[kind];
    if (expected === null) {
      assert.equal(inSql[kind], undefined, `${kind} should fall through to null in SQL`);
    } else {
      assert.equal(inSql[kind], expected, `${kind} maps differently in SQL`);
    }
  }
});

test("'other' bears on no question, in every layer", () => {
  // A model cannot learn from a label whose meaning was never fixed, and the
  // three layers have to agree about that or an 'other' outcome would enter a
  // head in one of them.
  assert.equal(ts.TYPE_QUESTION.other, null);
  assert.match(py.endpoints, /"other":\s*None/);
  assert.match(sql, /else null\s*\n\s*end::public\.validation_question/);
});

test("each question has exactly one rung set and no type is on two rungs", () => {
  const seen = new Set();
  for (const rung of ts.RUNGS) {
    for (const kind of rung.types) {
      assert.ok(
        ts.VALIDATION_TYPES.includes(kind),
        `rung ${rung.key} names an unknown type ${kind}`,
      );
      assert.ok(!seen.has(kind), `${kind} appears on more than one rung`);
      seen.add(kind);
      assert.equal(
        ts.TYPE_QUESTION[kind],
        rung.question,
        `${kind} is on the ${rung.key} rung but answers ${ts.TYPE_QUESTION[kind]}`,
      );
    }
  }
  // Every type except 'other' sits on exactly one rung.
  const unplaced = ts.VALIDATION_TYPES.filter((k) => !seen.has(k));
  assert.deepEqual(unplaced, ["other"]);
});

test("the ladder view's rungs match the console's", () => {
  const view = sql.slice(sql.indexOf("create or replace view public.validation_ladder"));
  const inSql = [...view.matchAll(/\('([a-z_]+)',\s*'[^']+',\s*'([a-z_]+)',\s*array\[([^\]]+)\]/g)]
    .map(([, key, question, kinds]) => ({
      key,
      question,
      types: [...kinds.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    }));
  // The view has no 'primary' rung: the primary call lives on the hit, not in
  // validation_outcomes, so the view cannot see it and the console supplies it.
  const expected = ts.RUNGS.filter((r) => r.key !== "primary").map((r) => ({
    key: r.key,
    question: r.question,
    types: [...r.types],
  }));
  assert.deepEqual(inSql, expected);
});

// ---------------------------------------------------------------------------
// The numbers that decide whether anything prints at all
// ---------------------------------------------------------------------------

test("the coverage floors are the same in the engine and the console", () => {
  assert.equal(
    ts.COVERAGE_THRESHOLDS.minStratumOutcomes,
    pythonNumber(py.coverage, "MIN_STRATUM_OUTCOMES"),
  );
  assert.equal(
    ts.COVERAGE_THRESHOLDS.minStratumLabs,
    pythonNumber(py.coverage, "MIN_STRATUM_LABS"),
  );
  assert.equal(
    ts.COVERAGE_THRESHOLDS.minStratumScreens,
    pythonNumber(py.coverage, "MIN_STRATUM_SCREENS"),
  );
  assert.equal(
    ts.COVERAGE_THRESHOLDS.minNetworkOutcomes,
    pythonNumber(py.coverage, "MIN_NETWORK_OUTCOMES"),
  );
  assert.equal(
    ts.COVERAGE_THRESHOLDS.minNetworkLabs,
    pythonNumber(py.coverage, "MIN_NETWORK_LABS"),
  );
  assert.equal(
    ts.COVERAGE_THRESHOLDS.maxDisagreementRate,
    pythonNumber(py.coverage, "MAX_DISAGREEMENT_RATE"),
  );
});

test("the certainty bounds are the same, so nothing prints 100%", () => {
  assert.equal(ts.CERTAINTY_FLOOR, pythonNumber(py.network, "CERTAINTY_FLOOR"));
  assert.equal(ts.CERTAINTY_CEILING, pythonNumber(py.network, "CERTAINTY_CEILING"));
});

test("the published rank-stratified design is quoted with the same numbers", () => {
  const reference = ts.RANK_STRATIFIED_REFERENCE;
  assert.equal(reference.source, "doi:10.1038/s43586-022-00098-7");
  const block = py.cohort.slice(py.cohort.indexOf("RANK_STRATIFIED_REFERENCE"));
  assert.match(block, new RegExp(`"source":\\s*"${reference.source}"`));
  assert.match(block, new RegExp(`"top_n":\\s*${reference.topN}`));
  assert.match(block, new RegExp(`"per_percentile":\\s*${reference.perPercentile}`));
  assert.match(block, new RegExp(`"total":\\s*${reference.total}`));
  assert.match(
    block,
    new RegExp(`"percentiles":\\s*\\(${reference.percentiles.join(", ")}\\)`),
  );
  // 20 + 5 x 10 = 70. If the arithmetic ever stops holding, one of the numbers
  // was edited without the other.
  assert.equal(
    reference.topN + reference.percentiles.length * reference.perPercentile,
    reference.total,
  );
});

test("the arm precedence puts SplicR last in both layers", () => {
  // Not cosmetic: a candidate the investigator also chose is credited to the
  // investigator, which makes every measured lift a conservative one. Reversing
  // this would silently inflate SplicR's precision.
  assert.deepEqual([...ts.ARM_PRECEDENCE], pythonTuple(py.cohort, "ARM_PRECEDENCE"));
  assert.equal(ts.ARM_PRECEDENCE.at(-1), "splicr");
});

// ---------------------------------------------------------------------------
// The wording that makes a percentage a claim
// ---------------------------------------------------------------------------

test("the question sentence is byte-identical in the engine and the console", () => {
  // The engine builds the sentence for a CLI and a report; the console builds
  // it for a panel. If they drift, two surfaces describe the same number as two
  // different experiments.
  const block = py.endpoints.slice(
    py.endpoints.indexOf("QUESTION_SENTENCE"),
    py.endpoints.indexOf("# ---", py.endpoints.indexOf("QUESTION_SENTENCE")),
  );
  for (const question of ts.QUESTIONS) {
    const consoleText = ts.QUESTION_SENTENCE[question];
    // Python wraps these across lines; rejoin before comparing.
    const re = new RegExp(`"${question}":\\s*((?:"[^"]*"\\s*)+)`);
    const match = re.exec(block);
    assert.ok(match, `the engine has no sentence for ${question}`);
    const engineText = [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
    assert.equal(
      engineText,
      consoleText,
      `the ${question} sentence differs between the engine and the console`,
    );
  }
});

test("every question's sentence names an experiment and not a gene", () => {
  for (const question of ts.QUESTIONS) {
    const sentence = ts.QUESTION_SENTENCE[question];
    assert.match(sentence, /^estimated probability/);
    assert.ok(sentence.length > 40, `${question}'s sentence is too terse to interpret`);
    // It must not say "is real", "is a true hit" or similar: the claim is about
    // an experiment reproducing, never about the gene being real.
    assert.doesNotMatch(sentence, /\bis real\b|\btrue hit\b|\bcorrect\b/i);
  }
});

test("every term the console renders has a label and a gloss", () => {
  for (const kind of ts.VALIDATION_TYPES) {
    assert.ok(ts.VALIDATION_TYPE_LABEL[kind], `${kind} has no label`);
    assert.ok(ts.VALIDATION_TYPE_HELP[kind], `${kind} has no help text`);
  }
  for (const question of ts.QUESTIONS) {
    assert.ok(ts.QUESTION_LABEL[question]);
    assert.ok(ts.QUESTION_SHORT[question]);
    assert.ok(ts.QUESTION_SENTENCE[question]);
  }
  for (const state of ts.RUNG_STATES) {
    assert.ok(ts.RUNG_STATE_LABEL[state]);
    assert.ok(ts.RUNG_STATE_GLOSS[state]);
  }
  for (const decision of ts.ENDPOINT_DECISIONS) {
    assert.ok(ts.ENDPOINT_DECISION_LABEL[decision]);
    assert.ok(ts.ENDPOINT_DECISION_HELP[decision]);
  }
  for (const state of ts.ROUND_STATES) {
    assert.ok(ts.ROUND_STATE_LABEL[state]);
    assert.ok(ts.ROUND_STATE_HELP[state]);
  }
  // Four distinct glosses, so no view can collapse two rung states into one by
  // relabelling.
  assert.equal(new Set(Object.values(ts.RUNG_STATE_GLOSS)).size, 4);
  assert.equal(new Set(Object.values(ts.ENDPOINT_DECISION_HELP)).size, 4);
});

test("'not tested' and 'not scorable' both say they are not failures", () => {
  assert.match(ts.RUNG_STATE_GLOSS.not_tested, /not a negative result/i);
  assert.match(ts.ENDPOINT_DECISION_HELP.insufficient_record, /not a failure/i);
  assert.match(ts.RUNG_STATE_GLOSS.mixed, /Both are kept/);
});

// ---------------------------------------------------------------------------
// The database's own guarantees, read out of the migration text
// ---------------------------------------------------------------------------

test("a prediction row is available with a cohort or unavailable with a reason", () => {
  const constraint = /constraint predictions_available_shape check \(([\s\S]*?)\n  \),/.exec(sql);
  assert.ok(constraint, "the available/unavailable shape constraint is missing");
  const body = constraint[1];
  // Available: a probability, an interval and a cohort, and no reason.
  assert.match(body, /available and probability is not null/);
  assert.match(body, /cohort_n_decided is not null/);
  assert.match(body, /cohort_sentence is not null/);
  assert.match(body, /unavailable_reason is null/);
  // Unavailable: no probability at all, and a reason.
  assert.match(body, /not available and probability is null/);
  assert.match(body, /unavailable_reason is not null/);
});

test("a receipt can be written and never rewritten", () => {
  const block = sql.slice(
    sql.indexOf("create table public.prediction_receipts"),
    sql.indexOf("create table public.validation_predictions"),
  );
  assert.match(block, /for insert to authenticated/);
  assert.match(block, /for select to authenticated/);
  assert.doesNotMatch(block, /for update/);
  assert.doesNotMatch(block, /for delete/);
  // And the grant withholds both verbs rather than relying on policy absence
  // alone.
  assert.match(block, /grant select, insert on public\.prediction_receipts/);
  assert.doesNotMatch(block, /grant[^;]*update[^;]*prediction_receipts/);
});

test("a round moves forwards only, enforced in the database", () => {
  assert.match(sql, /function private\.validation_round_forward_only/);
  assert.match(sql, /a revealed round cannot be reopened/);
  assert.match(sql, /a changed design is a new round/);
  assert.match(sql, /its receipt hash cannot change/);
  assert.match(sql, /its design was committed and cannot change/);
  assert.match(sql, /trigger validation_rounds_forward_only before update/);
});

test("a validation set cannot grow after the freeze", () => {
  assert.match(sql, /function private\.validation_slot_before_freeze/);
  assert.match(sql, /its validation set was committed and cannot grow/);
  assert.match(sql, /trigger validation_slots_before_freeze before insert/);
});

test("a frozen round must have a receipt", () => {
  assert.match(sql, /constraint rounds_frozen_needs_receipt/);
  assert.match(sql, /state = 'draft' or \(receipt_sha256 is not null/);
});

test("a laboratory-owned threshold cannot be fixed in the registry", () => {
  // SplicR must not decide what counts as a response in somebody else's assay.
  assert.match(sql, /constraint endpoints_threshold_owner_ck/);
  assert.match(sql, /threshold_owner <> 'laboratory' or effect_threshold is null/);
  assert.deepEqual(sqlCheckIn("threshold_owner"), ["laboratory", "splicr", "published"]);
  // And the engine enforces the same rule.
  assert.match(pythonProse(py.endpoints), /a laboratory-owned threshold cannot be fixed here/);
});

test("the database stores no validation probability on a hit", () => {
  // A column would let a probability be written without a cohort or a stratum.
  assert.doesNotMatch(sql, /alter table public\.hits[\s\S]{0,400}validation_probability/);
  assert.doesNotMatch(sql, /add column\s+validation_probability/);
});

test("every new table has row level security on", () => {
  const tables = [
    "validation_endpoints",
    "validation_rounds",
    "validation_slots",
    "prediction_receipts",
    "validation_predictions",
    "validation_models",
    "validation_coverage",
  ];
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} does not enable RLS`,
    );
  }
});

test("the published criteria are seeded as an example and never as a default", () => {
  const seed = sql.slice(sql.indexOf("insert into public.validation_endpoints"));
  // The organoid and pharmacologic endpoints carry the paper; both leave the
  // threshold null and owned by the laboratory.
  assert.match(seed, /10\.1158\/0008-5472\.CAN-24-0775/);
  assert.match(seed, /a reduction of at least 50% \(log2 fold change < -1\) and a p value < 0\.05/);
  // SQL doubles an apostrophe inside a quoted literal, so the stored text is
  // `screen''s`. Matching the raw bytes keeps this test honest about what is
  // actually in the migration.
  assert.match(seed, /screen''s own hit criterion/);
  // Nine endpoints, each with a null effect_threshold.
  const rows = seed.split("\n  ('").length - 1;
  assert.equal(rows, 9, "the registry seed should hold nine endpoints");
});

// ---------------------------------------------------------------------------
// The generated registry against the engine that generated it
// ---------------------------------------------------------------------------

test("the generated endpoint registry has not fallen behind the engine", () => {
  // `npm run validation:check` is the authoritative check and needs Python.
  // This one needs only Node, like the evidence gate, so a drifted definition
  // fails in any environment rather than only where an engine env exists.
  const generated = JSON.parse(
    readFileSync(
      join(REPO, "apps/web/src/lib/validation/endpoints.generated.json"),
      "utf8",
    ),
  );
  const source = pythonProse(py.endpoints);

  // Every endpoint the engine registers is in the export, and nothing else is.
  const registered = [...source.matchAll(/^\s*endpoint_id="([a-z_]+)",\n\s*version=(\d+),/gm)]
    .map(([, id, version]) => `${id}.v${version}`);
  assert.ok(registered.length >= 9, "the engine should register at least nine endpoints");
  assert.deepEqual(
    Object.keys(generated.endpoints).sort(),
    [...registered].sort(),
    "the exported registry and the engine's registry hold different endpoints. Run npm run validation:export.",
  );

  // And each one's scalar rules match. These are the numbers that decide
  // whether a recorded experiment counts, so a stale export would score
  // outcomes in the console by rules the engine no longer applies.
  const blocks = source.split("register(Endpoint(").slice(1);
  const scalars = {
    requires_independent_perturbation: "boolean",
    requires_distinct_constructs: "boolean",
    min_independent_perturbations: "number",
    min_biological_replicates: "number",
  };
  let checked = 0;
  for (const block of blocks) {
    const id = /endpoint_id="([a-z_]+)"/.exec(block)?.[1];
    const version = /version=(\d+)/.exec(block)?.[1];
    if (!id || !version) continue;
    const exported = generated.endpoints[`${id}.v${version}`];
    assert.ok(exported, `${id}.v${version} is missing from the export`);
    // A field the registration does not state takes the dataclass default, and
    // the export holds that default. Comparing only what is declared keeps the
    // test about drift rather than about which fields happen to be spelled out.
    for (const field of ["question", "direction", "threshold_owner"]) {
      const match = new RegExp(`${field}="([a-z_]+)"`).exec(block);
      if (match) assert.equal(exported[field], match[1], `${id}: ${field}`);
    }
    for (const [field, kind] of Object.entries(scalars)) {
      const match = new RegExp(`${field}=(True|False|\\d+)`).exec(block);
      if (!match) continue;
      const expected = kind === "boolean" ? match[1] === "True" : Number(match[1]);
      assert.equal(exported[field], expected, `${id}: ${field}`);
    }
    checked++;
  }
  assert.ok(checked >= 9, `only ${checked} endpoint definitions were compared`);

  // The defaults themselves, checked on the export rather than inferred: every
  // endpoint belongs to a known question, and a laboratory-owned threshold is
  // never fixed, whether it was spelled out at registration or inherited.
  for (const [key, endpoint] of Object.entries(generated.endpoints)) {
    assert.ok(ts.QUESTIONS.includes(endpoint.question), `${key}: unknown question`);
    assert.ok(
      ["laboratory", "splicr", "published"].includes(endpoint.threshold_owner),
      `${key}: unknown threshold owner`,
    );
    assert.ok(
      ["depleted", "enriched", "either"].includes(endpoint.direction),
      `${key}: unknown direction`,
    );
    if (endpoint.threshold_owner === "laboratory") {
      assert.equal(
        endpoint.effect_threshold,
        null,
        `${key}: a laboratory-owned threshold must not be fixed`,
      );
    }
    assert.match(endpoint.definition_sha256, /^[0-9a-f]{64}$/, key);
    for (const kind of endpoint.validation_types) {
      assert.ok(ts.VALIDATION_TYPES.includes(kind), `${key}: unknown type ${kind}`);
      assert.equal(
        ts.TYPE_QUESTION[kind],
        endpoint.question,
        `${key}: ${kind} answers a different question`,
      );
    }
  }
});

test("the decision matrix was generated from the exported registry", () => {
  const generated = JSON.parse(
    readFileSync(
      join(REPO, "apps/web/src/lib/validation/endpoints.generated.json"),
      "utf8",
    ),
  );
  const matrix = JSON.parse(
    readFileSync(join(REPO, "apps/web/tests/fixtures/endpoint-decisions.json"), "utf8"),
  );
  assert.equal(matrix.registry_sha256, generated.registry_sha256);
  // The matrix is a sample of a much larger product, and it says so rather
  // than implying it is exhaustive.
  assert.ok(matrix.n_cases_in_full_product > matrix.n_cases);
  assert.match(matrix.sampling, /stratified/);
});

test("the pharmacologic endpoint says what a negative result does not mean", () => {
  const seed = sql.slice(sql.indexOf("insert into public.validation_endpoints"));
  assert.match(seed, /not evidence that the screen hit was false/);
  assert.match(seed, /PRKDC inhibitors LTURM34 and AZD7648/);
  const prose = pythonProse(py.endpoints);
  assert.match(prose, /not evidence that the screen hit was false/);
  assert.match(prose, /PRKDC inhibitors LTURM34 and AZD7648/);
  // The engine and the migration carry the same warning, so a reader sees it
  // whichever surface shows them the endpoint.
  assert.match(prose, /showed no potent activity at the tested concentrations/);
});
