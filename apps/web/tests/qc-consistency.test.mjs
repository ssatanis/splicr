/**
 * One screen, one QC verdict.
 *
 * The GSE145743 workspace shipped a header reading "QC pending" directly above
 * stage evidence reading "qc done, fail, NNMD -2.63". That is not a cosmetic
 * disagreement: it tells a reader that a screen which failed its
 * null-normalised mean difference has not been checked yet, and the eleven
 * genes under it were read in that light.
 *
 * screens.qc is a rollup of the current run's run_qc.verdict. It used to be
 * written by the engine at the end of a run, so any run finished before that
 * rollup existed - or whose QC row arrived after it - left the screen at the
 * 'pending' default forever. The rollup is now the database's: a trigger on
 * run_qc writes the verdict onto whichever screen points at that run, and a
 * trigger on screens pulls it whenever current_run_id moves.
 *
 * The first test is the structural guard and runs everywhere. The second is the
 * invariant itself and runs wherever SUPABASE_DB_URL is set, which is CI and a
 * developer with the engine environment; it is skipped, loudly, otherwise,
 * because a silently-skipped invariant is worse than no invariant.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const migrations = path.join(root, "supabase/migrations");

function migrationText() {
  return fs.readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => fs.readFileSync(path.join(migrations, name), "utf8"))
    .join("\n");
}

test("the rollup is the database's job, in both directions", () => {
  const sql = migrationText();
  // run_qc arriving, or changing, reaches the screen pointing at that run.
  assert.match(sql, /create trigger run_qc_rolls_up_to_screen/);
  assert.match(sql, /after insert or update of verdict on public\.run_qc/);
  // And a screen moving to a different run takes that run's verdict with it,
  // rather than keeping the previous run's.
  assert.match(sql, /create trigger screen_qc_follows_current_run/);
  assert.match(sql, /before insert or update of current_run_id on public\.screens/);
  // The rows written before either trigger existed are repaired, not left.
  assert.match(sql, /update public\.screens s\s+set qc = coalesce\(q\.verdict/);
});

test("a screen with no current run reports pending rather than a stale verdict", () => {
  const sql = migrationText();
  const at = sql.indexOf("function private.pull_screen_qc_from_run");
  assert.ok(at > 0);
  const body = sql.slice(at, sql.indexOf("$$;", at));
  assert.match(body, /if new\.current_run_id is null then\s+new\.qc := 'pending';/);
  // A run that has not recorded QC yet is also pending, not the last verdict.
  assert.match(body, /coalesce\(\s*\(select q\.verdict from public\.run_qc q where q\.run_id = new\.current_run_id\),\s*'pending'/);
});

test("no screen in the database reports a QC verdict its run did not record", async (t) => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    t.skip("SUPABASE_DB_URL is not set, so the invariant was not checked against a database");
    return;
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select s.id, s.name, s.qc::text as screen_qc,
             coalesce(q.verdict::text, 'pending') as run_qc
        from public.screens s
        left join public.runs r on r.id = s.current_run_id
        left join public.run_qc q on q.run_id = r.id
       where s.qc::text is distinct from coalesce(q.verdict::text, 'pending')
    `);
    assert.deepEqual(rows, [],
      "these screens would show a QC verdict their current run did not record");
  } finally {
    await client.end();
  }
});
