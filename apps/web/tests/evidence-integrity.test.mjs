/** Tampered fixtures test software gates only; never biological performance. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import test from "node:test";
import {ROOT, read, validateInputs, validatePublished, validateExperiment} from "../../../scripts/research/evidence_gate.mjs";

const sha = raw => createHash("sha256").update(raw).digest("hex");
const load = (root,file) => JSON.parse(fs.readFileSync(path.join(root,file)));
const save = (root,file,value) => fs.writeFileSync(path.join(root,file),JSON.stringify(value));
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"splicr-evidence-software-fixture-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const contract=load(ROOT,"research/evidence_contract.json");
  const files=["research/evidence_contract.json",...Object.keys(contract.source_sha256)];
  for(const pin of Object.values(contract.research_addendum?.experiments ?? {})) {
    files.push(pin.descriptor);
    for(const artifact of Object.keys(load(ROOT,pin.descriptor).artifacts)) files.push(artifact);
  }
  if(contract.post_screen) {
    files.push(contract.post_screen.descriptor);
    for(const artifact of Object.keys(load(ROOT,contract.post_screen.descriptor).artifacts)) files.push(artifact);
    files.push("engine/splicr/replication/_pairs_v1.json","engine/splicr/replication/dataset.py");
  }
  const manifest=load(ROOT,"apps/web/public/evidence/manifest.json");
  files.push("apps/web/public/evidence/manifest.json");
  for(const name of Object.keys(manifest.files_sha256)) {
    files.push(`apps/web/public/evidence/${name}`);
    if(name.endsWith(".md"))files.push(`research/${name}`);
  }
  for(const file of files) {fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(ROOT,file),path.join(root,file));}
  return root;
}
function mutateContract(root,fn) {const file="research/evidence_contract.json",value=load(root,file);fn(value);save(root,file,value);}
function mutateArtifact(root,name,fn) {
  const file=`research/artifacts/${name}`,value=load(root,file);fn(value);save(root,file,value);
  // Repin deliberately to verify semantic gates independently of checksum gates.
  mutateContract(root,c=>c.source_sha256[file]=sha(fs.readFileSync(path.join(root,file))));
}

test("current approved evidence passes using Node alone",()=>{
  assert.equal(validatePublished().status,"verified_existing_retrospective_snapshot");
  assert.match(load(ROOT,"apps/web/package.json").scripts.build,/^node .*evidence_gate.*&& next build$/);
  execFileSync(process.execPath,["scripts/research/evidence_gate.mjs","--check-public"],{cwd:ROOT});
});
for(const [label,mutation,pattern] of [
  ["candidate promotion",c=>c.model_promotion_status="production",/promotion/],
  ["retrospective relabeled prospective",c=>c.evaluation_kind="prospective_blinded",/retrospective/],
  ["claimed calibrated confidence",c=>c.independent_validation_probability=.97,/calibrated/],
  ["unsupported superiority",c=>c.claims.superiority_over_ensemble=true,/unsupported performance/],
  ["merged input contracts",c=>c.input_contracts.legacy_prior="metadata_only_training_union_candidates",/input contracts/],
])test(`reject ${label}`,t=>{const root=fixture(t);mutateContract(root,mutation);assert.throws(()=>validateInputs(root),pattern);});

test("changed source fails without approved checksum",t=>{
  const root=fixture(t);fs.appendFileSync(path.join(root,"research/artifacts/router_replay_summary.json")," ");
  assert.throws(()=>validateInputs(root),/source hash mismatch/);
});
test("missing screen fails even when checksum is repinned",t=>{
  const root=fixture(t);mutateArtifact(root,"router_replay_screens.json",rows=>rows.pop());
  assert.throws(()=>validateInputs(root),/missing cohort screens/);
});
test("duplicate screen fails even when checksum is repinned",t=>{
  const root=fixture(t);mutateArtifact(root,"router_replay_screens.json",rows=>rows[1].dataset_name=rows[0].dataset_name);
  assert.throws(()=>validateInputs(root),/duplicate/);
});
test("missing predictions fail even when checksum is repinned",t=>{
  const root=fixture(t);mutateArtifact(root,"router_replay_predictions.json",rows=>delete rows[Object.keys(rows)[0]]);
  assert.throws(()=>validateInputs(root),/predictions omit/);
});
test("evaluator provenance is mandatory",t=>{
  const root=fixture(t);mutateArtifact(root,"router_replay_summary.json",r=>delete r.provenance.metric_sha256);
  assert.throws(()=>validateInputs(root),/metric_sha256 missing/);
});
test("omitted phenotype cannot disappear from reporting",t=>{
  const root=fixture(t);mutateArtifact(root,"router_replay_summary.json",r=>delete r.router.subgroups.phenotype[Object.keys(r.router.subgroups.phenotype)[0]]);
  assert.throws(()=>validateInputs(root),/missing subgroup coverage/);
});
test("post-screen score cannot become validation probability",t=>{
  const root=fixture(t);mutateArtifact(root,"postscreen_unpaired_audit.json",r=>r.validation_probability=.8);
  assert.throws(()=>validateInputs(root),/calibrated validation/);
});
test("changed public data is rejected even with a rewritten public manifest",t=>{
  const root=fixture(t),file="apps/web/public/evidence/summary.json",s=load(root,file);s.router.mean=.99;save(root,file,s);
  const m=load(root,"apps/web/public/evidence/manifest.json");m.files_sha256["summary.json"]=sha(fs.readFileSync(path.join(root,file)));
  save(root,"apps/web/public/evidence/manifest.json",m);
  assert.throws(()=>validatePublished(root),/unapproved public summary/);
});
test("path traversal and symlinks cannot read outside evidence workspace",t=>{
  const root=fixture(t);assert.throws(()=>read(root,"../outside.json"),/unsafe artifact/);
  fs.symlinkSync(path.join(ROOT,"package.json"),path.join(root,"escape.json"));
  assert.throws(()=>read(root,"escape.json"),/leaves repository/);
});

function researchDescriptor(root) {
  const contract=load(root,"research/evidence_contract.json");
  const router=load(root,"research/artifacts/router_replay_summary.json");
  const summary="research/artifacts/software_fixture_summary.json";
  save(root,summary,router.router);
  const descriptor={schema_version:1,experiment_id:"software-only-fixture",promotion_status:"research_only",
    task:"pre_screen_prediction",
    evaluation_kind:"retrospective_public_test",input_contract:"metadata_only",calibration_status:"not_fitted",
    validation_probability:null,cohort:contract.cohort,provenance:router.provenance,summary,
    predictions:"research/artifacts/router_replay_predictions.json",screen_results:"research/artifacts/router_replay_screens.json"};
  descriptor.artifacts=Object.fromEntries([descriptor.summary,descriptor.predictions,descriptor.screen_results].map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
  const file="research/artifacts/software_only_descriptor.json";save(root,file,descriptor);return file;
}
test("generic research registration never changes or promotes public results",t=>{
  const root=fixture(t),file=researchDescriptor(root);
  const before=sha(fs.readFileSync(path.join(root,"apps/web/public/evidence/summary.json")));
  const receipt=validateExperiment(root,file);
  assert.equal(receipt.status,"registered_research_only");assert.equal(receipt.public_evidence_changed,false);
  assert.equal(before,sha(fs.readFileSync(path.join(root,"apps/web/public/evidence/summary.json"))));
});
test("registration cannot claim prospective evaluation or production promotion",t=>{
  const root=fixture(t),file=researchDescriptor(root),d=load(root,file);
  d.evaluation_kind="prospective_blinded";save(root,file,d);
  assert.throws(()=>validateExperiment(root,file),/prospective claims/);
  d.evaluation_kind="retrospective_public_test";d.promotion_status="production";save(root,file,d);
  assert.throws(()=>validateExperiment(root,file),/never promotes/);
});
test("observed target counts cannot enter the pre-screen registration track",t=>{
  const root=fixture(t),file=researchDescriptor(root),d=load(root,file);
  d.input_contract="observed_counts";save(root,file,d);
  assert.throws(()=>validateExperiment(root,file),/observed target counts/);
});
