/**
 * What a private screen intake is, in terms both the browser and the server
 * can hold.
 *
 * Pure on purpose: no Supabase client, no `server-only`. The drop zone is a
 * Client Component and needs the file classification and the design rules at
 * runtime, and the server action needs exactly the same rules so the browser's
 * answer is never the one that counts.
 */

export const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB, per file
export const MAX_FILES = 64;

/** Above this, the upload goes through the resumable endpoint. */
export const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

export type IntakeKind = "counts" | "fastq" | "library";

export type SampleRole = "reference" | "control" | "treatment" | "plasmid";

export const ROLE_LABEL: Record<SampleRole, string> = {
  plasmid: "Plasmid pool",
  reference: "Start of screen",
  control: "Control arm",
  treatment: "Treated arm",
};

export const ROLE_HINT: Record<SampleRole, string> = {
  plasmid: "The library as it was made, before any cells saw it.",
  reference: "The early timepoint every later sample is compared back to.",
  control: "Untreated, or vehicle. The arm the treatment is tested against.",
  treatment: "The arm that got the perturbation this screen is about.",
};

/** Roles that can stand on the left of a contrast. */
export const CONTROL_ROLES: readonly SampleRole[] = ["control", "reference", "plasmid"];

export interface IntakeFile {
  id: string;
  name: string;
  bytes: number;
  kind: IntakeKind;
  /** gzip, by extension and by magic number once a byte has been read. */
  compressed: boolean;
  storage_key: string;
  checksum_sha256: string | null;
  status: "pending" | "uploading" | "complete" | "failed";
}

export interface IntakeSample {
  /** The count-table column, or the FASTQ file's name. Stable within a screen. */
  label: string;
  role: SampleRole;
  replicate: number;
  /** Which uploaded file this sample's reads came from, when it is per-file. */
  file_id?: string | null;
}

export interface IntakeDesign {
  name: string;
  cell_line: string;
  phenotype: string;
  modality: string;
  library_id: string | null;
  samples: IntakeSample[];
}

// ---------------------------------------------------------------------------
// Classifying a dropped file
// ---------------------------------------------------------------------------

const FASTQ = /\.(fastq|fq)(\.gz)?$/i;
const TABLE = /\.(tsv|txt|csv|counts?|count)(\.gz)?$/i;
const LIBRARY_NAME = /(library|lib|guides?|sgrna)/i;

/** True when the name ends in a gzip extension. The magic number confirms it. */
export function looksCompressed(name: string): boolean {
  return /\.gz$/i.test(name);
}

/**
 * What a file is, from its name alone.
 *
 * Returns null for a name SplicR has no reading for, so the drop zone can
 * refuse it by name rather than uploading gigabytes and failing at the far end.
 * A table whose name mentions a library is offered as a library; the researcher
 * can still say it is counts, because the name is a hint and not evidence.
 */
export function classify(name: string): IntakeKind | null {
  const base = name.split("/").pop() ?? name;
  if (FASTQ.test(base)) return "fastq";
  if (TABLE.test(base)) return LIBRARY_NAME.test(base) ? "library" : "counts";
  return null;
}

export const ACCEPT_ATTRIBUTE = [
  ".fastq", ".fq", ".fastq.gz", ".fq.gz",
  ".tsv", ".txt", ".csv", ".counts", ".count",
  ".tsv.gz", ".txt.gz", ".csv.gz",
].join(",");

/** Bytes, written the way a sequencing core writes them. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * A storage object name under the organization's prefix.
 *
 * The first segment has to be the organization id: that is what the storage
 * policy in migration 0009 reads to decide whether this member may write here.
 * The file name is reduced to characters S3 keys handle without escaping, and
 * kept recognisable, because a researcher who comes back in a year should be
 * able to tell which object was which sample.
 */
export function storageKey(orgId: string, screenId: string, name: string): string {
  const base = (name.split("/").pop() ?? name).slice(-180);
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "");
  return `${orgId}/${screenId}/${safe || "file"}`;
}

// ---------------------------------------------------------------------------
// Design rules. Enforced here, in the server action, and again in
// public.start_screen_analysis, which is the one that actually decides.
// ---------------------------------------------------------------------------

export interface DesignProblem {
  field: "name" | "samples" | "files" | "library";
  message: string;
}

export function checkDesign(design: IntakeDesign, files: IntakeFile[]): DesignProblem[] {
  const problems: DesignProblem[] = [];

  if (design.name.trim().length < 2) {
    problems.push({ field: "name", message: "Give the screen a name you will recognise later." });
  }

  const analysable = files.filter((f) => f.kind !== "library");
  if (analysable.length === 0) {
    problems.push({ field: "files", message: "Add a count table or FASTQ files." });
  }

  const labels = new Set<string>();
  for (const sample of design.samples) {
    if (labels.has(sample.label)) {
      problems.push({ field: "samples", message: `Two samples are both called ${sample.label}.` });
      break;
    }
    labels.add(sample.label);
  }

  const controls = design.samples.filter((s) => CONTROL_ROLES.includes(s.role)).length;
  const treated = design.samples.filter((s) => s.role === "treatment").length;
  if (controls === 0 || treated === 0) {
    problems.push({
      field: "samples",
      message: "A contrast needs at least one control or start-of-screen sample and at least one treated sample.",
    });
  }

  return problems;
}

/**
 * The name of the contrast a design implies, written the way a methods section
 * writes it rather than as an identifier.
 */
export function contrastName(design: IntakeDesign): string {
  const treated = design.samples.filter((s) => s.role === "treatment");
  const control = design.samples.filter((s) => CONTROL_ROLES.includes(s.role));
  const left = treated.length === 1 ? treated[0].label : `${treated.length} treated`;
  const right = control.length === 1 ? control[0].label : `${control.length} control`;
  return `${left} vs ${right}`;
}
