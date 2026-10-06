/** Real Postgres tests, rolled back. --preview tests the migration before applying. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, repoRoot } from "../db/client.mjs";
import { loadTs } from "../../apps/web/tests/helpers/load-ts.mjs";

const { canonicalJson, sha256 } = loadTs("lib/discovery/receipt.ts");
const { blankDocument, buildWorklist, selectBatch } = loadTs("lib/discovery/model.ts");
const { discoveryDocumentSchema, batchDesignSchema } = loadTs("lib/discovery/schema.ts");
const { allEndpoints } = loadTs("lib/validation/endpoint.ts");
const registry = JSON.parse(readFileSync(`${repoRoot}/apps/web/src/lib/validation/endpoints.generated.json`, "utf8"));
const matrix = JSON.parse(readFileSync(`${repoRoot}/apps/web/tests/fixtures/endpoint-decisions.json`, "utf8"));
const db = await connect();
let checks = 0;
async function denied(sql, values, pattern = /permission|policy|scope|match|current|immutable|duplicate|endpoint|modality|requires|required/i) {
  await db.query("savepoint refusal");
  let error;
  try { await db.query(sql, values); } catch (e) { error = e; }
  await db.query("rollback to savepoint refusal");
  assert.ok(error, `Expected denial: ${sql.slice(0, 70)}`);
  assert.match(error.message, pattern); checks++;
}
try {
  await db.query("begin");
  if (process.argv.includes("--preview")) {
    const exists = (await db.query("select to_regclass('public.discovery_inputs') as relation")).rows[0].relation;
    if (!exists) await db.query(readFileSync(`${repoRoot}/supabase/migrations/20261006000100_discovery_worklists.sql`, "utf8"));
    const hardened = (await db.query("select to_regprocedure('private.discovery_stamp_and_endpoint()') as function")).rows[0].function;
    if (!hardened) await db.query(readFileSync(`${repoRoot}/supabase/migrations/20261006000200_discovery_registry_integrity.sql`, "utf8"));
    const consistent = (await db.query("select to_regprocedure('private.discovery_outcome_immutable()') as function")).rows[0].function;
    if (!consistent) await db.query(readFileSync(`${repoRoot}/supabase/migrations/20261006000300_discovery_outcome_consistency.sql`, "utf8"));
    const projection = (await db.query("select to_regprocedure('private.discovery_projection_integrity()') as function")).rows[0].function;
    if (!projection) await db.query(readFileSync(`${repoRoot}/supabase/migrations/20261006000400_discovery_projection_integrity.sql`, "utf8"));
  }
  const actorRow = await db.query("select m.user_id from public.org_members m join public.organizations o on o.id=m.org_id where o.name='SplicR E2E Fixture Lab' limit 1");
  assert.equal(actorRow.rows.length, 1, "Seed the disposable E2E researcher first.");
  const actor = actorRow.rows[0].user_id;
  const org = randomUUID(), outsider = randomUUID(), viewerOrg = randomUUID(), screen = randomUUID(), run = randomUUID(), comparison = randomUUID(), otherComparison = randomUUID(), inputId = randomUUID(), batchId = randomUUID();
  for (const id of [org, outsider, viewerOrg]) await db.query("insert into public.organizations(id,name,slug) values($1,'Discovery database fixture',$2)", [id, `discovery-test-${id}`]);
  await db.query("insert into public.org_members(org_id,user_id,role) values($1,$2,'owner'),($3,$2,'viewer')", [org, actor, viewerOrg]);
  await db.query("insert into public.screens(id,org_id,name,status,cell_line) values($1,$2,'Synthetic discovery fixture','complete','HeLa')", [screen, org]);
  await db.query("insert into public.runs(id,screen_id,org_id,status) values($1,$2,$3,'complete')", [run, screen, org]);
  await db.query("update public.screens set current_run_id=$1 where id=$2", [run, screen]);
  await db.query("insert into public.comparisons(id,screen_id,name,kind,treatment_ids,control_ids) values($1,$3,'Baseline','dropout','{}','{}'),($2,$3,'Other','dropout','{}','{}')", [comparison, otherComparison, screen]);
  const evidence = discoveryDocumentSchema.parse(blankDocument({ model_id: "HeLa", biological_unit: "synthetic-patient", lineage: null, subtype: null, culture: "cell_line", medium: null, matrix: null, library: null, modality: "knockout", endpoint: null, time_hours: null, effect_metric: "log2_fold_change" }));
  const experiments = buildWorklist([{ gene: "FIXTURE", lfc: -1.5, fdr: 0.01, guide_lfcs: [-1, -2], flags: [] }], evidence);
  const endpoint = allEndpoints().find((e) => e.validation_types.includes("independent_guide"));
  const design = batchDesignSchema.parse({ name: "Fixture round", budget: 1, default_cost: 1, cost_unit: "assays", endpoint_key: endpoint.key, laboratory_threshold: 0.5 });
  const plan = selectBatch(experiments, design);
  const receipt = { screen_id: screen, run_id: run, comparison_id: comparison, input_id: inputId, input_sha256: sha256(evidence), evidence, endpoint, plan, blind_ids: { [experiments[0].id]: randomUUID() } };
  const inputSql = "insert into public.discovery_inputs(id,org_id,screen_id,run_id,comparison_id,document,canonical_document,document_sha256,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9)";
  const inputValues = [inputId, org, screen, run, comparison, evidence, canonicalJson(evidence), sha256(evidence), actor];
  const batchSql = "insert into public.discovery_batches(id,org_id,input_id,screen_id,run_id,comparison_id,name,receipt,canonical_receipt,receipt_sha256,frozen_by) values($1,$2,$3,$4,$5,$6,'Fixture round',$7,$8,$9,$10)";
  const batchValues = [batchId, org, inputId, screen, run, comparison, receipt, canonicalJson(receipt), sha256(receipt), actor];
  const alternateScopes = {};
  for (const alternate of [outsider, viewerOrg]) {
    const sid=randomUUID(), rid=randomUUID(), cid=randomUUID(), iid=randomUUID();
    await db.query("insert into public.screens(id,org_id,name,status,cell_line) values($1,$2,'Synthetic alternate scope','complete','HeLa')", [sid,alternate]);
    await db.query("insert into public.runs(id,screen_id,org_id,status) values($1,$2,$3,'complete')", [rid,sid,alternate]);
    await db.query("update public.screens set current_run_id=$1 where id=$2", [rid,sid]);
    await db.query("insert into public.comparisons(id,screen_id,name,kind,treatment_ids,control_ids) values($1,$2,'Baseline','dropout','{}','{}')", [cid,sid]);
    const values=[iid,alternate,sid,rid,cid,evidence,canonicalJson(evidence),sha256(evidence),actor];
    await db.query(inputSql,values); alternateScopes[alternate]=values;
  }

  // The database verdict must agree with the Python oracle on every fixture case.
  const rows = matrix.cases.map((c, i) => ({ i, ep: registry.endpoints[c.endpoint], measurement: c.measurement, bar: c.laboratory_threshold, expected: c.expect.decision }));
  const decisions = await db.query("select x.i, public.discovery_endpoint_verdict(x.ep,x.measurement,x.bar) as verdict from jsonb_to_recordset($1::jsonb) as x(i int,ep jsonb,measurement jsonb,bar double precision)", [JSON.stringify(rows)]);
  for (const r of decisions.rows) assert.equal(r.verdict, rows[r.i].expected, `Engine/database endpoint divergence, case ${r.i}`);
  checks += rows.length;

  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: "authenticated" })]);
  await db.query("set local role authenticated");
  await db.query(inputSql, inputValues); checks++;
  await denied(inputSql, [randomUUID(), outsider, ...inputValues.slice(2)]);
  await denied(inputSql, [randomUUID(), ...inputValues.slice(1, 7), "0".repeat(64), actor], /check constraint/);
  await db.query(batchSql, batchValues); checks++;
  await denied(batchSql, [randomUUID(), ...batchValues.slice(1, 5), otherComparison, ...batchValues.slice(6)]);
  assert.equal((await db.query("select count(*)::int as n from public.discovery_inputs where org_id=$1", [outsider])).rows[0].n, 0); checks++;
  assert.equal((await db.query("select count(*)::int as n from public.discovery_inputs where org_id=$1", [viewerOrg])).rows[0].n, 1); checks++;
  await denied(inputSql,[randomUUID(),...alternateScopes[viewerOrg].slice(1)]);
  await denied("update public.discovery_inputs set document=document where id=$1", [inputId]);
  await denied("delete from public.discovery_batches where id=$1", [batchId]);
  await denied("select public.record_discovery_result($1,$2,$3,'validated','forged',$4,'small_molecule')", [batchId, experiments[0].id, {}, endpoint.key]);
  const measurement = { result: "validated", model_id: "HeLa", lab_id: "fixture-lab", actual_cost: 1, effect_size: -1.5, n_replicates: 3, n_perturbations: 3, independent_perturbation: true, distinct_from_screen_constructs: true, controls: Object.fromEntries(endpoint.control_criteria.map((c) => [c, true])), notes: "Synthetic outcome", evidence_url: null };
  await denied("select public.record_discovery_result($1,$2,$3,'failed','forged',$4,'independent_guide')", [batchId, experiments[0].id, measurement, endpoint.key]);
  await denied("select public.record_discovery_result($1,$2,$3,'validated','forged',$4,'independent_guide')", [batchId, experiments[0].id, { ...measurement, model_id: "wrong" }, endpoint.key]);
  assert.equal((await db.query("select count(*)::int as n from public.validation_outcomes where org_id=$1", [org])).rows[0].n, 0, "Rejected result left a Truth Loop orphan"); checks++;
  await db.query("select public.record_discovery_result($1,$2,$3,'validated','Every criterion met',$4,'independent_guide')", [batchId, experiments[0].id, measurement, endpoint.key]); checks++;
  assert.equal((await db.query("select count(*)::int as n from public.discovery_results r join public.validation_outcomes o on o.id=r.outcome_id where r.org_id=$1 and o.endpoint_decision='validated' and o.laboratory_threshold=0.5", [org])).rows[0].n, 1); checks++;
  await denied("select public.record_discovery_result($1,$2,$3,'validated','duplicate',$4,'independent_guide')", [batchId, experiments[0].id, measurement, endpoint.key]);
  await denied("update public.discovery_results set decision='failed' where batch_id=$1", [batchId]);
  await denied("update public.validation_outcomes set result='failed' where org_id=$1", [org]);
  const forgedOutcome = randomUUID();
  await db.query("insert into public.validation_outcomes(id,org_id,screen_id,gene_symbol,result,validation_type,measurement,logged_by) values($1,$2,$3,'FIXTURE','validated','independent_guide',$4,$5)",[forgedOutcome,org,screen,measurement,actor]);
  await denied("insert into public.discovery_results(org_id,batch_id,experiment_id,measurement,decision,because,outcome_id,logged_by) values($1,$2,$3,$4,'validated','forged projection',$5,$6)",[org,batchId,experiments[0].id,measurement,forgedOutcome,actor], /projection/);
  await db.query("reset role");
  await denied("update public.discovery_batches set name='changed' where id=$1", [batchId]);
  await db.query("update public.screens set current_run_id=null where id=$1", [screen]);
  await denied(inputSql, [randomUUID(), ...inputValues.slice(1)]);
  await db.query("set local role anon");
  for (const table of ["discovery_inputs", "discovery_batches", "discovery_results"]) await denied(`select * from public.${table}`, []);
  await denied("select public.record_discovery_result($1,$2,$3,'validated','anon',$4,'independent_guide')", [batchId, experiments[0].id, measurement, endpoint.key]);
  await db.query("reset role");
  await db.query("savepoint parent_deletion");
  await db.query("delete from public.screens where id=$1", [screen]);
  await db.query("set constraints all immediate");
  assert.equal((await db.query("select count(*)::int as n from public.discovery_results where batch_id=$1",[batchId])).rows[0].n,0); checks++;
  await db.query("rollback to savepoint parent_deletion");
  console.log(`PASS: ${checks} database checks, including ${rows.length} Python-oracle decisions, RLS, provenance, stale runs, immutability, atomic Truth Loop recording and anonymous denial. All fixture writes rolled back.`);
} finally {
  await db.query("rollback");
  await db.end();
}
