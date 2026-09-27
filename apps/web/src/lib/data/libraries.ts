/**
 * The guide library catalogue, read for the settings page.
 *
 * `atlas.libraries` is not reachable over the Data API: the project exposes only
 * the `public` and `graphql_public` schemas, so a request carrying
 * `Accept-Profile: atlas` comes back 406 PGRST106. Migration
 * 20260927000300_library_catalog.sql adds `public.library_catalog`, a
 * `security_invoker` view over that table, so the same row filter applies:
 * the public catalogue for everyone, plus an organization's own custom
 * libraries for its members.
 *
 * This lives beside the rest of the data layer but is its own file, so it does
 * not collide with org.ts.
 */
import "server-only";

import { cache } from "react";

import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

import { MODALITIES, type Modality } from "./types";

/** One row of `public.library_catalog`, narrowed to what the UI renders. */
export interface LibraryOption {
  id: string;
  slug: string;
  name: string;
  taxid: number;
  modality: Modality;
  cas: string;
  n_guides: number;
  n_genes: number;
  /** True for a library this workspace uploaded, rather than a public one. */
  custom: boolean;
}

export interface LibraryCatalog {
  libraries: LibraryOption[];
  /**
   * True when the read itself failed, as opposed to returning no rows. The
   * settings page says so rather than presenting an empty list as the truth.
   */
  unavailable: boolean;
}

const LIBRARY_COLUMNS = "id, org_id, slug, name, taxid, modality, cas, n_guides, n_genes";

interface LibraryRow {
  id: string;
  org_id: string | null;
  slug: string;
  name: string;
  taxid: number | null;
  modality: string;
  cas: string | null;
  n_guides: number | null;
  n_genes: number | null;
}

function isModality(value: unknown): value is Modality {
  return typeof value === "string" && (MODALITIES as readonly string[]).includes(value);
}

/**
 * Every library this caller may see, public catalogue first, then the
 * workspace's own, each group by name.
 *
 * Wrapped in React `cache()` so a page and its panels share one read. Never
 * throws: a failure comes back as `unavailable` with an empty list.
 */
export const listLibraries = cache(async (): Promise<LibraryCatalog> => {
  if (!supabaseConfigured) return { libraries: [], unavailable: true };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("library_catalog")
      .select(LIBRARY_COLUMNS)
      .order("name", { ascending: true });

    if (error) {
      console.error(`[data/libraries] listLibraries: ${error.message}`);
      return { libraries: [], unavailable: true };
    }

    const rows: LibraryRow[] = Array.isArray(data) ? (data as LibraryRow[]) : [];

    const libraries = rows
      .filter((row) => isModality(row.modality))
      .map<LibraryOption>((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        taxid: row.taxid ?? 0,
        modality: row.modality as Modality,
        cas: row.cas ?? "",
        n_guides: row.n_guides ?? 0,
        n_genes: row.n_genes ?? 0,
        custom: row.org_id !== null,
      }))
      .sort((a, b) => {
        if (a.custom !== b.custom) return a.custom ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

    return { libraries, unavailable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[data/libraries] listLibraries: ${message}`);
    return { libraries: [], unavailable: true };
  }
});
