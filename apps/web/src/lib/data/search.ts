"use server";

/**
 * Search behind the command palette.
 *
 * Runs with the caller's own session, so Row Level Security decides which
 * workspace screens come back and a signed-out visitor sees none of them. Genes
 * and published screens come from the Atlas snapshot on disk, which is public
 * reference data, so they are searchable either way and keep working when the
 * workspace database is unreachable.
 *
 * Never throws at the caller. The palette is a navigation aid: when a query
 * fails it should quietly return the static commands it already had rather than
 * take the page down.
 */

import { atlasGeneHref, atlasScreenHref, publicationLabel } from "@/lib/atlas/links";
import { describeScreen, queryScreens, suggestGenes } from "@/lib/atlas/query";
import { getAtlasGenes, getAtlasScreens } from "@/lib/atlas/store";
import { createClient } from "@/lib/supabase/server";

import { getCurrentContext } from "./org";

export type SearchKind = "screen" | "atlas" | "gene";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchResponse {
  /** This workspace's own screens. */
  screens: SearchHit[];
  /** Published screens in the Atlas. */
  atlas: SearchHit[];
  genes: SearchHit[];
  /** Set when a source could not be reached, so the palette can say so. */
  degraded: string | null;
}

const EMPTY: SearchResponse = { screens: [], atlas: [], genes: [], degraded: null };

/**
 * PostgREST `or=` takes a comma separated filter list, and its own grammar uses
 * commas, parentheses and dots as delimiters. A query containing any of them
 * would change the shape of the filter rather than be matched literally, so
 * they are stripped before interpolation. `%` and `_` are `ilike` wildcards and
 * are stripped for the same reason.
 */
function sanitize(raw: string): string {
  return raw.replace(/[,().*%_\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}

/** Published screens whose author, cell line, phenotype or PubMed id match. */
function searchAtlasScreens(query: string): SearchHit[] {
  const page = queryScreens(
    getAtlasScreens(),
    null,
    {
      q: query, modality: null, phenotype: null, screenType: null, setup: null, cellLine: null,
      yearFrom: null, yearTo: null, withHits: false, gene: null, sort: "year", dir: "desc", page: 1,
    },
    4,
  );
  return page.rows.map((screen) => ({
    kind: "atlas" as const,
    id: String(screen.id),
    title: `${publicationLabel(screen)}, screen ${screen.id}`,
    subtitle: describeScreen(screen) || "Published screen",
    href: atlasScreenHref(screen.id),
  }));
}

function searchAtlasGenes(query: string): SearchHit[] {
  return suggestGenes(getAtlasGenes(), query, 6).map((gene) => ({
    kind: "gene" as const,
    id: gene.symbol,
    title: gene.symbol,
    subtitle: `${gene.viaAlias ? `Alias ${gene.viaAlias}. ` : ""}Called in ${gene.called} of ${gene.tested} Atlas screens`,
    href: atlasGeneHref(gene.symbol),
  }));
}

export async function searchWorkspace(rawQuery: string): Promise<SearchResponse> {
  const query = sanitize(rawQuery ?? "");
  if (query.length < 2) return EMPTY;

  // The Atlas is on disk. A failed read here is a broken snapshot, not a slow
  // network, and is reported as degraded instead of taking the palette down.
  let atlas: SearchHit[] = [];
  let genes: SearchHit[] = [];
  let degraded: string | null = null;
  try {
    atlas = searchAtlasScreens(query);
    genes = searchAtlasGenes(query);
  } catch (error) {
    console.error(`[data/search] atlas: ${error instanceof Error ? error.message : "read failed"}`);
    degraded = "Atlas results could not be loaded.";
  }

  const context = await getCurrentContext().catch(() => null);
  const canSeeScreens = Boolean(context?.org);
  let screens: SearchHit[] = [];
  if (canSeeScreens) {
    const supabase = await createClient().catch(() => null);
    if (!supabase) {
      degraded ??= "Your workspace screens could not be searched right now.";
    } else {
      const result = await supabase
        .from("screens")
        .select("id, name, cell_line, phenotype, status, n_hits")
        .ilike("name", `%${query}%`)
        .order("updated_at", { ascending: false })
        .limit(6);
      if (result.error) degraded ??= "Your workspace screens could not be searched right now.";
      screens = (result.data ?? []).map((row) => ({
        kind: "screen" as const,
        id: String(row.id),
        title: String(row.name),
        subtitle: [row.cell_line, row.phenotype, row.status].filter(Boolean).join(", ") || "Screen",
        href: `/dashboard/screens/${row.id}`,
      }));
    }
  }

  return { degraded, screens, atlas, genes };
}
