/** Prints what is actually in the database: migrations, tables, RLS, policies. */
import { connect } from "./client.mjs";

const client = await connect();

const q = async (label, sql) => {
  const { rows } = await client.query(sql);
  console.log(`\n=== ${label} ===`);
  if (rows.length === 0) console.log("  (none)");
  for (const r of rows) console.log("  " + Object.values(r).join("  |  "));
};

try {
  await q("Version", "select version()");
  await q(
    "Migrations",
    `select version, name from supabase_migrations.schema_migrations order by version`,
  );
  await q(
    "Tables",
    `select schemaname, tablename,
            case when rowsecurity then 'RLS on' else 'RLS OFF' end as rls
       from pg_tables
      where schemaname in ('public', 'atlas')
      order by schemaname, tablename`,
  );
  await q(
    "Policy count by table",
    `select schemaname, tablename, count(*)::text as policies
       from pg_policies
      where schemaname in ('public', 'atlas', 'storage')
      group by schemaname, tablename
      order by schemaname, tablename`,
  );
  await q(
    "Tables with RLS on but no policy",
    `select t.schemaname, t.tablename
       from pg_tables t
      where t.schemaname in ('public', 'atlas')
        and t.rowsecurity
        and not exists (
          select 1 from pg_policies p
           where p.schemaname = t.schemaname and p.tablename = t.tablename
        )
      order by 1, 2`,
  );
  await q("Extensions", `select extname, extversion from pg_extension order by extname`);
  await q("Cron jobs", `select jobname, schedule from cron.job order by jobname`);
  await q(
    "Storage buckets",
    `select id, case when public then 'public' else 'private' end, coalesce(file_size_limit::text, '-') from storage.buckets order by id`,
  );
  await q("Row counts (atlas)", `
    select 'genes' as t, count(*)::text from atlas.genes
    union all select 'libraries', count(*)::text from atlas.libraries
    union all select 'guides', count(*)::text from atlas.guides
    union all select 'gene_sets', count(*)::text from atlas.gene_sets
    union all select 'screens', count(*)::text from atlas.screens
  `);
} finally {
  await client.end();
}
