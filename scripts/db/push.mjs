/**
 * Applies every migration in supabase/migrations that has not run yet, in
 * filename order, each inside a transaction, recording it in the same
 * supabase_migrations.schema_migrations table the Supabase CLI uses.
 *
 *   node scripts/db/push.mjs            apply pending migrations
 *   node scripts/db/push.mjs --dry-run  list them without applying
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { connect, repoRoot } from "./client.mjs";

const dryRun = process.argv.includes("--dry-run");
const dir = join(repoRoot, "supabase", "migrations");

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = await connect();

try {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text,
      created_by text,
      idempotency_key text
    );
  `);

  const { rows } = await client.query(
    "select version from supabase_migrations.schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.version));

  const pending = files.filter((f) => !applied.has(f.split("_")[0]));

  if (pending.length === 0) {
    console.log(`Up to date. ${applied.size} migrations applied.`);
    process.exit(0);
  }

  console.log(`${pending.length} pending migration(s):`);
  for (const f of pending) console.log(`  ${f}`);
  if (dryRun) process.exit(0);

  for (const file of pending) {
    const version = file.split("_")[0];
    const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
    const sql = readFileSync(join(dir, file), "utf8");
    process.stdout.write(`\nApplying ${file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
        [version, name, [sql]],
      );
      await client.query("commit");
      console.log("ok");
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(`\n${err.message}`);
      if (err.position) {
        const pos = Number(err.position);
        console.error(`\n...${sql.slice(Math.max(0, pos - 220), pos + 220)}...`);
      }
      process.exit(1);
    }
  }

  console.log("\nAll migrations applied.");
} finally {
  await client.end();
}
