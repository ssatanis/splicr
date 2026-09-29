"use server";

/**
 * The Atlas is public reference data, so its lookups need no workspace and no
 * session: a demo visitor and a signed-in member get the same answer. A server
 * action rather than a route because the only caller is the gene box.
 */
import { suggestGenes } from "./query";
import { getAtlasGenes } from "./store";
import type { GeneSuggestion } from "./types";

export async function suggestAtlasGenes(prefix: string): Promise<GeneSuggestion[]> {
  if (typeof prefix !== "string") return [];
  const trimmed = prefix.trim().slice(0, 40);
  if (trimmed.length < 1) return [];
  try {
    return suggestGenes(getAtlasGenes(), trimmed, 8);
  } catch (error) {
    console.error(`[atlas/actions] ${error instanceof Error ? error.message : "suggest failed"}`);
    return [];
  }
}
