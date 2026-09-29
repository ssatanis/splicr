/**
 * Where an Atlas record points back to. Every link goes to the source of the
 * record, so a reader can check a figure against the place it came from.
 */
import type { AtlasScreen } from "./types";

export const ORCS_HOME = "https://orcs.thebiogrid.org/";

export const orcsScreenUrl = (id: number) => `https://orcs.thebiogrid.org/Screen/${id}`;
export const orcsGeneUrl = (entrez: number) => `https://orcs.thebiogrid.org/Gene/${entrez}`;
export const ncbiGeneUrl = (entrez: number) => `https://www.ncbi.nlm.nih.gov/gene/${entrez}`;

/**
 * The publication behind a screen. Twelve records are preprints whose source
 * id is a DOI or a URL rather than a PubMed id, and they link to that instead
 * of pretending to have a PMID.
 */
export function publicationLink(
  screen: Pick<AtlasScreen, "pmid" | "sourceId" | "sourceType">,
): { label: string; href: string } | null {
  if (screen.pmid) {
    return { label: `PMID ${screen.pmid}`, href: `https://pubmed.ncbi.nlm.nih.gov/${screen.pmid}/` };
  }
  const id = screen.sourceId?.trim();
  if (!id) return null;
  if (/^https?:\/\//i.test(id)) return { label: "Preprint", href: id };
  if (/^10\.\d{4,9}\//.test(id)) return { label: `DOI ${id}`, href: `https://doi.org/${id}` };
  return null;
}

export const atlasHref = "/dashboard/atlas";
export const atlasScreenHref = (id: number) => `/dashboard/atlas/screens/${id}`;
export const atlasGeneHref = (symbol: string) => `/dashboard/atlas?gene=${encodeURIComponent(symbol)}`;

/**
 * The author string ORCS records already carries the year, "Wang T (2014)".
 * Where a record lacks it, add it rather than print a bare surname.
 */
export function publicationLabel(screen: Pick<AtlasScreen, "author" | "year">): string {
  const author = screen.author?.trim() || "Unattributed";
  if (screen.year !== null && !author.includes(String(screen.year))) return `${author} (${screen.year})`;
  return author;
}

/** The conditions of the assay as one readable string, or null when there are none. */
export function conditionLabel(screen: Pick<AtlasScreen, "condition" | "dosage">): string | null {
  const parts = [screen.condition, screen.dosage].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : null;
}

const MODALITY_LABEL: Record<string, string> = {
  knockout: "Knockout",
  crispri: "CRISPRi",
  crispra: "CRISPRa",
  base_edit: "Base editing",
};

/** ORCS spells modalities in lowercase snake case; readers know them by these names. */
export function modalityLabel(value: string | null): string {
  if (value === null) return "Not recorded";
  return MODALITY_LABEL[value] ?? value;
}
