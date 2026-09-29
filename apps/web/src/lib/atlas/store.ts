/**
 * Loads the Atlas snapshot from disk, once per server process.
 *
 * Read with `fs` rather than imported as JSON, for two reasons. TypeScript
 * infers a type for every literal in an imported JSON file, and the gene table
 * holds 1.7 million of them, which costs the whole project's typecheck seconds
 * and memory. And a route only pays for what it asks for: the screens file is
 * 2 MB and every Atlas page needs it, the gene file is 6 MB and only a gene
 * page, a screen page and a gene-filtered list do.
 *
 * The files are checked against the manifest's SHA-256 the first time they are
 * read, so a half-copied or hand-edited snapshot fails loudly here instead of
 * showing a reader counts that disagree with the ORCS.
 */
import "server-only";

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildGeneIndex } from "./query";
import type { AtlasManifest, AtlasScreen, GeneIndex, GeneTable } from "./types";

/**
 * `next dev` and `next start` run from the app directory. The repository's own
 * scripts and tests run from the repository root, so both are tried, and the
 * one that has a manifest wins.
 */
const DATA_DIR =
  [
    path.join(process.cwd(), "src", "lib", "atlas", "data"),
    path.join(process.cwd(), "apps", "web", "src", "lib", "atlas", "data"),
  ].find((dir) => existsSync(path.join(dir, "manifest.json"))) ??
  path.join(process.cwd(), "src", "lib", "atlas", "data");

function readVerified(name: string, manifest: AtlasManifest): Buffer {
  const bytes = readFileSync(path.join(DATA_DIR, name));
  const expected = manifest.sha256[name];
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (expected !== actual) {
    throw new Error(
      `Atlas snapshot ${name} does not match its manifest (expected ${expected?.slice(0, 12)}, got ${actual.slice(0, 12)}). ` +
        "Rebuild it with scripts/data/build-atlas-snapshot.py.",
    );
  }
  return bytes;
}

let manifest: AtlasManifest | null = null;
let screens: AtlasScreen[] | null = null;
let byId: Map<number, AtlasScreen> | null = null;
let genes: GeneIndex | null = null;

export function getAtlasManifest(): AtlasManifest {
  manifest ??= JSON.parse(readFileSync(path.join(DATA_DIR, "manifest.json"), "utf8")) as AtlasManifest;
  return manifest;
}

export function getAtlasScreens(): readonly AtlasScreen[] {
  if (screens === null) {
    screens = JSON.parse(readVerified("screens.json", getAtlasManifest()).toString("utf8")) as AtlasScreen[];
  }
  return screens;
}

export function getAtlasScreenMap(): ReadonlyMap<number, AtlasScreen> {
  byId ??= new Map(getAtlasScreens().map((screen) => [screen.id, screen]));
  return byId;
}

export function getAtlasGenes(): GeneIndex {
  if (genes === null) {
    const table = JSON.parse(readVerified("genes.json", getAtlasManifest()).toString("utf8")) as GeneTable;
    genes = buildGeneIndex(table);
  }
  return genes;
}

export function getAtlasNotice(): string {
  return readFileSync(path.join(DATA_DIR, "NOTICE"), "utf8");
}
