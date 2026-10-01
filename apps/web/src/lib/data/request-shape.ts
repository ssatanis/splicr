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
  | "planning"
  | "running"
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
  planning: {
    label: "Working out the design",
    body: "The engine is reading the deposit to decide which runs are the treated arm, the control arm and the reference.",
  },
  running: {
    label: "Analysing",
    body: "The reads are being fetched, counted and run through QC and hit calling. This is the long part.",
  },
  // Kept for rows written before planning and running existed. Nothing writes
  // it now, and nothing should: it said four different things at once.
  accepted: {
    label: "In progress",
    body: "The engine has the accession and is working on it.",
  },
  needs_review: {
    label: "Needs review",
    body: "The accession was found, but its experimental design could not be inferred confidently from the deposited metadata. A person has to settle it before analysis starts.",
  },
  published: {
    label: "In the Atlas",
    body: "Reanalysed and recorded. Reanalysed screens are shared evidence and live in the Atlas, not in this workspace's screen list.",
  },
  // Covers both "there is no such accession" and "this deposit is not a pooled
  // screen". The label cannot name one of those, because the status does not
  // know which it was; `detail` carries the engine's actual reason.
  rejected: {
    label: "Not accepted",
    body: "The engine could not take this accession up for reanalysis. That is a statement about what the deposit contains, not about the experiment.",
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
