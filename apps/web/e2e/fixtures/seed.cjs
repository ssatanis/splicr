/**
 * A disposable researcher, a disposable workspace, and one screen to drive.
 *
 * WHY A FIXTURE AND NOT THE REAL WORKSPACE
 *
 * The suite records candidate decisions, and the decision log is append-only
 * by design. Running it against the canonical review workspace would leave a
 * trail of test decisions in a record whose whole purpose is to be the
 * truthful history of what a researcher chose. So the tests own their data:
 * one organization, one member, one screen, torn down afterwards.
 *
 * EVERY ROW IS MARKED AS A FIXTURE
 *
 * The organization slug, the screen name and the run's engine version all say
 * so, and the screen's metadata carries `fixture: true`. These numbers are
 * synthetic. They must never reach the Atlas, a benchmark, a calibration or any
 * aggregate claim, and the marking is what lets anything downstream exclude
 * them.
 *
 * The statistics are shaped like a real screen - a null-centred cloud with
 * eleven genes carrying the signal - because the point is to exercise the
 * volcano at genome scale and the candidate rule at its threshold, not to
 * assert anything biological.
 */
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createClient } = require("@supabase/supabase-js");
const pg = require("pg");

//  Resolved from this file so the seed runs the same from `node` and from
//  Playwright, which transpiles the suite to CommonJS.
const ROOT = path.resolve(__dirname, "../../../..");

const FIXTURE = {
  email: "splicr-e2e@splicr.invalid",
  orgSlug: "splicr-e2e-fixture",
  orgName: "SplicR E2E Fixture Lab",
  screenName: "E2E fixture screen (synthetic, not a real experiment)",
  engineVersion: "e2e-fixture",
  genes: 20_000,
  significant: 11,
};

function env() {
  const read = (file) => {
    const at = path.join(ROOT, file);
    if (!fs.existsSync(at)) return {};
    return Object.fromEntries(
      fs.readFileSync(at, "utf8").split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
        }),
    );
  };
  const merged = { ...read(".env"), ...read("apps/web/.env.local"), ...process.env };
  for (const key of ["SUPABASE_DB_URL", "SUPABASE_SECRET_KEY"]) {
    if (!merged[key]) {
      throw new Error(
        `${key} is not set. The end-to-end suite mints its own session and cannot run without it; `
        + "it fails here rather than silently testing a signed-out console.",
      );
    }
  }
  merged.SUPABASE_URL ||= merged.NEXT_PUBLIC_SUPABASE_URL;
  return merged;
}

async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

/**
 * The disposable auth user, created if absent.
 *
 * It goes on the access allowlist first, because the database refuses to
 * create a user who is not on it. That is the invite-only boundary working, and
 * the fixture goes through it rather than around it: a test setup that could
 * bypass the thing the product most needs to enforce would be testing a
 * different product.
 */
async function ensureUser(config, db) {
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const existing = await admin.auth.admin.listUsers({ perPage: 200 });
  if (existing.error) throw existing.error;
  const found = existing.data.users.find((user) => user.email === FIXTURE.email);
  if (found) return { id: found.id, admin };

  await db.query(
    `insert into public.splicr_access_allowlist (email, create_workspace, workspace_name, role, status, expires_at)
     values ($1, true, $2, 'owner', 'pending', now() + interval '1 day')
     on conflict ((lower(email))) do update set
       create_workspace = true, workspace_name = excluded.workspace_name,
       org_id = null, role = 'owner', status = 'pending', consumed_at = null,
       expires_at = excluded.expires_at`,
    [FIXTURE.email, FIXTURE.orgName],
  );

  const created = await admin.auth.admin.createUser({
    email: FIXTURE.email,
    email_confirm: true,
    user_metadata: { full_name: "E2E Researcher", fixture: true },
  });
  if (created.error) throw created.error;
  return { id: created.data.user.id, admin };
}

/**
 * The workspace and its screen. Idempotent: running it twice leaves one of
 * everything, so a failed run does not need manual cleaning before the next.
 */
async function seed() {
  const config = env();
  const db = await connect(config.SUPABASE_DB_URL);
  const { id: userId, admin } = await ensureUser(config, db);
  try {
    await db.query("begin");

    // The bootstrap trigger created the workspace when the user was created.
    // Read it back rather than making a second one.
    const owned = await db.query(
      `select o.id, o.slug from public.organizations o
         join public.org_members m on m.org_id = o.id
        where m.user_id = $1 order by o.created_at limit 1`,
      [userId],
    );
    if (owned.rowCount === 0) {
      throw new Error("the access bootstrap created no workspace for the fixture researcher");
    }
    const orgId = owned.rows[0].id;
    FIXTURE.orgSlug = owned.rows[0].slug;

    //  The fixture researcher is past onboarding. Onboarding is a flow of its
    //  own and is not what the console specs are about; leaving it incomplete
    //  would redirect every one of them to the first-run questions.
    await db.query(
      `update public.profiles
          set onboarding_step = 4, onboarding_completed_at = coalesce(onboarding_completed_at, now()),
              full_name = coalesce(nullif(full_name, ''), 'E2E Researcher'),
              default_org_id = $2
        where id = $1`,
      [userId, orgId],
    );

    // One screen, one run, one comparison. Dropped and rebuilt so the suite
    // always sees the same numbers however it last exited.
    await db.query(
      `delete from public.screens where org_id = $1 and name = $2`,
      [orgId, FIXTURE.screenName],
    );
    const screenId = randomUUID();
    const runId = randomUUID();
    const comparisonId = randomUUID();

    await db.query(
      `insert into public.screens (id, org_id, name, modality, cell_line, phenotype, status, taxid,
                                   description, tags, visibility)
       values ($1, $2, $3, 'knockout', 'HeLa', 'synthetic fixture phenotype', 'complete', 9606,
               'Synthetic values for end-to-end tests. Not an experiment, not evidence, and never to reach the Atlas.',
               array['fixture', 'e2e', 'synthetic'], 'private')`,
      [screenId, orgId, FIXTURE.screenName],
    );
    await db.query(
      `insert into public.runs (id, org_id, screen_id, status, engine_version, created_at, finished_at)
       values ($1, $2, $3, 'complete', $4, now(), now())`,
      [runId, orgId, screenId, FIXTURE.engineVersion],
    );
    await db.query(`update public.screens set current_run_id = $1 where id = $2`, [runId, screenId]);
    await db.query(
      `insert into public.comparisons (id, screen_id, name, kind, treatment_ids, control_ids, is_primary)
       values ($1, $2, 'treated vs control', 'treatment_vs_control',
               array[]::uuid[], array[]::uuid[], true)`,
      [comparisonId, screenId],
    );

    // QC with a shape Screen Doctor has something to say about: the assay
    // separated, and one sample's reads largely do not map.
    await db.query(
      `insert into public.run_qc (run_id, verdict, nnmd, auroc, min_replicate_r, median_replicate_r,
                                  bottlenecked_samples, notes, metrics)
       values ($1, 'fail', -2.4, 0.82, 0.88, 0.91, 0, $2, $3::jsonb)`,
      [
        runId,
        "Synthetic fixture QC. One control sample maps poorly; the essential-gene separation passes.",
        JSON.stringify({
          nnmd: -2.4,
          auroc: 0.82,
          nnmd_contrast: "ctrl_r1+ctrl_r2 vs plasmid",
          bottlenecked: [],
          replicate_correlations: [
            { a: "ctrl_r1", b: "ctrl_r2", r: 0.91 },
            { a: "treat_r1", b: "treat_r2", r: 0.88 },
          ],
          samples: [
            { label: "plasmid", role: "plasmid", verdict: "pass", mapping_rate: 0.91, zero_fraction: 0.001, skew_ratio: 6.1, mean_reads_per_guide: 420, gini: 0.11, total_reads: 9_000_000 },
            { label: "ctrl_r1", role: "control", verdict: "pass", mapping_rate: 0.89, zero_fraction: 0.004, skew_ratio: 8.4, mean_reads_per_guide: 390, gini: 0.14, total_reads: 8_400_000 },
            { label: "ctrl_r2", role: "control", verdict: "fail", mapping_rate: 0.41, zero_fraction: 0.006, skew_ratio: 9.2, mean_reads_per_guide: 310, gini: 0.15, total_reads: 8_100_000 },
            { label: "treat_r1", role: "treatment", verdict: "pass", mapping_rate: 0.88, zero_fraction: 0.009, skew_ratio: 9.9, mean_reads_per_guide: 360, gini: 0.17, total_reads: 7_900_000 },
            { label: "treat_r2", role: "treatment", verdict: "pass", mapping_rate: 0.9, zero_fraction: 0.008, skew_ratio: 9.4, mean_reads_per_guide: 370, gini: 0.16, total_reads: 8_000_000 },
          ],
        }),
      ],
    );
    for (const [position, [stage, status, tool, detail]] of [
      ["ingest", "done", "splicr.ingest", "5 file(s), fixture"],
      ["count", "done", "splicr.count", "5 samples"],
      ["qc", "done", "splicr.qc", "fail, NNMD -2.40"],
      ["hits", "done", "mageck_rra", `${FIXTURE.genes} genes, ${FIXTURE.significant} at FDR 0.1`],
    ].entries()) {
      await db.query(
        `insert into public.run_stages (run_id, stage, status, tool, detail, position)
         values ($1, $2, $3, $4, $5, $6)`,
        [runId, stage, status, tool, detail, position],
      );
    }

    // The cloud, then the signal. generate_series keeps this one statement
    // rather than twenty thousand round trips.
    await db.query(
      `insert into public.hits (screen_id, run_id, comparison_id, gene_symbol, direction, lfc, p_value, fdr, n_guides, guide_lfcs)
       select $1, $2, $3,
              'FIX' || lpad(i::text, 5, '0'),
              case when (i % 2) = 0 then 'enriched' else 'depleted' end::hit_direction,
              round((((i * 7919) % 2000)::numeric / 1000) - 1, 4),
              0.2 + (((i * 104729) % 800)::numeric / 1000),
              0.3 + (((i * 104729) % 700)::numeric / 1000),
              3,
              array[0.1, -0.1, 0.05]
         from generate_series(1, $4) as i`,
      [screenId, runId, comparisonId, FIXTURE.genes - FIXTURE.significant],
    );
    const significant = [];
    for (let i = 0; i < FIXTURE.significant; i += 1) {
      significant.push({
        gene: `HIT${String(i + 1).padStart(2, "0")}`,
        lfc: Number((3.5 - i * 0.2).toFixed(4)),
        fdr: Number((0.004 + i * 0.008).toFixed(6)),
        p: Number((0.0000012 + i * 0.000004).toFixed(9)),
      });
    }
    for (const row of significant) {
      const hit = await db.query(
        `insert into public.hits (screen_id, run_id, comparison_id, gene_symbol, direction, lfc, p_value, fdr, n_guides, guide_lfcs)
         values ($1, $2, $3, $4, 'enriched', $5, $6, $7, 3, array[$5::real, $5::real, $5::real])
         returning id`,
        [screenId, runId, comparisonId, row.gene, row.lfc, row.p, row.fdr],
      );
      // Two of them carry a flag, so the board's "with artifact flags" view and
      // the promiscuity branch of the recommendation both have something real.
      if (row.gene === "HIT01" || row.gene === "HIT02") {
        await db.query(
          `insert into public.hit_flags (hit_id, flag, severity, message)
           values ($1, 'promiscuous_guide', 'warn', 'Fixture flag: a guide has matches elsewhere.')`,
          [hit.rows[0].id],
        );
      }
    }

    await db.query("commit");
    return { userId, orgId, screenId, runId, comparisonId, admin, config };
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}

/** Remove everything the fixture created, including decisions the suite made. */
async function teardown() {
  const config = env();
  const db = await connect(config.SUPABASE_DB_URL);
  try {
    const user = await db.query(`select id from public.profiles where email = $1`, [FIXTURE.email]);
    if (user.rowCount > 0) {
      // Stored objects are not rows and nothing cascades to them, so a logo a
      // spec uploaded has to go before the organization that named it does.
      await db.query(
        `delete from storage.objects
          where bucket_id = 'lab-logos'
            and split_part(name, '/', 1) in (
              select org_id::text from public.org_members where user_id = $1)`,
        [user.rows[0].id],
      );
      await db.query(
        `delete from public.organizations where id in (
           select org_id from public.org_members where user_id = $1)`,
        [user.rows[0].id],
      );
    }
    await db.query(`delete from public.splicr_access_allowlist where lower(email) = lower($1)`, [FIXTURE.email]);
  } finally {
    await db.end();
  }
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users = await admin.auth.admin.listUsers({ perPage: 200 });
  const found = users.data?.users.find((user) => user.email === FIXTURE.email);
  if (found) await admin.auth.admin.deleteUser(found.id);
}


module.exports = { FIXTURE, seed, teardown };

if (require.main === module) {
  const run = async () => {
    if (process.argv[2] === "seed") {
      const out = await seed();
      console.log(JSON.stringify({ orgId: out.orgId, screenId: out.screenId }, null, 1));
    } else if (process.argv[2] === "teardown") {
      await teardown();
      console.log("fixture removed");
    } else {
      console.error("usage: node e2e/fixtures/seed.cjs seed|teardown");
      process.exitCode = 1;
    }
  };
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
