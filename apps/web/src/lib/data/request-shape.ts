/**
 * What a workspace's analysis request is, and what each of its states means.
 *
 * Pure: no database client, no `server-only`. The new-screen form is a Client
 * Component and needs the accession check and the status copy at runtime, and
 * importing them from the module that opens a Supabase client would drag that
 * module into the browser bundle.
 */

export type ScreenRequestStatus =
  | "queued"
  | "accepted"
  | "needs_review"
  | "published"
  | "rejected"
  | "failed";

export interface ScreenRequest {
  id: string;
  accession: string;
  resolved_accession: string | null;
  status: ScreenRequestStatus;
  detail: string | null;
  created_at: string;
}

/**
 * What each status means to a researcher, in the engine's terms.
 *
 * `queued` is deliberately not called "processing". Nothing has looked at the
 * accession yet, and saying otherwise would be the console inventing progress.
 */
export const REQUEST_COPY: Record<ScreenRequestStatus, { label: string; body: string }> = {
  queued: {
    label: "Queued",
    body: "Recorded. The ingest engine picks requests up on its next sweep and reports back here.",
  },
  accepted: {
    label: "In progress",
    body: "The engine recognised the accession, inferred the design and is reanalysing it from the raw reads.",
  },
  needs_review: {
    label: "Needs review",
    body: "The accession was found, but its experimental design could not be inferred confidently from the deposited metadata. A person has to settle it before analysis starts.",
  },
  published: {
    label: "In the Atlas",
    body: "Reanalysed and recorded. Reanalysed screens are shared evidence and live in the Atlas, not in this workspace's screen list.",
  },
  rejected: {
    label: "Not a screen the engine can process",
    body: "The engine could not treat this as a pooled CRISPR screen. That is a statement about what the deposit contains, not about the experiment.",
  },
  failed: {
    label: "Failed",
    body: "The engine started and could not finish. The reason it recorded is below.",
  },
};

/**
 * The accessions the ingest engine knows how to resolve.
 *
 * GEO series, NCBI/EBI/DDBJ BioProjects, and SRA/ENA/DDBJ studies. Anything
 * else is refused here rather than queued for an engine that will reject it.
 */
const ACCESSION = /^(GSE\d{3,9}|PRJ(NA|EB|DB)\d{3,9}|[SED]RP\d{5,9})$/;

export function normaliseAccession(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isSupportedAccession(raw: string): boolean {
  return ACCESSION.test(normaliseAccession(raw));
}
