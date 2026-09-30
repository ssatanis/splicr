/**
 * Runs Supabase's own database linter (splinter, the SQL behind the dashboard's
 * Security and Performance Advisors) against SUPABASE_DB_URL, inside a
 * transaction that is rolled back, and prints findings by level.
 *
 *   node scripts/db/advisors.mjs            summary, exits 1 on any ERROR or WARN
 *   node scripts/db/advisors.mjs --all      include every INFO detail line
 *
 * The Supabase MCP connection used during development belongs to a different
 * organization than this project, so this is how the advisors are checked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { connect, repoRoot } from "./client.mjs";

const SPLINTER = "https://raw.githubusercontent.com/supabase/splinter/main/splinter.sql";
const cacheDir = join(repoRoot, "data", "cache");
const cache = join(cacheDir, "splinter.sql");

if (!existsSync(cache)) {
  mkdirSync(cacheDir, { recursive: true });
  const res = await fetch(SPLINTER);
  if (!res.ok) throw new Error(`splinter download failed: ${res.status}`);
  writeFileSync(cache, await res.text());
}

const client = await connect();
let rows = [];
try {
  await client.query("begin");
  const res = await client.query(readFileSync(cache, "utf8"));
  rows = (Array.isArray(res) ? res : [res]).flatMap((r) => r.rows ?? []);
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}

const groups = new Map();
for (const r of rows) {
  const key = `${r.level} ${r.name}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r.detail);
}
const all = process.argv.includes("--all");
for (const [key, details] of [...groups].sort()) {
  console.log(`${key} x${details.length}`);
  if (all || !key.startsWith("INFO")) for (const d of details) console.log(`   - ${d}`);
}
const blocking = rows.filter((r) => r.level === "ERROR" || r.level === "WARN").length;
console.log(`\n${rows.length} findings, ${blocking} ERROR/WARN`);
process.exit(blocking ? 1 : 0);
