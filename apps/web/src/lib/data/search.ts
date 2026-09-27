"use server";

/**
 * Search behind the command palette.
 *
 * Runs with the caller's own session, so Row Level Security decides which
 * screens come back and a signed-out visitor sees none of them. Genes come from
 * the Atlas, which is public reference data, so they are searchable either way.
 *
 * Never throws at the caller. The palette is a navigation aid: when a query
 * fails it should quietly return the static commands it already had rather than
 * take the page down.
 */

import { createClient } from "@/lib/supabase/server";

import { getCurrentContext } from "./org";

export type SearchKind = "screen" | "gene";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchResponse {
  screens: SearchHit[];
  genes: SearchHit[];
  /** Set when a source could not be reached, so the palette can say so. */
  degraded: string | null;
}

const EMPTY: SearchResponse = { screens: [], genes: [], degraded: null };

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

export async function searchWorkspace(rawQuery: string): Promise<SearchResponse> {
  const query = sanitize(rawQuery ?? "");
  if (query.length < 2) return EMPTY;

  const context = await getCurrentContext().catch(() => null);
  const supabase = await createClient().catch(() => null);
  if (!supabase) return { ...EMPTY, degraded: "Search is unavailable right now." };

  const canSeeScreens = Boolean(context?.org) && !context?.isDemo;

  const [screens, genes] = await Promise.all([
    canSeeScreens
      ? supabase
          .from("screens")
          .select("id, name, cell_line, phenotype, status, n_hits")
          .ilike("name", `%${query}%`)
          .order("updated_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("gene_search")
      .select("symbol, name, taxid")
      // Prefix matches first: someone typing "TP5" wants TP53, not a gene whose
      // description happens to contain the letters.
      .ilike("symbol", `${query}%`)
      .order("symbol")
      .limit(6),
  ]);

  const degraded =
    screens.error || genes.error
      ? "Some results could not be loaded."
      : null;

  return {
    degraded,
    screens: (screens.data ?? []).map((row) => ({
      kind: "screen" as const,
      id: String(row.id),
      title: String(row.name),
      subtitle: [row.cell_line, row.phenotype, row.status]
        .filter(Boolean)
        .join(" · ") || "Screen",
      href: `/dashboard/screens/${row.id}`,
    })),
    genes: (genes.data ?? []).map((row) => ({
      kind: "gene" as const,
      id: String(row.symbol),
      title: String(row.symbol),
      subtitle: String(row.name ?? (row.taxid === 10090 ? "Mouse gene" : "Human gene")),
      href: `/dashboard/atlas?gene=${encodeURIComponent(String(row.symbol))}`,
    })),
  };
}
