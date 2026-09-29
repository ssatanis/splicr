/**
 * Guide libraries the planner can start from.
 *
 * The counts are not copied from a paper or a vendor page. They are what
 * `python -m splicr libraries` reports after the engine parses the library's own
 * file under `data/references/libraries`, so a figure here can be regenerated
 * and a wrong one can be caught by running that command. The control count is
 * the number of non-targeting and other control guides the engine found.
 *
 * TKOv3 reports zero because its controls (EGFP, LacZ and luciferase targeting
 * guides) are not labelled as controls in the file the engine parses. The
 * library does carry them; the planner shows the number it can verify and lets
 * the reader edit it.
 */

export type LibraryModality = "knockout" | "crispri" | "crispra";

export interface PlannerLibrary {
  slug: string;
  name: string;
  organism: "Human" | "Mouse";
  modality: LibraryModality;
  guides: number;
  genes: number;
  controls: number;
}

export const PLANNER_LIBRARIES: readonly PlannerLibrary[] = [
  { slug: "brunello", name: "Brunello", organism: "Human", modality: "knockout", guides: 77_441, genes: 19_114, controls: 1_000 },
  { slug: "geckov2-a", name: "GeCKOv2 Set A", organism: "Human", modality: "knockout", guides: 65_383, genes: 20_915, controls: 1_000 },
  { slug: "tkov3", name: "TKOv3", organism: "Human", modality: "knockout", guides: 71_090, genes: 18_056, controls: 0 },
  { slug: "brie", name: "Brie", organism: "Mouse", modality: "knockout", guides: 79_637, genes: 19_674, controls: 1_000 },
  { slug: "dolcetto-a", name: "Dolcetto Set A", organism: "Human", modality: "crispri", guides: 57_050, genes: 18_898, controls: 496 },
  { slug: "calabrese-a", name: "Calabrese Set A", organism: "Human", modality: "crispra", guides: 56_762, genes: 18_886, controls: 496 },
] as const;

export const MODALITY_NAME: Record<LibraryModality, string> = {
  knockout: "knockout",
  crispri: "CRISPRi",
  crispra: "CRISPRa",
};

export function findLibrary(slug: string): PlannerLibrary | null {
  return PLANNER_LIBRARIES.find((library) => library.slug === slug) ?? null;
}
