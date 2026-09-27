import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Reads KEY=VALUE pairs from .env files without adding a dependency. */
export function loadEnv() {
  for (const file of [join(repoRoot, ".env"), join(repoRoot, ".env.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}

export function databaseUrl() {
  loadEnv();
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set. Copy .env.example to .env and fill in the pooler connection string.",
    );
    process.exit(1);
  }
  return url;
}

export async function connect() {
  const client = new pg.Client({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0,
  });
  await client.connect();
  return client;
}
