/** Real authenticated queries, rolled back; no fixture or production row is changed. */
import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "../../../scripts/db/client.mjs";
const namespace = process.env.SPLICR_E2E_NAMESPACE;
test(
  "guide matching keeps workspace libraries private and supports sequence aliases",
  { skip: !namespace },
  async () => {
    const c = await connect();
    try {
      const row = (
        await c.query("select id from auth.users where email=$1", [
          `splicr-e2e-${namespace}@splicr.invalid`,
        ])
      ).rows[0];
      assert.ok(row);
      const publicLibrary = (
        await c.query(
          "select id from atlas.libraries where slug='brunello' and org_id is null",
        )
      ).rows[0];
      const guide = (
        await c.query(
          "select guide_key from atlas.guides where library_id=$1 and sequence='CATCTTCTTTCACCTGAACG'",
          [publicLibrary.id],
        )
      ).rows[0];
      const privateLibrary = (
        await c.query(
          "select l.id from atlas.libraries l where org_id is not null and not exists(select 1 from public.org_members m where m.org_id=l.org_id and m.user_id=$1) and n_guides>0 limit 1",
          [row.id],
        )
      ).rows[0];
      const foreignGuide = privateLibrary
        ? (
            await c.query(
              "select guide_key,sequence from atlas.guides where library_id=$1 limit 1",
              [privateLibrary.id],
            )
          ).rows[0]
        : null;
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [row.id]);
      await c.query("set local statement_timeout='8s'");
      const fingerprint = (
        await c.query("select library_id from public.detect_guide_libraries($1)", [
          [guide.guide_key],
        ])
      ).rows;
      assert.ok(fingerprint.some((r) => r.library_id === publicLibrary.id));
      const matched = (
        await c.query("select public.inspect_library_guides($1,$2,$3) result", [
          publicLibrary.id,
          ["fixture-id"],
          ["CATCTTCTTTCACCTGAACG"],
        ])
      ).rows[0].result;
      assert.equal(matched.matched, 1);
      assert.equal(matched.aliases[0].source, "fixture-id");
      assert.ok(matched.aliases[0].target);
      if (privateLibrary && foreignGuide) {
        const hidden = (
          await c.query("select public.inspect_library_guides($1,$2,$3) result", [
            privateLibrary.id,
            [foreignGuide.guide_key],
            [foreignGuide.sequence],
          ])
        ).rows[0].result;
        assert.equal(hidden.matched, 0);
        assert.equal(hidden.aliases.length, 0);
        const reads = (
          await c.query("select library_id from public.detect_read_libraries($1)", [
            [foreignGuide.sequence],
          ])
        ).rows;
        assert.ok(reads.every((r) => r.library_id !== privateLibrary.id));
      }
      const reads = (
        await c.query("select name,match_rate from public.detect_read_libraries($1)", [
          ["TACGATTGCCCATCTTCTTTCACCTGAACGGATTACA"],
        ])
      ).rows;
      assert.ok(reads.some((r) => r.name === "Brunello" && Number(r.match_rate) === 1));
    } finally {
      await c.query("rollback");
      await c.end();
    }
  },
);

test('queued comparison screens inherit the edited date and colleague while retaining the submitter', {skip:!namespace}, async()=>{
 const c=await connect();
 try{
  const user=(await c.query('select id from auth.users where email=$1',[`splicr-e2e-${namespace}@splicr.invalid`])).rows[0];assert.ok(user);
  await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user.id]);
  const parent=(await c.query("select * from screens where created_by=$1 and name like 'Draft configuration fixture %' and status='draft' and archived_at is null order by created_at desc limit 1",[user.id])).rows[0];assert.ok(parent);
  const file=(await c.query("select id from screen_files where screen_id=$1 and kind='counts' and status='complete' order by created_at limit 1",[parent.id])).rows[0];assert.ok(file);
  const plans=[{name:'Fixture contrast',screen_name:parent.name,model:'Fixture model',phenotype:'Fixture phenotype',source:{fileId:file.id,sheet:'Table'},control:['T0'],treatment:['treated'],samples:[{label:'T0',role:'reference',replicate:1},{label:'treated',role:'treatment',replicate:3}],settings:{normalization:'median',hit_callers:['mageck_rra'],fdr_threshold:.1,review_confirmed:true,profile:'pooled_abundance'}}];
  const queued=(await c.query('select public.start_experiment_analysis($1,$2::jsonb,$3) result',[parent.id,JSON.stringify(plans),parent.intake_config.libraryId])).rows[0].result;
  assert.equal(queued.length,1);
  const child=(await c.query('select name,created_by,researcher_id,researcher_name,experiment_date,intake_config from screens where id=$1',[queued[0].screenId])).rows[0];
  assert.equal(child.name,parent.name);assert.equal(child.created_by,user.id);assert.equal(child.researcher_id,parent.researcher_id);assert.equal(child.researcher_name,'E2E Colleague');assert.equal(child.experiment_date.toISOString(),parent.experiment_date.toISOString());assert.equal(child.intake_config.libraryLabel,'Lab library 2025');
  assert.equal((await c.query('select count(*) from jobs where run_id=$1',[queued[0].runId])).rows[0].count,'1');
 }finally{await c.query('rollback');await c.end();}
});
