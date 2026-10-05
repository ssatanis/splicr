"use client";

/**
 * A lab's own screen, from a dropped file to a queued run.
 *
 * THE ORDER OF OPERATIONS, AND WHY
 *
 * 1. A draft screen is created server side the moment the first file is
 *    dropped, because storage is namespaced by organization and screen and
 *    there is nowhere to put bytes until that row exists.
 * 2. Each file is sent straight to storage with the researcher's own session,
 *    and checksummed in a worker at the same time. Neither goes through a
 *    Server Action: a lane of sequencing does not fit in a request body.
 * 3. Nothing is recorded as uploaded until the server has looked in storage and
 *    found the object. A browser that reports success over a dropped connection
 *    is exactly the failure that check exists for.
 * 4. The server reads the head of each stored file back, which is where the
 *    sample columns and the library fingerprint come from. The researcher
 *    corrects the arms.
 * 5. `start_screen_analysis` in the database validates the whole thing again and
 *    creates the run. Only then does this page say anything is queued.
 *
 * Every step that can fail says what failed and what is still true. A file that
 * fails to upload leaves the others alone.
 */
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import {
  createDraftScreen,
  setFileTableMapping,
  discardDraftScreen,
  inspectScreenFiles,
  importCustomLibrary,
  startExperimentAnalysis,
  registerUploadedFile,
  removeUploadedFile,
  setUploadedFilePurpose,
  startScreenAnalysis,
} from "@/lib/intake/actions";
import { defaultMle, type LibraryImportOptions } from "@/lib/intake/analysis-plan";
import { TableMappingEditor } from "./table-mapping";
import type { ParsedTable } from "@/lib/intake/tables";
import { expandExperimentFiles } from "@/lib/intake/archive";
import { hashFile } from "@/lib/intake/checksum";
import { applySampleMetadata, suggestComparisons, tableSamples, type ExperimentTable, type ExperimentComparison } from "@/lib/intake/experiment";
import { ExperimentReview, UploadedLibraryImport, comparisonSamples, type LibraryUpload } from "./experiment-review";
import { deriveSamples } from "@/lib/intake/derive";
import {
  CONTROL_ROLES,
  MAX_FILES,
  MAX_FILE_BYTES,
  storageKey,
  checkDesign,
  classify,
  contrastName,
  looksCompressed,
  type IntakeKind,
  type IntakeSample,
} from "@/lib/intake/shape";
import { uploadFile } from "@/lib/intake/upload";
import { HIT_CALLER_LABEL, type Modality } from "@/lib/data/types";

import { DesignForm, type AnalysisSettings, type DetectedLibrary, type LibraryChoice } from "./design-form";
import { DropZone } from "./drop-zone";
import { FileList, type UploadItem } from "./file-list";
import { FileInspection, type ReviewedFile } from "./file-inspection";

const CONCURRENCY = 2;

interface Props {
  libraries: LibraryChoice[];
  defaults: AnalysisSettings & { modality: Modality; librarySlug: string | null };
  librarySlugToId: Record<string, string>;
  initialDraft?: { screenId: string; orgId: string; name: string; files: UploadItem[] };
}

type Stage = "drop" | "confirm" | "design" | "experiment" | "plan" | "analysing";

const PHASES = ["Upload files", "Review experiment", "Analyse", "Results"] as const;

function PhaseRail({ stage }: { stage: Stage }) {
  const active = stage === "drop" ? 0 : stage === "confirm" || stage === "design" || stage === "experiment" || stage === "plan" ? 1 : 2;
  return (
    <ol aria-label="Analysis progress" className="grid grid-cols-4 gap-2 py-1">
      {PHASES.map((phase, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li key={phase} aria-current={current ? "step" : undefined} className="flex min-w-0 flex-col gap-2">
            <div className={`h-0.5 rounded-full ${done || current ? "bg-navy" : "bg-line"}`}/>
            <span className={`flex items-center gap-1.5 text-[10px] sm:text-[11.5px] ${current ? "font-medium text-navy" : "text-muted"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${current ? "bg-navy text-white" : done ? "bg-navy-tint text-navy" : "bg-mist-soft text-muted"}`}>
                {done ? <CheckCircle2 className="h-3 w-3" aria-hidden="true"/> : index + 1}
              </span>
              {phase}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ConfirmationCard({
  library,
  samples,
  comparison,
  onLooksRight,
  onEdit,
  disabled,
}: {
  library: string;
  samples: IntakeSample[];
  comparison: string;
  onLooksRight: () => void;
  onEdit: () => void;
  disabled: boolean;
}) {
  const treatment = samples.filter((sample) => sample.role === "treatment");
  const controls = samples.filter((sample) => CONTROL_ROLES.includes(sample.role));
  const rows = [
    ["Library", library],
    ["Samples detected", String(samples.length)],
    ["Control", `${controls.length} sample${controls.length === 1 ? "" : "s"}`],
    ["Treatment", `${treatment.length} sample${treatment.length === 1 ? "" : "s"}`],
    ["Comparison", comparison],
  ];

  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">Check the experiment</h3>
        <span className="text-[11.5px] text-muted">Change the design before analysis starts.</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className={label === "Comparison" ? "sm:col-span-2" : ""}>
            <dt className="text-[11px] uppercase tracking-[0.08em] text-muted">{label}</dt>
            <dd className="mt-0.5 text-[12.5px] font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onLooksRight}
          disabled={disabled}
          className="inline-flex h-8 items-center rounded-md bg-ink px-3 text-[12px] font-medium text-white hover:bg-ink/90 disabled:bg-mist disabled:text-muted"
        >
          Looks right
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[12px] text-ink hover:bg-mist-soft disabled:opacity-50"
        >
          Edit design
        </button>
      </div>
    </section>
  );
}

export function UploadFlow({ libraries, defaults, librarySlugToId, initialDraft }: Props) {
  const router = useRouter();

  const [items, setItems] = useState<UploadItem[]>(initialDraft?.files ?? []);
  const [stage, setStage] = useState<Stage>("drop");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const accepting = useRef(false);
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const [started, setStarted] = useState<{ screenId: string } | null>(null);

  const [aliases, setAliases] = useState<{ source: string; target: string }[]>([]);
  const [aliasesConfirmed, setAliasesConfirmed] = useState(true);
  const [sourceTables, setSourceTables] = useState<{ fileId: string; name: string; table: Omit<ParsedTable, "guides"> }[]>([]);
  const [tables, setTables] = useState<ExperimentTable[]>([]);
  const [comparisons, setComparisons] = useState<ExperimentComparison[]>([]);
  const [libraryUploads, setLibraryUploads] = useState<LibraryUpload[]>([]);
  const [reviewedFiles, setReviewedFiles] = useState<ReviewedFile[]>([]);
  const [customLibraries, setCustomLibraries] = useState<LibraryChoice[]>([]);
  const [experimentScreens, setExperimentScreens] = useState<{ screenId: string; name: string }[]>([]);
  const [detected, setDetected] = useState<DetectedLibrary[]>([]);
  const [samples, setSamples] = useState<IntakeSample[]>([]);
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [cellLine, setCellLine] = useState("");
  const [phenotype, setPhenotype] = useState("");
  const [modality, setModality] = useState<Modality>(defaults.modality);
  const [libraryId, setLibraryId] = useState<string | null>(
    defaults.librarySlug ? (librarySlugToId[defaults.librarySlug] ?? null) : null,
  );
  const [settings, setSettings] = useState<AnalysisSettings>({
    normalization: defaults.normalization,
    hit_callers: [...new Set(["mageck_rra" as const, ...defaults.hit_callers.filter((caller) => caller !== "chronos")])],
    fdr_threshold: defaults.fdr_threshold,
    cn_correction: false,
  });

  // Not state: the File handles and the draft identity are read inside async
  // work that must not re-run when a progress bar moves.
  const blobs = useRef(new Map<string, File>());
  const kinds = useRef(new Map<string, IntakeKind>());
  const aborts = useRef(new Map<string, AbortController>());
  const draft = useRef<{ screenId: string; orgId: string } | null>(initialDraft ? { screenId: initialDraft.screenId, orgId: initialDraft.orgId } : null);
  const draftPromise = useRef<Promise<{ screenId: string; orgId: string } | null> | null>(null);

  const patch = useCallback((key: string, next: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...next } : item)));
  }, []);

  /** One draft per visit, even if six files are dropped in the same tick. */
  const ensureDraft = useCallback(async (initialName?: string) => {
    if (draft.current) return draft.current;
    if (!draftPromise.current) {
      draftPromise.current = createDraftScreen(name || initialName || "Untitled screen").then((result) => {
        if (!result.ok) {
          setNotice(result.error);
          draftPromise.current = null;
          return null;
        }
        draft.current = { screenId: result.screenId, orgId: result.orgId };
        return draft.current;
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "Your workspace could not be reached.";
        setNotice(message);
        draftPromise.current = null;
        return null;
      });
    }
    return draftPromise.current;
  }, [name]);

  const sendOne = useCallback(
    async (key: string) => {
      const file = blobs.current.get(key);
      const context = draft.current;
      if (!file || !context) return;

      const controller = new AbortController();
      aborts.current.set(key, controller);
      patch(key, { status: "uploading", error: null, sent: 0 });

      try {
        // Checksumming runs beside the upload rather than before it. The second
        // read of the file comes out of the page cache, so it costs time only
        // if the disk is slower than the network, which it is not.
        const checksum = hashFile(file, undefined, controller.signal).catch(() => null);

        const uploaded = await uploadFile({
          file,
          screenId: context.screenId,
          key: `${context.orgId}/${context.screenId}/${file.name}`,
          onProgress: (sent) => patch(key, { sent }),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        patch(key, { status: "recording", sent: file.size });
        const digest = await checksum;
        if (controller.signal.aborted) return;
        if (!digest) throw new Error("The upload finished, but the checksum could not be computed. Add this file again.");
        patch(key, { checksum: digest });

        const recorded = await registerUploadedFile({
          screenId: context.screenId,
          name: file.name,
          bytes: file.size,
          kind: kinds.current.get(key) ?? "counts",
          compressed: looksCompressed(file.name),
          checksum: digest,
          storageKey: uploaded.storageKey,
        });

        if (!recorded.ok) {
          patch(key, { status: "failed", error: recorded.error });
          return;
        }
        patch(key, { status: "done", fileId: recorded.fileId, error: null });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        patch(key, {
          status: "failed",
          error: error instanceof Error ? error.message : "The upload failed.",
        });
      } finally {
        aborts.current.delete(key);
      }
    },
    [patch],
  );

  /** At most two files in flight, so one big lane does not starve the rest. */
  const pump = useCallback(
    async (keys: string[]) => {
      const queue = [...keys];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const key = queue.shift();
          if (!key) return;
          await sendOne(key);
        }
      });
      await Promise.all(workers);
    },
    [sendOne],
  );

  const onFiles = useCallback(
    async (files: File[]) => {
      if (accepting.current) return;
      accepting.current = true;
      setBusy(true);
      setNotice(null);
      try {
        const expanded: File[] = [];
        const warnings: string[] = [];
        for (const file of files) {
          try { expanded.push(...await expandExperimentFiles([file])); }
          catch (error) {
            expanded.push(file);
            warnings.push(`${file.name} will be retained as an archive. ${error instanceof Error ? error.message : "Its contents could not be unpacked."}`);
          }
        }
        files = expanded;
        if (warnings.length) setNotice(warnings.join(" "));

        const accepted: { key: string; file: File; kind: IntakeKind }[] = [];
        const refused: string[] = [];

        for (const file of files) {
          const kind = classify(file.name);
          if (kind === null) {
            refused.push(file.name);
            continue;
          }
          if (file.size > MAX_FILE_BYTES || file.name.length > 500) {
            refused.push(`${file.name} (${file.size > MAX_FILE_BYTES ? "exceeds 50 GB" : "file name is too long"})`);
            continue;
          }
          if (file.size === 0) {
            refused.push(`${file.name} (empty)`);
            continue;
          }
          accepted.push({ key: crypto.randomUUID(), file, kind });
        }

        if (refused.length > 0) {
          setNotice(
            `Not added: ${refused.slice(0, 4).join(", ")}${
              refused.length > 4 ? ` and ${refused.length - 4} more` : ""
            }.`,
          );
        }
        if (accepted.length === 0) return;

        const room = MAX_FILES - items.length;
        const taking = accepted.slice(0, Math.max(0, room));
        if (taking.length < accepted.length) {
          setNotice(`A screen takes at most ${MAX_FILES} files.`);
        }
        if (taking.length === 0) return;

        if (new Set([...items.map((item) => storageKey("", "", item.name)), ...taking.map((entry) => storageKey("", "", entry.file.name))]).size !== items.length + taking.length) {
          setNotice("Two files resolve to the same storage name. Rename one so each upload keeps its own source.");
          return;
        }
        if (!name.trim()) {
          const base = taking[0].file.name.replace(/\.(fastq|fq|tsv|txt|csv|xlsx|xls|ods|counts?|count)(\.gz)?$/i, "");
          setName(base.replace(/[_-]+/g, " ").trim().slice(0, 120) || "Uploaded screen");
        }

        for (const entry of taking) {
          blobs.current.set(entry.key, entry.file);
          kinds.current.set(entry.key, entry.kind);
        }
        setItems((current) => [
          ...current,
          ...taking.map<UploadItem>((entry) => ({
            key: entry.key,
            name: entry.file.name,
            bytes: entry.file.size,
            kind: entry.kind,
            sent: 0,
            checksum: null,
            status: "queued",
            error: null,
            fileId: null,
          })),
        ]);

        const context = await ensureDraft(taking[0].file.name);
        if (!context) {
          taking.forEach((entry) => patch(entry.key, { status: "failed", error: "Could not create an upload draft. Retry this file." }));
          return;
        }
        // A new source requires a new review before an analysis can start.
        setStage("drop");
        setSourceTables([]);
        setReviewedFiles([]);
        await pump(taking.map((entry) => entry.key));
      } finally {
        accepting.current = false;
        setBusy(false);
      }
    },
    [ensureDraft, items, name, patch, pump],
  );

  const retryUpload = useCallback(async (key: string) => {
    if (accepting.current || !blobs.current.has(key)) return;
    accepting.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const context = await ensureDraft();
      if (context) await sendOne(key);
    } finally {
      accepting.current = false;
      setBusy(false);
    }
  }, [ensureDraft, sendOne]);

  const onRemove = useCallback(
    async (key: string) => {
      aborts.current.get(key)?.abort();
      aborts.current.delete(key);
      const item = items.find((entry) => entry.key === key);
      if (item?.fileId && draft.current) {
        setBusy(true);
        try {
          const result = await removeUploadedFile(draft.current.screenId, item.fileId);
          if (!result.ok) { setNotice(result.error); return; }
        } catch {
          setNotice("The file could not be removed. Try again.");
          return;
        } finally { setBusy(false); }
      }
      setItems((current) => current.filter((entry) => entry.key !== key));
      setReviewedFiles([]);
      setSourceTables([]);
      setStage("drop");
      blobs.current.delete(key);
      kinds.current.delete(key);
    },
    [items],
  );

  /** Read the stored bytes back and turn them into a design to confirm. */
  const review = useCallback(async () => {
    const context = draft.current;
    if (!context) return;
    setBusy(true);
    setNotice(null);

    const result = await inspectScreenFiles(context.screenId).catch(() => ({ ok: false as const, error: "File inspection could not finish. Try again." }));
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }

    for (const file of result.files) {
      const item = items.find((row) => row.fileId === file.fileId);
      if (item) kinds.current.set(item.key, file.kind);
    }
    setItems((current) => current.map((item) => {
      const file = result.files.find((row) => row.fileId === item.fileId);
      return file ? { ...item, kind: file.kind } : item;
    }));
    setSourceTables(result.files.flatMap((file) => file.shape?.kind === "tables" ? file.shape.tables.map((table) => ({ fileId: file.fileId, name: file.name, table })) : []));
    const unreadable = result.files.filter((file) => file.error !== null);
    if (unreadable.length > 0) {
      setItems((current) =>
        current.map((item) => {
          const match = unreadable.find((file) => file.fileId === item.fileId);
          return match ? { ...item, status: "failed", error: match.error } : item;
        }),
      );
      setNotice("Some files could not be read back. Remove or replace them before going on.");
      return;
    }

    const experimentTables: ExperimentTable[] = [];
    setReviewedFiles(result.files.map((file) => ({ name: file.name, purpose: file.shape?.kind === "tables" ? [...new Set(file.shape.tables.map((table) => table.kind === "counts" ? "Screen counts" : table.kind === "library" ? "Guide library" : "Supporting table"))].join(", ") : file.shape?.kind === "fastq" ? "Sequencing reads" : file.shape?.kind === "counts" ? "Screen counts" : file.shape?.kind === "context" ? file.shape.note : "Supporting file, retained", context: file.shape?.kind === "context" ? file.shape : undefined })));
    const importedTables: LibraryUpload[] = [];
    for (const file of result.files) {
      if (file.shape?.kind !== "tables") continue;
      for (const table of file.shape.tables) {
        if (table.kind === "counts") experimentTables.push({ fileId: file.fileId, name: file.name, sheet: table.sheet, model: table.sheet.match(/ICSBCS\d+/i)?.[0] ?? table.sheet.replace(/(?:gRNA|raw|counts?|sheet\d+)/gi, "").trim(), mapping: table.mapping, samples: tableSamples(table.sample_columns), rows: table.rows_seen, preview: table.preview, warnings: [...table.warnings, "Sample roles and early timepoints are suggestions. Confirm against your experiment."] });
        if (table.kind === "library") importedTables.push({ fileId: file.fileId, name: file.name, sheet: table.sheet, rows: table.rows_seen, preview: table.preview, warnings: table.warnings });
      }
    }
    if (importedTables.length) {
      for (const file of result.files) if (file.shape?.kind === "counts" && file.kind !== "library") experimentTables.push({ fileId: file.fileId, name: file.name, sheet: "Table", model: cellLine || file.name.replace(/\.[^.]+$/, ""), samples: tableSamples(file.shape.sample_columns), rows: file.shape.rows_seen, preview: file.shape.preview, warnings: [] });
    }
    setLibraryUploads(importedTables);
    if (experimentTables.length) {
      setTables(experimentTables);
      setLibraryUploads(importedTables);
      setComparisons(suggestComparisons(experimentTables));
      setStage("experiment");
      return;
    }

    const countColumns = result.files.flatMap((file) =>
      file.shape?.kind === "counts" ? file.shape.sample_columns : [],
    );
    const fastq = result.files
      .filter((file) => file.shape?.kind === "fastq")
      .map((file) => ({ fileId: file.fileId, name: file.name }));

    const derived = deriveSamples(countColumns, fastq);
    if (derived.length === 0) {
      setNotice("No samples could be read from these files. A count table needs numeric sample columns.");
      return;
    }

    setSamples(derived);
    setDetected(
      result.libraries.map((candidate) => ({
        library_id: candidate.library_id,
        name: candidate.name,
        coverage: candidate.coverage,
        match_rate: candidate.match_rate,
      })),
    );
    const nextLibraryId = result.libraries.length > 0 ? result.libraries[0].library_id : libraryId;
    if (nextLibraryId !== libraryId) setLibraryId(nextLibraryId);

    const nextDesign = { name, cell_line: cellLine, phenotype, modality, library_id: nextLibraryId, samples: derived };
    const doneFiles = items
      .filter((item) => item.status === "done")
      .map((item) => ({
        id: item.fileId ?? item.key,
        name: item.name,
        bytes: item.bytes,
        kind: item.kind,
        compressed: false,
        storage_key: "",
        checksum_sha256: item.checksum,
        status: "complete" as const,
      }));
    const inferredProblems = checkDesign(nextDesign, doneFiles);
    if (inferredProblems.length > 0 || importedTables.length > 0) {
      if (inferredProblems.length) setNotice(`Needs your input: ${inferredProblems[0].message}`);
      setStage("design");
    } else {
      setStage("confirm");
    }
  }, [cellLine, items, libraryId, modality, name, phenotype]);

  const start = useCallback(async () => {
    const context = draft.current;
    if (!context) return;
    setStarting(true);
    setNotice(null);

    const result = await startScreenAnalysis({
      reviewed: planConfirmed,
      screenId: context.screenId,
      design: { name, cell_line: cellLine, phenotype, modality, library_id: libraryId, samples },
      settings,
    });
    setStarting(false);

    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setStarted({ screenId: result.screenId });
    setStage("analysing");
    router.refresh();
  }, [cellLine, libraryId, modality, name, phenotype, router, samples, settings, planConfirmed]);

  const discard = useCallback(async () => {
    const context = draft.current;
    for (const controller of aborts.current.values()) controller.abort();
    aborts.current.clear();
    if (context) {
      const result = await discardDraftScreen(context.screenId);
      if (!result.ok) { setNotice(result.error); return; }
    }
    draft.current = null;
    draftPromise.current = null;
    blobs.current.clear();
    kinds.current.clear();
    setItems([]);
    setSamples([]);
    setDetected([]);
    setSourceTables([]);
    setReviewedFiles([]);
    setStage("drop");
    setNotice(null);
    router.refresh();
  }, [router]);

  const importLibrary = async (upload: LibraryUpload, customName: string, options: LibraryImportOptions) => {
    if (!draft.current) return;
    setStarting(true);
    setNotice(null);
    const result = await importCustomLibrary({ screenId: draft.current.screenId, fileId: upload.fileId, sheet: upload.sheet, sources: upload.sources, name: customName, options });
    setStarting(false);
    if (!result.ok) { setNotice(result.error); return; }
    setCustomLibraries((current) => [...current.filter((library) => library.id !== result.libraryId), { id: result.libraryId, name: result.name, n_guides: result.nGuides }]);
    setLibraryId(result.libraryId);
    setSettings((current) => ({ ...current, modality: options.modality, organism_taxid: options.organism_taxid }));
    setModality(options.modality);
    setAliases(result.aliases);
    setAliasesConfirmed(result.aliases.length === 0);
    setNotice(`Library imported: ${result.nGuides.toLocaleString()} guides, ${result.nGenes} target labels, ${result.nControls} negative controls.`);
  };
  const startExperiment = async () => {
    if (!draft.current || !aliasesConfirmed) return;
    setStarting(true);
    setNotice(null);
    const result = await startExperimentAnalysis({ reviewed: true, screenId: draft.current.screenId, libraryId, comparisons: comparisons.filter((comparison) => comparison.enabled).map((comparison) => {
      const table = tables[comparison.table];
      const ordered = (labels: string[]) => [...labels].sort((a, b) => (table.samples.find((s) => s.label === a)?.replicate ?? 0) - (table.samples.find((s) => s.label === b)?.replicate ?? 0));
      return { name: comparison.name, model: comparison.model, phenotype: comparison.phenotype, source: { fileId: table.fileId, sheet: table.sheet }, treatment: ordered(comparison.treatment), control: ordered(comparison.control), samples: comparisonSamples(table, comparison), settings: { ...settings, fitness_assay: Boolean(comparison.fitness) && !comparison.drug, mle_design: settings.hit_callers.includes("mageck_mle") ? comparison.mle_design ?? defaultMle(table.samples, ordered(comparison.treatment), ordered(comparison.control)) : undefined, drugz_options: settings.drugz_options ?? { pseudocount: 5, half_window_size: 500 }, guide_aliases: Object.fromEntries(aliases.map((alias) => [alias.source, alias.target])), cn_correction: false, hit_callers: ["mageck_rra" as const, ...(settings.hit_callers.includes("mageck_mle") ? ["mageck_mle" as const] : []), ...(comparison.fitness && !comparison.drug && settings.hit_callers.includes("bagel2") ? ["bagel2" as const] : []), ...(comparison.drug ? ["drugz" as const] : [])], drugz_paired: comparison.drug && settings.drugz_paired } };
    }) });
    setStarting(false);
    if (!result.ok) { setNotice(result.error); return; }
    setExperimentScreens(result.screens);
    setStarted({ screenId: result.screens[0].screenId });
    setStage("analysing");
    router.refresh();
  };

  const interpretations = <details className="rounded-lg border border-line bg-white p-3"><summary className="cursor-pointer text-[12px] font-medium text-ink">File interpretations and sample sheets</summary>{sourceTables.map(({ fileId, name, table }) => <div key={`${fileId}:${table.sheet}`}><TableMappingEditor name={name} table={table} disabled={starting || busy} onApply={async (mapping) => { if (!draft.current) return; setBusy(true); const result = await setFileTableMapping(draft.current.screenId, fileId, table.sheet, mapping); setBusy(false); if (!result.ok) setNotice(result.error); else await review(); }}/>{table.kind === "metadata" && <button type="button" disabled={starting || busy || !tables.length} className="mt-2 rounded border border-line px-3 py-1.5 text-[12px] text-ink" onClick={() => { try { const next = applySampleMetadata(tables, table.records ?? [], table.mapping?.sample_column); setTables(next); setComparisons(suggestComparisons(next)); setNotice(`Applied ${table.rows_seen} sample metadata rows. Review the suggested comparisons.`); } catch (error) { setNotice(error instanceof Error ? error.message : "Sample metadata could not be matched."); } }}>Apply sample sheet {table.sheet}</button>}</div>)}</details>;
  if (stage === "plan") return <div className="space-y-4"><PhaseRail stage={stage}/><section className="rounded-xl border border-line bg-white p-4"><h3 className="text-sm font-medium text-ink">Confirm analysis plan</h3><p className="mt-2 text-[12px] text-ink">{name || "Your screen"}: {contrastName({ name, cell_line: cellLine, phenotype, modality, library_id: libraryId, samples })}</p><dl className="mt-3 grid gap-3 text-[12px] sm:grid-cols-2"><div><dt className="text-muted">Methods</dt><dd>{settings.hit_callers.map((caller) => HIT_CALLER_LABEL[caller]).join(", ")}</dd></div><div><dt className="text-muted">Normalization and FDR</dt><dd>{settings.normalization}, {settings.fdr_threshold}</dd></div><div><dt className="text-muted">Included samples</dt><dd>{samples.filter((sample) => sample.included !== false).length}</dd></div><div><dt className="text-muted">Library</dt><dd>{[...libraries, ...customLibraries].find((library) => library.id === libraryId)?.name}</dd></div></dl><label className="mt-4 flex items-center gap-2 text-[12px] text-ink"><input aria-label="Confirm reviewed analysis plan" type="checkbox" checked={planConfirmed} onChange={(event) => setPlanConfirmed(event.target.checked)} disabled={starting}/>I reviewed the inputs, sample mapping and analysis plan</label><div className="mt-4 flex gap-2"><button type="button" onClick={() => void start()} disabled={starting || !planConfirmed} className="h-9 rounded-md bg-ink px-4 text-[12px] text-white disabled:bg-mist disabled:text-muted">{starting ? "Working..." : "Run analysis"}</button><button type="button" disabled={starting} onClick={() => { setStage("design"); setPlanConfirmed(false); }} className="rounded-md border border-line px-3 text-[12px] text-ink">Edit plan</button></div>{notice && <p role="alert" className="mt-3 text-[12px] text-orange-700">{notice}</p>}</section></div>;
  if (stage === "experiment") return <div className="space-y-4"><PhaseRail stage={stage}/><DropZone compact onFiles={(files) => void onFiles(files)} disabled={busy || starting}/><FileList items={items} onRemove={(key) => void onRemove(key)} onRetry={(key) => void retryUpload(key)} busy={busy || starting}/>{interpretations}<FileInspection files={reviewedFiles}/>{notice && <p role="status" className="rounded-lg border border-line p-3 text-[12px] text-body">{notice}</p>}{aliases.length > 0 && <section className="rounded-xl border border-orange-200 bg-white p-4"><h3 className="text-sm font-medium text-ink">Confirm guide ID mapping</h3><p className="mt-1 text-[12px] text-muted">These count IDs do not exactly match the library. Review the proposed matches before running.</p>{aliases.map((alias, index) => <label key={alias.source} className="mt-2 flex items-center gap-3 text-[12px] text-ink"><span className="min-w-32">{alias.source}</span><input aria-label={`Map ${alias.source}`} value={alias.target} onChange={(event) => { setAliases((current) => current.map((row, i) => i === index ? { ...row, target: event.target.value } : row)); setAliasesConfirmed(false); }} className="h-8 min-w-0 flex-1 rounded border border-line px-2"/></label>)}<button type="button" disabled={starting || aliases.some((alias) => !alias.target)} onClick={() => setAliasesConfirmed(true)} className="mt-3 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink">{aliasesConfirmed ? "Mapping confirmed" : "Confirm guide mapping"}</button></section>}<ExperimentReview mappingReady={aliasesConfirmed} tables={tables} onTables={setTables} comparisons={comparisons} onChange={setComparisons} libraryUploads={libraryUploads} libraries={[...libraries, ...customLibraries]} libraryId={libraryId} onLibrary={setLibraryId} onImport={importLibrary} onFiles={onFiles} settings={settings} onSettings={setSettings} disabled={starting} onStart={() => void startExperiment()}/></div>;

  // -------------------------------------------------------------------------

  if (stage === "analysing" && started) {
    return (
      <div className="space-y-4">
        <PhaseRail stage={stage} />
        <div className="flex flex-col items-start gap-3 rounded-xl border border-cyan-100 bg-cyan-50/50 p-5">
          <span className="flex items-center gap-2 text-[13px] font-medium text-cyan-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {name || "Your screen"} is analysing
          </span>
          <p className="max-w-prose text-[12.5px] leading-snug text-body">
            The runs are queued. Each screen shows progress as the worker completes its stages.
          </p>
          {experimentScreens.length > 0 && draft.current && <Link href={`/dashboard/experiments/${draft.current.screenId}`} className="text-[12px] font-medium text-cyan-700 hover:underline">Compare experiment rankings</Link>}
          {experimentScreens.length > 0 && <ul className="space-y-1">{experimentScreens.map((screen) => <li key={screen.screenId}><Link href={`/dashboard/screens/${screen.screenId}`} className="text-[12px] text-cyan-700 hover:underline">{screen.name}</Link></li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/dashboard/screens/${started.screenId}`}
              className="inline-flex h-8 items-center rounded-md bg-ink px-3 text-[12px] font-medium text-white hover:bg-ink/90"
            >
              Open the screen
            </Link>
            <button
              type="button"
              onClick={() => {
                draft.current = null;
                draftPromise.current = null;
                blobs.current.clear();
                kinds.current.clear();
                setItems([]);
                setSamples([]);
                setDetected([]);
                setName("");
                setStarted(null);
                setStage("drop");
              }}
              className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[12px] text-ink hover:bg-mist-soft"
            >
              Add another screen
            </button>
          </div>
        </div>
      </div>
    );
  }

  const uploading = items.some((item) => item.status === "uploading" || item.status === "recording");
  const ready = items.length > 0 && items.every((item) => item.status === "done" || item.status === "failed");
  const landed = items.filter((item) => item.status === "done").length;
  const design = { name, cell_line: cellLine, phenotype, modality, library_id: libraryId, samples };
  const designFiles = items.map((item) => ({
    id: item.fileId ?? item.key,
    name: item.name,
    bytes: item.bytes,
    kind: item.kind,
    compressed: false,
    storage_key: "",
    checksum_sha256: item.checksum,
    status: item.status === "done" ? ("complete" as const) : ("pending" as const),
  }));
  const problems = stage === "design" || stage === "confirm" ? checkDesign(design, designFiles) : [];
  const selectedLibrary = detected[0]?.name ?? libraries.find((library) => library.id === libraryId)?.name ?? "Not fixed yet";

  return (
    <div className="space-y-4">
      <PhaseRail stage={stage} />

      {stage === "drop" ? (
        <DropZone onFiles={(files) => void onFiles(files)} disabled={busy} compact={items.length > 0} />
      ) : (
        <DropZone onFiles={(files) => void onFiles(files)} disabled={busy || starting} compact />
      )}

      <FileList onRetry={(key) => void retryUpload(key)} items={items} onRemove={(key) => void onRemove(key)} busy={busy || starting} onPurpose={stage === "drop" ? async (key, kind) => {
        const item = items.find((row) => row.key === key);
        if (!draft.current || !item?.fileId) return;
        setBusy(true);
        const result = await setUploadedFilePurpose(draft.current.screenId, item.fileId, kind);
        setBusy(false);
        if (!result.ok) setNotice(result.error);
        else { setItems((current) => current.map((row) => row.key === key ? { ...row, kind } : row)); kinds.current.set(key, kind); setReviewedFiles([]); setSourceTables([]); }
      } : undefined}/>

      <FileInspection files={reviewedFiles}/>
      {sourceTables.length > 0 && interpretations}
      {notice && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-orange-50 px-2.5 py-1.5 text-[12px] leading-snug text-orange-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      {stage === "confirm" && samples.length > 0 && (
        <ConfirmationCard
          library={selectedLibrary}
          samples={samples}
          comparison={contrastName(design)}
          disabled={starting}
          onLooksRight={() => { setNotice(null); setPlanConfirmed(false); setStage("plan"); }}
          onEdit={() => setStage("design")}
        />
      )}

      {stage === "design" && samples.length > 0 && (
        <>
          <hr className="border-line" />
          <UploadedLibraryImport uploads={libraryUploads} disabled={starting} onImport={importLibrary}/>
          <DesignForm
            name={name}
            cellLine={cellLine}
            phenotype={phenotype}
            modality={modality}
            libraryId={libraryId}
            samples={samples}
            settings={settings}
            libraries={[...libraries, ...customLibraries]}
            detected={detected}
            defaultsFromWorkspace
            disabled={starting}
            onChange={(next) => {
              if (next.name !== undefined) setName(next.name);
              if (next.cellLine !== undefined) setCellLine(next.cellLine);
              if (next.phenotype !== undefined) setPhenotype(next.phenotype);
              if (next.modality !== undefined) setModality(next.modality);
              if (next.libraryId !== undefined) setLibraryId(next.libraryId);
              if (next.samples !== undefined) setSamples(next.samples);
              if (next.settings !== undefined) setSettings(next.settings);
            }}
          />
        </>
      )}

      {/* One primary action, and it changes with the step rather than
          multiplying into three buttons that are all nearly the same. */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {stage === "drop" ? (
            <button
              type="button"
              onClick={() => void review()}
              disabled={!ready || landed === 0 || busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12px] font-medium text-white hover:bg-ink/90 disabled:bg-mist disabled:text-muted"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {uploading ? "Uploading" : "Describe the experiment"}
            </button>
          ) : stage === "design" ? (
            <button
              type="button"
              onClick={() => { setNotice(null); setPlanConfirmed(false); setStage("plan"); }}
              disabled={starting || problems.length > 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12px] font-medium text-white hover:bg-ink/90 disabled:bg-mist disabled:text-muted"
            >
              {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Start the analysis
            </button>
          ) : null}

          {(stage === "design" || stage === "confirm") && problems.length > 0 && (
            <span className="text-[11.5px] leading-snug text-orange-700">{problems[0].message}</span>
          )}
          {(stage === "design" || stage === "confirm") && problems.length === 0 && (
            <span className="text-[11.5px] text-muted">Will test {contrastName(design)}.</span>
          )}

          <button
            type="button"
            onClick={() => void discard()}
            disabled={busy || starting}
            className="ml-auto inline-flex items-center gap-1 rounded-sm text-[11.5px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" /> Discard
          </button>
        </div>
      )}
    </div>
  );
}
