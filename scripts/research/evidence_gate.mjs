/** Evidence integrity, not biological certification. No network, Python, or database. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = raw => createHash("sha256").update(raw).digest("hex");
const check = (condition, message) => { if (!condition) throw new Error(`Evidence gate: ${message}`); };
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const close = (a, b) => finite(a) && finite(b) && Math.abs(a - b) < 1e-12;

export function read(root, relative) {
  check(typeof relative === "string" && !path.isAbsolute(relative) && !relative.includes("\\") &&
    !relative.split("/").includes(".."), `unsafe artifact path: ${relative}`);
  const base = fs.realpathSync(root);
  const location = fs.realpathSync(path.join(base, relative));
  check(location.startsWith(base + path.sep), `artifact leaves repository: ${relative}`);
  return fs.readFileSync(location);
}
const json = (root, file) => JSON.parse(read(root, file));
const equal = (a, b, message) => check(isDeepStrictEqual(a, b), message);

function metric(summary, cohort, name) {
  check(summary && finite(summary.mean) && summary.mean >= 0 && summary.mean <= 1, `${name}: invalid mean`);
  check(Array.isArray(summary.ci95) && summary.ci95.length === 2 && summary.ci95.every(finite) &&
    summary.ci95[0] >= 0 && summary.ci95[0] <= summary.ci95[1] && summary.ci95[1] <= 1, `${name}: invalid interval`);
  check(summary.n_screens === cohort.n_screens && summary.n_publications === cohort.n_publications,
    `${name}: incomplete cohort`);
  check(summary.unit === "publication", `${name}: dependence-aware uncertainty required`);
}

function screenSet(rows, cohort, name) {
  check(Array.isArray(rows) && rows.length === cohort.n_screens, `${name}: missing cohort screens`);
  const ids = rows.map(row => row.dataset_name);
  check(ids.every(id => typeof id === "string" && id.length) && new Set(ids).size === ids.length,
    `${name}: duplicate or missing screen IDs`);
  check(rows.every(row => typeof row.source_id === "string" && row.source_id.length), `${name}: publication provenance missing`);
  check(new Set(rows.map(row => row.source_id)).size === cohort.n_publications, `${name}: publication coverage mismatch`);
  check(rows.every(row => finite(row["adjusted_ndcg@100"]) && row["adjusted_ndcg@100"] >= 0 &&
    row["adjusted_ndcg@100"] <= 1), `${name}: invalid per-screen metric`);
  return ids.sort();
}

function provenance(value, cohort, name) {
  check(value && value.assaybench_version === cohort.assaybench_version, `${name}: evaluator version missing/mismatched`);
  for (const key of ["data_sha256", "metric_sha256", "model_code_sha256"]) check(sha(value[key]), `${name}: ${key} missing`);
  check(value.data_sha256 === cohort.dataset_sha256 && value.metric_sha256 === cohort.metric_sha256,
    `${name}: dataset/evaluator provenance mismatch`);
  check(typeof value.git_revision === "string" && /^[a-f0-9]{40}$/.test(value.git_revision), `${name}: code revision missing`);
}

export function validateInputs(root = ROOT) {
  const contract = json(root, "research/evidence_contract.json");
  check(contract.schema_version === 1, "unsupported publication contract");
  check(contract.publication_status === "approved_retrospective_snapshot" && contract.model_promotion_status === "not_promoted",
    "candidate promotion requires independently reviewed replacement contract");
  check(contract.evaluation_kind === "retrospective_public_test" && contract.prospective_validation === null,
    "public retrospective results cannot be relabeled prospective");
  check(contract.calibration_status === "not_fitted" && contract.independent_validation_probability === null,
    "no calibrated validation probability is supported");
  equal(contract.claims, { superiority_over_ensemble: false, perfect_accuracy: false, prospective_generalization: false },
    "unsupported performance claim");
  equal(contract.input_contracts, {router: "metadata_only_training_union_candidates", legacy_prior: "target_measured_universe_available"},
    "incompatible input contracts must remain distinct");
  check(contract.source_sha256 && Object.keys(contract.source_sha256).length > 0, "source pins missing");
  if (contract.post_screen) {
    const post = contract.post_screen;
    check(post.published === true && typeof post.measurement_date === "string" &&
      typeof post.benchmark === "string" && typeof post.note === "string" &&
      Array.isArray(post.limitations) && post.limitations.length > 0,
      "a published post-screen claim must declare its date, benchmark, caveat and limitations");
    check(typeof post.descriptor === "string" && post.descriptor.startsWith("research/artifacts/") &&
      sha(post.descriptor_sha256), "post-screen provenance missing");
    check(hash(read(root, post.descriptor)) === post.descriptor_sha256, "post-screen descriptor changed");
    validateReplicationExperiment(root, post.descriptor);
  }
  if (contract.research_addendum) {
    const addendum = contract.research_addendum;
    check(addendum.published === true && typeof addendum.measurement_date === "string" &&
      typeof addendum.split === "string" && typeof addendum.note === "string",
      "research addendum must declare its publication, date, split and caveat");
    check(addendum.experiments && Object.keys(addendum.experiments).length > 0, "empty research addendum");
    for (const [id, pin] of Object.entries(addendum.experiments)) {
      check(/^[a-zA-Z0-9_.-]+$/.test(id), `invalid addendum experiment id: ${id}`);
      check(typeof pin.descriptor === "string" && pin.descriptor.startsWith("research/artifacts/") &&
        sha(pin.descriptor_sha256), `addendum provenance missing: ${id}`);
      check(hash(read(root, pin.descriptor)) === pin.descriptor_sha256, `addendum descriptor changed: ${id}`);
      const descriptor = json(root, pin.descriptor);
      check(descriptor.experiment_id === id, `addendum descriptor identity mismatch: ${id}`);
      check(descriptor.promotion_status === "research_only", `addendum cannot promote a model: ${id}`);
      check(descriptor.evaluation_kind !== "retrospective_public_test",
        `addendum results must not be published as public-test results: ${id}`);
      check(descriptor.provenance?.public_test_accessed === false,
        `addendum experiment must declare no public-test access: ${id}`);
      check(descriptor.calibration_status === "not_fitted" && descriptor.validation_probability === null,
        `addendum cannot imply a calibrated validation probability: ${id}`);
      for (const [file, expected] of Object.entries(descriptor.artifacts)) {
        check(file.startsWith("research/artifacts/") && sha(expected), `addendum artifact provenance: ${id}`);
        check(hash(read(root, file)) === expected, `addendum artifact changed: ${file}`);
      }
      const summary = json(root, descriptor.summary), rows = json(root, descriptor.screen_results);
      metric(summary, descriptor.cohort, id);
      screenSet(rows, descriptor.cohort, id);
      check(close(rows.reduce((sum, row) => sum + row["adjusted_ndcg@100"], 0) / rows.length, summary.mean),
        `addendum summary differs from its own screens: ${id}`);
      check(typeof pin.title === "string" && typeof pin.selected_model === "string" &&
        typeof pin.comparison === "string" && typeof pin.finding === "string",
        `addendum display text missing: ${id}`);
    }
  }
  for (const [file, expected] of Object.entries(contract.source_sha256)) {
    check(file.startsWith("research/artifacts/") && sha(expected), `invalid source pin: ${file}`);
    check(hash(read(root, file)) === expected, `source hash mismatch: ${file}`);
  }
  const get = name => {
    const file = `research/artifacts/${name}`;
    check(sha(contract.source_sha256[file]), `unapproved source: ${name}`);
    return json(root, file);
  };
  const refs = get("official_references.json"), router = get("router_replay_summary.json");
  const freeze = get("router_freeze.json"), plan = get("router_preregistration.json");
  const cohort = contract.cohort;
  check(Number.isInteger(cohort.n_screens) && cohort.n_screens > 0 && Number.isInteger(cohort.n_publications) &&
    cohort.n_publications > 0 && cohort.n_publications <= cohort.n_screens, "invalid cohort declaration");
  for (const [name, value] of Object.entries({refs, router, freeze, plan})) provenance(value.provenance, cohort, name);
  check(router.split === "test" && freeze.selection_split === "validation", "test selection or split mismatch");
  check(plan.no_library_information === true && plan.no_padding_or_gene_backfill === true &&
    freeze.input === "metadata only; no target library", "router input-contract violation");
  check(refs.legacy_seed_average.input === "target library aware", "legacy input-contract provenance missing");
  check(router.external_file_sha256 === freeze.expert_file_sha256 && sha(router.external_file_sha256), "expert provenance mismatch");
  const rows = get("router_replay_screens.json");
  const ids = screenSet(rows, cohort, "router");
  equal(Object.keys(get("router_replay_predictions.json")).sort(), ids, "predictions omit cohort members");
  metric(router.router, cohort, "router");
  check(close(rows.reduce((sum, row) => sum + row["adjusted_ndcg@100"], 0) / rows.length, router.router.mean), "router mean disagrees with screens");
  for (const dimension of ["phenotype", "modality"]) {
    const groups = router.router.subgroups?.[dimension];
    const observed = [...new Set(rows.map(row => row[dimension]))].sort();
    equal(Object.keys(groups || {}).sort(), observed, `${dimension}: missing subgroup coverage`);
    for (const label of observed) {
      const selected = rows.filter(row => row[dimension] === label);
      check(groups[label].n_screens === selected.length &&
        close(groups[label].mean,selected.reduce((sum,row)=>sum+row["adjusted_ndcg@100"],0)/selected.length),
        `${dimension}: subgroup differs from screens`);
    }
  }
  equal(Object.keys(refs.models).sort(), Object.keys(contract.reference_screen_files).sort(), "missing approved reference model");
  for (const [model, value] of Object.entries(refs.models)) {
    metric(value, cohort, model);
    const file = contract.reference_screen_files?.[model];
    check(sha(contract.source_sha256[file]), `${model}: reference screen provenance missing`);
    const reference = json(root, file);
    equal(screenSet(reference, cohort, model), ids, `${model}: compared cohorts differ`);
    check(close(reference.reduce((sum, row) => sum + row["adjusted_ndcg@100"], 0) / reference.length, value.mean), `${model}: summary differs from screens`);
  }
  const paired = router.paired_vs_external;
  check(paired.n_screens === cohort.n_screens && paired.n_publications === cohort.n_publications && paired.unit === "publication",
    "paired comparison cohort/provenance mismatch");
  check(close(paired.mean, router.router.mean - refs.models.published_ensemble.mean) && Array.isArray(paired.ci95) &&
    paired.ci95.length === 2 && paired.ci95.every(finite) && paired.ci95[0] <= 0 && paired.ci95[1] >= 0,
    "paired evidence does not match the approved no-superiority claim");
  const counts = get("raw_count_reproduction.json"), inputs = get("raw_count_inputs.json"), post = get("postscreen_unpaired_audit.json");
  check(inputs.report_sha256 === contract.source_sha256["research/artifacts/raw_count_reproduction.json"], "count report provenance mismatch");
  check(inputs.files.every(item => sha(item.sha256) && Number.isInteger(item.bytes) && item.bytes > 0), "raw input hashes missing");
  check(inputs.files.some(item => item.sha256 === post.input_sha256), "post-screen count source not documented");
  check(counts.samples.every(sample => inputs.files.some(item => path.basename(item.path) === sample.fastq)), "counted sample lacks input provenance");
  check(post.validation_probability === null && post.task === "post_screen_wrapper_audit", "post-screen scores cannot imply calibrated validation");
  check(post.CHD1L.fdr >= .1 && post.qc.verdict === "fail", "known-case limitations require new scientific review before changing");
  return {contract, refs, router, counts, post};
}

export function validatePublished(root = ROOT) {
  const {contract, refs, router, counts, post} = validateInputs(root);
  const prefix = "apps/web/public/evidence/";
  check(hash(read(root, prefix + "summary.json")) === contract.public_summary_sha256, "unapproved public summary");
  check(hash(read(root, prefix + "manifest.json")) === contract.public_manifest_sha256, "unapproved public manifest");
  const summary = json(root, prefix + "summary.json"), manifest = json(root, prefix + "manifest.json");
  check(manifest.files_sha256 && Object.keys(manifest.files_sha256).length > 1, "empty public manifest");
  for (const [name, expected] of Object.entries(manifest.files_sha256)) {
    check(!name.includes("/") && !name.includes("\\") && sha(expected), "invalid download manifest entry");
    check(hash(read(root, prefix + name)) === expected, `changed download: ${name}`);
    if (name.endsWith(".md")) equal(read(root, `research/${name}`), read(root, prefix + name), `stale report: ${name}`);
  }
  const addendumSources = contract.research_addendum
    ? Object.values(contract.research_addendum.experiments).length : 0;
  const postSources = contract.post_screen ? 1 : 0;
  check(Object.keys(summary.sources_sha256).length === 4 + addendumSources + postSources,
    "unexpected/missing primary sources");
  const addendumPins = Object.fromEntries(Object.values(contract.research_addendum?.experiments ?? {})
    .map(pin => [pin.descriptor, pin.descriptor_sha256]));
  if (contract.post_screen) addendumPins[contract.post_screen.descriptor] = contract.post_screen.descriptor_sha256;
  for (const [name, expected] of Object.entries(summary.sources_sha256))
    check(contract.source_sha256[name] === expected || addendumPins[name] === expected,
      `unapproved summary source: ${name}`);
  equal(summary.references, Object.fromEntries(Object.entries(refs.models).map(([k,v]) => [k,{mean:v.mean,ci95:v.ci95}])), "published reference drift");
  equal(summary.router, {mean:router.router.mean,ci95:router.router.ci95,paired_vs_ensemble:router.paired_vs_external}, "published router drift");
  equal(summary.counts, counts, "published counts drift");
  equal(summary.postscreen.CHD1L, post.CHD1L, "published post-screen drift");
  check(summary.postscreen_qc === post.qc.verdict, "published QC drift");
  if (contract.post_screen) {
    const post = contract.post_screen;
    const d = json(root, post.descriptor);
    const shown = summary.post_screen_replication;
    check(shown, "approved post-screen claim missing from the published summary");
    equal(shown.cohort, d.cohort, "published post-screen cohort drift");
    for (const [key, want] of [["primary_model", d.primary_model], ["comparator", d.comparator],
                               ["promotion_status", d.promotion_status],
                               ["primary_mean", d.headline.primary_mean],
                               ["comparator_mean", d.headline.comparator_mean],
                               ["non_hub_paired_difference", d.headline.non_hub_paired_difference]]) {
      equal(shown[key], want, `published post-screen ${key} disagrees with its source artifact`);
    }
    equal(shown.paired_difference, d.headline.paired_difference, "published post-screen difference drift");
    equal(shown.precision_at_10, d.headline.precision_at_10, "published post-screen precision drift");
    check(shown.promotion_status === "research_only", "a published post-screen claim cannot be promoted");
    check(shown.paired_difference.ci95[0] > 0,
      "a published post-screen advantage must have an interval excluding zero");
  } else {
    check(!summary.post_screen_replication, "published post-screen claim without an approving contract");
  }
  if (contract.research_addendum) {
    const addendum = contract.research_addendum;
    check(summary.research_addendum, "approved research addendum is missing from the published summary");
    check(summary.research_addendum.measurement_date === addendum.measurement_date &&
      summary.research_addendum.split === addendum.split && summary.research_addendum.note === addendum.note,
      "published research addendum header drift");
    equal(Object.keys(summary.research_addendum.experiments).sort(), Object.keys(addendum.experiments).sort(),
      "published research addendum omits or adds an experiment");
    for (const [id, pin] of Object.entries(addendum.experiments)) {
      const descriptor = json(root, pin.descriptor);
      const source = json(root, descriptor.summary);
      const published = summary.research_addendum.experiments[id];
      equal(published, {
        title: pin.title, selected_model: pin.selected_model, split: descriptor.split,
        evaluation_kind: descriptor.evaluation_kind, input_contract: descriptor.input_contract,
        promotion_status: descriptor.promotion_status, mean: source.mean, ci95: source.ci95,
        n_screens: source.n_screens, n_publications: source.n_publications,
        comparison: pin.comparison, finding: pin.finding,
      }, `published research addendum disagrees with its source artifact: ${id}`);
    }
  } else {
    check(!summary.research_addendum, "published research addendum without an approving contract");
  }
  return {snapshot:contract.snapshot_id, status:"verified_existing_retrospective_snapshot"};
}

/** Validate a post-screen replication claim.
 *
 * Deliberately a separate function from validateExperiment. That one is built for
 * the pre-screen task: it requires task == "pre_screen_prediction", a metadata
 * input contract, and per-screen rows keyed by dataset_name/source_id. A
 * replication claim is a different task with a different unit (an ordered screen
 * pair), so it gets its own checks rather than a loosened version of those.
 */
export function validateReplicationExperiment(root, descriptorPath) {
  check(descriptorPath.startsWith("research/artifacts/"), "experiment must have research provenance");
  const descriptor = json(root, descriptorPath);
  check(descriptor.schema_version === 1 && typeof descriptor.experiment_id === "string" &&
    /^[a-zA-Z0-9_.-]+$/.test(descriptor.experiment_id), "invalid experiment identity");
  check(descriptor.task === "post_screen_replication", "this validator is for post-screen replication only");
  check(descriptor.input_contract === "screen_measurements_plus_permitted_background",
    "a replication claim reads the query screen and its permitted background, nothing else");
  check(descriptor.evaluation_kind === "heldout_replication", "unexpected evaluation kind");
  check(descriptor.promotion_status === "research_only", "registration never promotes a candidate");
  check(descriptor.calibration_status === "not_fitted" && descriptor.validation_probability === null,
    "cross-screen replication cannot imply a calibrated validation probability");
  check(descriptor.scored_once === true, "a held-out replication split is scored once");
  check(typeof descriptor.comparator === "string" && descriptor.comparator.length,
    "a replication claim must name what it beats");
  for (const [file, expected] of Object.entries(descriptor.artifacts)) {
    check(file.startsWith("research/artifacts/") && sha(expected), `invalid artifact provenance: ${file}`);
    check(hash(read(root, file)) === expected, `experiment artifact hash mismatch: ${file}`);
  }
  for (const key of ["results", "summary"]) check(descriptor.artifacts[descriptor[key]], `missing ${key} artifact`);
  const results = json(root, descriptor.results), summary = json(root, descriptor.summary);
  const cohort = descriptor.cohort;
  check(Number.isInteger(cohort.n_units) && cohort.n_units > 0 &&
    Number.isInteger(cohort.n_screen_pairs) && cohort.n_screen_pairs > 0 &&
    cohort.n_screen_pairs <= cohort.n_units, "invalid replication cohort");
  check(summary.n_screens === cohort.n_units, "summary cohort disagrees with the declared cohort");
  check(finite(summary.mean) && summary.mean >= 0 && summary.mean <= 1, "invalid summary mean");
  check(Array.isArray(summary.ci95) && summary.ci95.length === 2 && summary.ci95.every(finite) &&
    summary.ci95[0] <= summary.mean && summary.mean <= summary.ci95[1], "invalid summary interval");
  check(summary.unit === "publication", "dependence-aware uncertainty required");

  // The primary method's mean must recompute from the per-unit rows it cites.
  const rows = results.per_unit?.[descriptor.primary_model];
  check(rows && Object.keys(rows).length === cohort.n_units, "per-unit rows do not cover the cohort");
  const values = Object.values(rows).map(r => r[descriptor.primary_metric]);
  check(values.every(finite), "non-finite per-unit metric");
  check(close(values.reduce((a, b) => a + b, 0) / values.length, summary.mean),
    "summary mean disagrees with the per-unit rows");

  // Every stratum declared must partition the cohort, so a result cannot be
  // published for a favourable subset while the rest goes unreported.
  const strata = descriptor.strata || {};
  const parts = Object.keys(strata).filter(k => k !== "overall");
  check(parts.length >= 1, "a replication claim must declare its strata");
  const unitSum = parts.reduce((n, k) => n + results.results[k].n_units, 0);
  const pairSum = parts.reduce((n, k) => n + results.results[k].n_screen_pairs, 0);
  check(unitSum === cohort.n_units && pairSum === cohort.n_screen_pairs,
    "declared strata do not partition the cohort");
  check(results.results.overall.n_units === cohort.n_units, "overall stratum disagrees with the cohort");
  // Replication provenance is pinned to the benchmark artifact and its metric
  // implementation, not to the AssayBench parquet, so it gets its own checks
  // rather than a self-referential reuse of the pre-screen ones.
  const prov = descriptor.provenance || {};
  for (const key of ["benchmark_artifact_sha256", "metric_code_sha256", "model_code_sha256",
                     "selection_sha256", "runner_sha256"]) {
    check(sha(prov[key]), `${descriptor.experiment_id}: ${key} missing`);
  }
  check(prov.benchmark_artifact_sha256 === cohort.benchmark_artifact_sha256,
    "benchmark artifact provenance mismatch");
  check(hash(read(root, "engine/splicr/replication/_pairs_v1.json")) === cohort.benchmark_artifact_sha256,
    "the shipped benchmark artifact does not match the cohort it was scored on");
  check(hash(read(root, "engine/splicr/replication/dataset.py")) === prov.metric_code_sha256,
    "the metric implementation changed since the claim was made");
  check(typeof prov.git_revision === "string" && /^[a-f0-9]{40}$/.test(prov.git_revision),
    "code revision missing");
  check(prov.heldout_labels_read_by_selection === false,
    "the model must have been selected without reading a held-out label");
  return {schema_version: 1, experiment_id: descriptor.experiment_id, descriptor: descriptorPath,
    descriptor_sha256: hash(read(root, descriptorPath)), status: "registered_research_only",
    task: "post_screen_replication",
    independent_scientific_verification: "not_established_by_this_software_check",
    public_evidence_changed: false};
}

/** Register research without promoting a model or modifying public evidence. */
export function validateExperiment(root, descriptorPath) {
  check(descriptorPath.startsWith("research/artifacts/"), "experiment must have research provenance");
  const descriptor = json(root, descriptorPath);
  check(descriptor.schema_version === 1 && typeof descriptor.experiment_id === "string" &&
    /^[a-zA-Z0-9_.-]+$/.test(descriptor.experiment_id), "invalid experiment identity");
  check(descriptor.promotion_status === "research_only", "registration never promotes a candidate");
  check(["retrospective_public_test", "retrospective_grouped_holdout", "validation_selection"].includes(descriptor.evaluation_kind),
    "prospective claims need independently verified blinded evidence, not registration");
  check(descriptor.task === "pre_screen_prediction" &&
    ["metadata_only", "metadata_plus_measured_universe"].includes(descriptor.input_contract),
    "pre-screen registration requires metadata inputs; observed target counts belong to a separate evaluation");
  check(descriptor.calibration_status === "not_fitted" && descriptor.validation_probability === null, "unsupported validation probability");
  check(descriptor.artifacts && Object.keys(descriptor.artifacts).length > 0, "missing experiment artifacts");
  for (const [file, expected] of Object.entries(descriptor.artifacts)) {
    check(file.startsWith("research/artifacts/") && sha(expected), "invalid experiment artifact provenance");
    check(hash(read(root,file)) === expected, `experiment artifact hash mismatch: ${file}`);
  }
  for (const key of ["screen_results", "predictions", "summary"]) check(descriptor.artifacts[descriptor[key]], `missing ${key} artifact`);
  const summary = json(root, descriptor.summary), rows = json(root, descriptor.screen_results);
  metric(summary, descriptor.cohort, descriptor.experiment_id);
  const ids = screenSet(rows, descriptor.cohort, descriptor.experiment_id);
  equal(Object.keys(json(root,descriptor.predictions)).sort(),ids,"registered predictions omit cohort members");
  check(close(rows.reduce((sum,row)=>sum+row["adjusted_ndcg@100"],0)/rows.length,summary.mean),"registered summary differs from screens");
  provenance(descriptor.provenance, descriptor.cohort, descriptor.experiment_id);
  return {schema_version:1, experiment_id:descriptor.experiment_id, descriptor:descriptorPath,
    descriptor_sha256:hash(read(root, descriptorPath)), status:"registered_research_only",
    independent_scientific_verification:"not_established_by_this_software_check", public_evidence_changed:false};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--validate-experiment" && args.length === 2) console.log(JSON.stringify(validateExperiment(ROOT,args[1])));
    else if (args[0] === "--validate-replication" && args.length === 2) console.log(JSON.stringify(validateReplicationExperiment(ROOT,args[1])));
    else if (args.length === 1 && args[0] === "--validate-inputs") { validateInputs(); console.log("Evidence input contract verified."); }
    else if (args.length === 0 || (args.length === 1 && args[0] === "--check-public")) console.log(JSON.stringify(validatePublished()));
    else throw new Error("Usage: evidence_gate.mjs [--validate-inputs | --check-public | "
      + "--validate-experiment PATH | --validate-replication PATH]");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
