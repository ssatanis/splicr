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
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDraftScreen,
  saveIntakeDraft,
  checkLibraryCompatibility,
  type InspectedFile,
  setFileTableMapping,
  inspectScreenFiles,
  importCustomLibrary,
  startExperimentAnalysis,
  registerUploadedFile,
  removeUploadedFile,
  setUploadedFilePurpose,
  startScreenAnalysis,
} from "@/lib/intake/actions";
import {
  DEFAULT_LIBRARY,
  defaultMle,
  type LibraryImportOptions,
} from "@/lib/intake/analysis-plan";
import { TableMappingEditor } from "./table-mapping";
import type { ParsedTable } from "@/lib/intake/tables";
import { expandExperimentFiles } from "@/lib/intake/archive";
import { hashFile } from "@/lib/intake/checksum";
import {
  applySampleMetadata,
  suggestComparisons,
  tableSamples,
  type ExperimentTable,
  type ExperimentComparison,
} from "@/lib/intake/experiment";
import {
  ExperimentReview,
  UploadedLibraryImport,
  comparisonSamples,
  type LibraryUpload,
} from "./experiment-review";
import { deriveSamples } from "@/lib/intake/derive";
import { publishedStudyTable } from "@/lib/intake/published-study";
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  storageKey,
  classify,
  looksCompressed,
  type IntakeKind,
} from "@/lib/intake/shape";
import { uploadFile } from "@/lib/intake/upload";
import { type Modality } from "@/lib/data/types";

import { type AnalysisSettings, type LibraryChoice } from "./design-form";
import { DropZone } from "./drop-zone";
import { FileList, type UploadItem } from "./file-list";
import {
  localDate,
  dateFromFiles,
  nameFromFiles,
  confidentLibrary,
  sampleFactors,
} from "@/lib/intake/inference";

const CONCURRENCY = 2;

export interface SavedIntake {
  tables?: ExperimentTable[];
  comparisons?: ExperimentComparison[];
  settings?: AnalysisSettings;
  libraryId?: string | null;
  libraryLabel?: string;
  customLibraries?: LibraryChoice[];
  imported?: Record<string, string>;
  metadataApplied?: string[];
}

interface Props {
  researchers: { id: string; name: string }[];
  currentResearcher: string;
  libraries: LibraryChoice[];
  defaults: AnalysisSettings & { modality: Modality; librarySlug: string | null };
  librarySlugToId: Record<string, string>;
  initialDraft?: {
    screenId: string;
    orgId: string;
    name: string;
    files: UploadItem[];
    config?: SavedIntake;
    experimentDate?: string;
    researcherId?: string;
  };
}

type Stage = "drop" | "analysing";

const PHASES = [
  "Data Ingestion",
  "Library & Mapping",
  "Experimental Design",
  "Pipeline & Launch",
] as const;

type WizardStep = 1 | 2 | 3 | 4;

function PhaseRail({
  step,
  onStep,
  disabled = false,
}: {
  step: WizardStep;
  onStep?: (step: WizardStep) => void;
  disabled?: boolean;
}) {
  const active = step - 1;
  return (
    <ol aria-label="Analysis progress" className="grid grid-cols-4 gap-2 py-1">
      {PHASES.map((phase, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li
            key={phase}
            aria-current={current ? "step" : undefined}
            className="flex min-w-0 flex-col gap-2"
          >
            <div
              className={`h-0.5 rounded-full ${done || current ? "bg-navy" : "bg-line"}`}
            />
            <button
              type="button"
              aria-label={`${index + 1} ${phase}`}
              aria-current={current ? "step" : undefined}
              disabled={disabled || !onStep || index > active}
              onClick={() => onStep?.((index + 1) as WizardStep)}
              className={`flex items-center gap-1.5 text-left text-[10px] sm:text-[11.5px] ${current ? "font-medium text-navy" : "text-muted"}`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${current ? "bg-navy text-white" : done ? "bg-navy-tint text-navy" : "bg-mist-soft text-muted"}`}
              >
                {done ? (
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              {phase}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function UploadFlow({
  libraries,
  defaults,
  librarySlugToId,
  initialDraft,
  researchers,
  currentResearcher,
}: Props) {
  const router = useRouter();

  const [items, setItems] = useState<UploadItem[]>(initialDraft?.files ?? []);
  const [stage, setStage] = useState<Stage>("drop");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const accepting = useRef(false);
  const [started, setStarted] = useState<{ screenId: string } | null>(null);

  const [aliases, setAliases] = useState<{ source: string; target: string }[]>([]);
  const [aliasesConfirmed, setAliasesConfirmed] = useState(true);
  const [sourceTables, setSourceTables] = useState<
    { fileId: string; name: string; table: Omit<ParsedTable, "guides"> }[]
  >([]);
  const [tables, setTables] = useState<ExperimentTable[]>(
    initialDraft?.config?.tables ?? [],
  );
  const [comparisons, setComparisons] = useState<ExperimentComparison[]>(
    initialDraft?.config?.comparisons ?? [],
  );
  const [libraryUploads, setLibraryUploads] = useState<LibraryUpload[]>([]);
  const [customLibraries, setCustomLibraries] = useState<LibraryChoice[]>(
    initialDraft?.config?.customLibraries ?? [],
  );
  const [experimentScreens, setExperimentScreens] = useState<
    { screenId: string; name: string }[]
  >([]);
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [experimentDate, setExperimentDate] = useState(
    initialDraft?.experimentDate || localDate(),
  );
  const [researcherId, setResearcherId] = useState(
    initialDraft?.researcherId || currentResearcher,
  );
  const [libraryLabel, setLibraryLabel] = useState(
    initialDraft?.config?.libraryLabel ?? "",
  );
  const dateEdited = useRef(Boolean(initialDraft?.experimentDate));
  const nameEdited = useRef(Boolean(initialDraft?.config));
  const libraryEdited = useRef(Boolean(initialDraft?.config?.libraryId));
  const metadataApplied = useRef(new Set(initialDraft?.config?.metadataApplied ?? []));
  const imported = useRef<Record<string, string>>(initialDraft?.config?.imported ?? {});
  const [inspections, setInspections] = useState<InspectedFile[]>([]);
  const [compatibility, setCompatibility] = useState<{
    checked: number;
    matched: number;
    unmatched: string[];
    readMatch: number | null;
  } | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchRevision, setMatchRevision] = useState(0);
  const cellLine = "";

  const [modality, setModality] = useState<Modality>(
    initialDraft?.config?.settings?.modality ?? defaults.modality,
  );
  const [libraryId, setLibraryId] = useState<string | null>(
    initialDraft?.config?.libraryId ??
      (defaults.librarySlug ? (librarySlugToId[defaults.librarySlug] ?? null) : null),
  );
  const [settings, setSettings] = useState<AnalysisSettings>(
    initialDraft?.config?.settings ?? {
      normalization: defaults.normalization,
      hit_callers: [
        ...new Set([
          "mageck_rra" as const,
          ...defaults.hit_callers.filter((caller) => caller !== "chronos"),
        ]),
      ],
      fdr_threshold: defaults.fdr_threshold,
      cn_correction: false,
    },
  );

  // Not state: the File handles and the draft identity are read inside async
  // work that must not re-run when a progress bar moves.
  const blobs = useRef(new Map<string, File>());
  const kinds = useRef(new Map<string, IntakeKind>());
  const aborts = useRef(new Map<string, AbortController>());
  const draft = useRef<{ screenId: string; orgId: string } | null>(
    initialDraft ? { screenId: initialDraft.screenId, orgId: initialDraft.orgId } : null,
  );
  const draftPromise = useRef<Promise<{ screenId: string; orgId: string } | null> | null>(
    null,
  );

  const patch = useCallback((key: string, next: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...next } : item)),
    );
  }, []);

  /** One draft per visit, even if six files are dropped in the same tick. */
  const ensureDraft = useCallback(
    async (initialName?: string) => {
      if (draft.current) return draft.current;
      if (!draftPromise.current) {
        draftPromise.current = createDraftScreen(name || initialName || "Untitled screen")
          .then((result) => {
            if (!result.ok) {
              setNotice(result.error);
              draftPromise.current = null;
              return null;
            }
            draft.current = { screenId: result.screenId, orgId: result.orgId };
            return draft.current;
          })
          .catch((error) => {
            const message =
              error instanceof Error
                ? error.message
                : "Your workspace could not be reached.";
            setNotice(message);
            draftPromise.current = null;
            return null;
          });
      }
      return draftPromise.current;
    },
    [name],
  );

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
        if (!digest)
          throw new Error(
            "The upload finished, but the checksum could not be computed. Add this file again.",
          );
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
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, queue.length) },
        async () => {
          for (;;) {
            const key = queue.shift();
            if (!key) return;
            await sendOne(key);
          }
        },
      );
      await Promise.all(workers);
    },
    [sendOne],
  );

  const onFiles = useCallback(
    async (files: File[], stay = false) => {
      if (accepting.current) return;
      accepting.current = true;
      setBusy(true);
      setNotice(null);
      try {
        const expanded: File[] = [];
        const warnings: string[] = [];
        for (const file of files) {
          try {
            expanded.push(...(await expandExperimentFiles([file])));
          } catch (error) {
            expanded.push(file);
            warnings.push(
              `${file.name} will be retained as an archive. ${error instanceof Error ? error.message : "Its contents could not be unpacked."}`,
            );
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
            refused.push(
              `${file.name} (${file.size > MAX_FILE_BYTES ? "exceeds 50 GB" : "file name is too long"})`,
            );
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

        if (
          new Set([
            ...items.map((item) => storageKey("", "", item.name)),
            ...taking.map((entry) => storageKey("", "", entry.file.name)),
          ]).size !==
          items.length + taking.length
        ) {
          setNotice(
            "Two files resolve to the same storage name. Rename one so each upload keeps its own source.",
          );
          return;
        }
        if (!nameEdited.current)
          setName(
            nameFromFiles([
              ...items.map((item) => item.name),
              ...taking.map((entry) => entry.file.name),
            ]),
          );
        if (!dateEdited.current) {
          const detectedDate = dateFromFiles(taking.map((entry) => entry.file.name));
          if (detectedDate) setExperimentDate(detectedDate);
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

        const context = await ensureDraft(
          nameFromFiles([
            ...items.map((item) => item.name),
            ...taking.map((entry) => entry.file.name),
          ]),
        );
        if (!context) {
          taking.forEach((entry) =>
            patch(entry.key, {
              status: "failed",
              error: "Could not create an upload draft. Retry this file.",
            }),
          );
          return;
        }
        // A new source requires a new review before an analysis can start.
        setStage("drop");
        if (!stay) setWizardStep(1);
        setCompatibility(null);
        await pump(taking.map((entry) => entry.key));
      } finally {
        accepting.current = false;
        setBusy(false);
      }
    },
    [ensureDraft, items, patch, pump],
  );

  const retryUpload = useCallback(
    async (key: string) => {
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
    },
    [ensureDraft, sendOne],
  );

  const onRemove = useCallback(
    async (key: string) => {
      aborts.current.get(key)?.abort();
      aborts.current.delete(key);
      const item = items.find((entry) => entry.key === key);
      if (item?.fileId && draft.current) {
        setBusy(true);
        try {
          const result = await removeUploadedFile(draft.current.screenId, item.fileId);
          if (!result.ok) {
            setNotice(result.error);
            return;
          }
        } catch {
          setNotice("The file could not be removed. Try again.");
          return;
        } finally {
          setBusy(false);
        }
      }
      setItems((current) => current.filter((entry) => entry.key !== key));
      setSourceTables([]);
      setCompatibility(null);
      setStage("drop");
      setWizardStep(1);
      blobs.current.delete(key);
      kinds.current.delete(key);
    },
    [items],
  );

  /** Read the stored bytes back and turn them into a design to confirm. */
  const review = useCallback(async () => {
    const context = draft.current;
    if (!context) return false;
    setBusy(true);
    setNotice(null);

    try {
      const result = await inspectScreenFiles(context.screenId).catch(() => ({
        ok: false as const,
        error: "File inspection could not finish. Try again.",
      }));
      if (!result.ok) {
        setNotice(result.error);
        return false;
      }

      for (const file of result.files) {
        const item = items.find((row) => row.fileId === file.fileId);
        if (item) kinds.current.set(item.key, file.kind);
      }
      setItems((current) =>
        current.map((item) => {
          const file = result.files.find((row) => row.fileId === item.fileId);
          return file ? { ...item, kind: file.kind } : item;
        }),
      );
      setInspections(result.files);
      setSourceTables(
        result.files.flatMap((file) =>
          file.shape?.kind === "tables"
            ? file.shape.tables.map((table) => ({
                fileId: file.fileId,
                name: file.name,
                table,
              }))
            : file.shape?.kind === "counts" && file.shape.table
              ? [{ fileId: file.fileId, name: file.name, table: file.shape.table }]
              : [],
        ),
      );
      const unreadable = result.files.filter((file) => file.error);
      if (unreadable.length)
        setNotice(
          "Some files need review. Inspect them to correct their purpose or replace their contents.",
        );

      const experimentTables: ExperimentTable[] = [];
      const importedTables: LibraryUpload[] = [];
      for (const file of result.files) {
        if (file.shape?.kind !== "tables") continue;
        for (const table of file.shape.tables) {
          if (table.kind === "counts")
            experimentTables.push({
              fileId: file.fileId,
              name: file.name,
              sheet: table.sheet,
              model:
                table.sheet === "Table"
                  ? ""
                  : table.sheet.replace(/(?:gRNA|raw|counts?|sheet\d+)/gi, "").trim(),
              mapping: table.mapping,
              samples: tableSamples(table.sample_columns),
              rows: table.rows_seen,
              preview: table.preview,
              warnings: [
                ...table.warnings,
                "Sample roles and early timepoints are suggestions. Confirm against your experiment.",
              ],
            });
          if (table.kind === "library")
            importedTables.push({
              fileId: file.fileId,
              name: file.name,
              sheet: table.sheet,
              rows: table.rows_seen,
              preview: table.preview,
              warnings: table.warnings,
            });
        }
      }
      for (const file of result.files) {
        if (file.shape?.kind === "counts" && file.kind !== "library") {
          experimentTables.push({
            fileId: file.fileId,
            name: file.name,
            sheet: "Table",
            model: cellLine,
            samples: tableSamples(file.shape.sample_columns),
            rows: file.shape.rows_seen,
            preview: file.shape.preview,
            warnings: [],
          });
        }
      }

      for (let i = 0; i < experimentTables.length; i++) {
        const file = result.files.find((file) => file.fileId === experimentTables[i].fileId);
        experimentTables[i] = publishedStudyTable(experimentTables[i], file?.checksum_sha256);
      }
      if (experimentTables.some((table) => table.study) && !tables.length && !initialDraft?.config) {
        if (!nameEdited.current) setName("Ferrarone 2024: A549 LKB1 growth screens");
        setSettings((current) => ({
          ...current, modality: "knockout", organism_taxid: 9606,
          model_type: "cancer_cell_line", profile: "pooled_abundance",
          normalization: "median", fdr_threshold: 0.05,
          hit_callers: ["mageck_rra", "mageck_mle"],
          drugz_paired: false, cn_correction: false,
        }));
      }

      let importedLibraryId: string | null = null;
      if (importedTables.length === 1) {
        const upload = importedTables[0];
        const token = `${upload.fileId}:${upload.sheet}:${JSON.stringify(result.files.flatMap((file) => (file.fileId === upload.fileId && file.shape?.kind === "tables" ? file.shape.tables : [])).find((table) => table.sheet === upload.sheet)?.mapping ?? null)}`;
        const cached = imported.current[token];
        if (cached) importedLibraryId = cached;
        else {
          const res = await importCustomLibrary({
            screenId: context.screenId,
            fileId: upload.fileId,
            sheet: upload.sheet,
            sources: upload.sources,
            name: upload.name.replace(/\.[^.]+$/, ""),
            options: DEFAULT_LIBRARY,
          }).catch(() => ({
            ok: false as const,
            error: "The library import could not finish. Retry to resume it.",
          }));
          if (res.ok) {
            imported.current[token] = res.libraryId;
            importedLibraryId = res.libraryId;
            setCustomLibraries((current) => [
              ...current.filter((l) => l.id !== res.libraryId),
              {
                id: res.libraryId,
                name: res.name,
                n_guides: res.nGuides,
                custom: true,
                taxid: 9606,
                modality: "knockout",
              },
            ]);
          } else setNotice(res.error);
        }
      }
      setLibraryUploads(importedTables);
      const fastq = result.files
        .filter((file) => file.shape?.kind === "fastq")
        .map((file) => ({ fileId: file.fileId, name: file.name }));
      const countColumns = result.files.flatMap((file) =>
        file.shape?.kind === "counts" ? file.shape.sample_columns : [],
      );
      const derived = deriveSamples(countColumns, fastq).map((sample) => ({
        ...sample,
        factors: sampleFactors(sample.label),
      }));
      if (!experimentTables.length && fastq.length)
        experimentTables.push({
          fileId: "",
          name: "Sequencing reads",
          sheet: "Sequencing reads",
          model: cellLine,
          samples: derived,
          rows: 0,
          preview: [],
          warnings: [],
        });

      const nextLibraryId = libraryEdited.current
        ? libraryId
        : (importedLibraryId ?? confidentLibrary(result.libraries));
      if (nextLibraryId !== libraryId) {
        setLibraryId(nextLibraryId);
        setLibraryLabel("");
        const chosen = [...libraries, ...customLibraries].find(
          (l) => l.id === nextLibraryId,
        );
        const nextModality =
          importedLibraryId === nextLibraryId ? ("knockout" as const) : chosen?.modality;
        if (nextModality) {
          setModality(nextModality);
          setSettings((current) => ({
            ...current,
            modality: nextModality,
            organism_taxid: chosen?.taxid ?? 9606,
          }));
        }
      }
      if (experimentTables.length) {
        // Preserve explicitly edited samples and comparisons whose source labels still exist.
        const nextTables = experimentTables.map((table) => {
          const previous = tables.find(
            (t) => t.fileId === table.fileId && t.sheet === table.sheet,
          );
          return {
            ...table,
            model: previous?.model || table.model,
            samples: table.samples.map(
              (sample) =>
                previous?.samples.find((s) => s.label === sample.label) ?? sample,
            ),
          };
        });
        for (const file of result.files)
          if (file.shape?.kind === "tables")
            for (const table of file.shape.tables)
              if (table.kind === "metadata") {
                try {
                  const key = `${file.fileId}:${table.sheet}:${JSON.stringify(table.mapping)}`;
                  if (!metadataApplied.current.has(key)) {
                    const applied = applySampleMetadata(
                      nextTables,
                      table.records ?? [],
                      table.mapping?.sample_column,
                    );
                    nextTables.splice(0, nextTables.length, ...applied);
                    metadataApplied.current.add(key);
                  }
                } catch (error) {
                  setNotice(
                    error instanceof Error ? error.message : "Check sample metadata.",
                  );
                }
              }
        const sourceSame =
          tables.length === nextTables.length &&
          tables.every(
            (table, i) =>
              table.fileId === nextTables[i].fileId &&
              table.sheet === nextTables[i].sheet &&
              JSON.stringify(table.samples.map((s) => s.label)) ===
                JSON.stringify(nextTables[i].samples.map((s) => s.label)),
          );
        setTables(nextTables);
        if (!sourceSame || !comparisons.length) {
          const suggested = suggestComparisons(nextTables);
          setComparisons(
            !nextTables[0].fileId
              ? suggested.map((row, i) => ({ ...row, enabled: i === 0 }))
              : suggested,
          );
        }
        return true;
      }

      setTables([]);
      setComparisons([]);
      if (derived.length === 0) {
        setNotice(
          "No samples could be read from these files. A count table needs numeric sample columns.",
        );
        return false;
      }

      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "File inspection could not finish. Try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [cellLine, items, libraryId, tables, comparisons, libraries, customLibraries]);

  const importLibrary = async (
    upload: LibraryUpload,
    customName: string,
    options: LibraryImportOptions,
  ) => {
    if (!draft.current) return;
    setStarting(true);
    setNotice(null);
    const result = await importCustomLibrary({
      screenId: draft.current.screenId,
      fileId: upload.fileId,
      sheet: upload.sheet,
      sources: upload.sources,
      name: customName,
      options,
    }).catch(() => ({
      ok: false as const,
      error: "The library import could not finish. Retry to resume it.",
    }));
    setStarting(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setCustomLibraries((current) => [
      ...current.filter((library) => library.id !== result.libraryId),
      {
        id: result.libraryId,
        name: result.name,
        n_guides: result.nGuides,
        custom: true,
        taxid: options.organism_taxid,
        modality: options.modality,
      },
    ]);
    setLibraryId(result.libraryId);
    setSettings((current) => ({
      ...current,
      modality: options.modality,
      organism_taxid: options.organism_taxid,
    }));
    setModality(options.modality);
    setAliases(result.aliases);
    setAliasesConfirmed(result.aliases.length === 0);
    setLibraryLabel(customName);
    libraryEdited.current = true;
  };
  const startExperiment = async () => {
    if (!draft.current || !aliasesConfirmed) return;
    setStarting(true);
    setNotice(null);
    const saved = await persist();
    if (!saved) {
      setStarting(false);
      return;
    }
    const selected = comparisons.filter((row) => row.enabled);
    if (!tables[0]?.fileId) {
      if (selected.length !== 1) {
        setNotice("Choose one comparison for this sequencing screen.");
        setStarting(false);
        return;
      }
      const row = selected[0];
      const chosenSettings = {
        ...settings,
        hit_callers: [
          "mageck_rra" as const,
          ...(settings.hit_callers.includes("mageck_mle") ? ["mageck_mle" as const] : []),
          ...(row.drug
            ? ["drugz" as const]
            : row.fitness && settings.hit_callers.includes("bagel2")
              ? ["bagel2" as const]
              : []),
        ],
        fitness_assay: Boolean(row.fitness) && !row.drug,
        mle_design: settings.hit_callers.includes("mageck_mle")
          ? (row.mle_design ?? defaultMle(tables[0].samples, row.treatment, row.control))
          : undefined,
      };
      const result = await startScreenAnalysis({
        reviewed: true,
        screenId: draft.current.screenId,
        design: {
          name,
          cell_line: row.model,
          phenotype: row.phenotype,
          modality,
          library_id: libraryId,
          samples: comparisonSamples(tables[0], row),
        },
        settings: { ...chosenSettings, lab_evidence: row.lab_evidence ?? settings.lab_evidence ?? {} },
      }).catch(() => ({
        ok: false as const,
        error:
          "The launch response could not be confirmed. Check Screens before starting again.",
      }));
      setStarting(false);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setStarted({ screenId: result.screenId });
      setStage("analysing");
      router.refresh();
      return;
    }
    const result = await startExperimentAnalysis({
      reviewed: true,
      screenId: draft.current.screenId,
      libraryId,
      comparisons: comparisons
        .filter((comparison) => comparison.enabled)
        .map((comparison) => {
          const table = tables[comparison.table];
          const ordered = (labels: string[]) =>
            [...labels].sort(
              (a, b) =>
                (table.samples.find((s) => s.label === a)?.replicate ?? 0) -
                (table.samples.find((s) => s.label === b)?.replicate ?? 0),
            );
          return {
            name: comparison.name,
            model: comparison.model,
            phenotype: comparison.phenotype,
            source: { fileId: table.fileId, sheet: table.sheet },
            treatment: ordered(comparison.treatment),
            control: ordered(comparison.control),
            samples: comparisonSamples(table, { ...comparison, lab_evidence: comparison.lab_evidence ?? settings.lab_evidence }),
            settings: {
              ...settings,
              lab_evidence: comparison.lab_evidence ?? settings.lab_evidence ?? {},
              fitness_assay: Boolean(comparison.fitness) && !comparison.drug,
              mle_design: settings.hit_callers.includes("mageck_mle")
                ? (comparison.mle_design ??
                  defaultMle(
                    table.samples,
                    ordered(comparison.treatment),
                    ordered(comparison.control),
                  ))
                : undefined,
              drugz_options: settings.drugz_options ?? {
                pseudocount: 5,
                half_window_size: 500,
              },

              cn_correction: false,
              hit_callers: [
                "mageck_rra" as const,
                ...(settings.hit_callers.includes("mageck_mle")
                  ? ["mageck_mle" as const]
                  : []),
                ...(comparison.fitness &&
                !comparison.drug &&
                settings.hit_callers.includes("bagel2")
                  ? ["bagel2" as const]
                  : []),
                ...(comparison.drug ? ["drugz" as const] : []),
              ],
              drugz_paired: comparison.drug && settings.drugz_paired,
            },
          };
        }),
    }).catch(() => ({
      ok: false as const,
      error:
        "The launch response could not be confirmed. Check Screens before starting again.",
    }));
    setStarting(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setExperimentScreens(result.screens);
    setStarted({ screenId: result.screens[0].screenId });
    setStage("analysing");
    router.refresh();
  };

  const uploadSignature = items
    .filter((item) => item.status === "done")
    .map((item) => item.fileId)
    .join(":");
  const lastInspection = useRef("");
  useEffect(() => {
    if (
      busy ||
      starting ||
      !uploadSignature ||
      items.some((item) => ["queued", "uploading", "recording"].includes(item.status)) ||
      lastInspection.current === uploadSignature
    )
      return;
    lastInspection.current = uploadSignature;
    void review();
  }, [uploadSignature, busy, starting, items, review]);
  const matchRequest = useRef(0);
  useEffect(() => {
    const request = ++matchRequest.current;
    if (!libraryId || !draft.current || !uploadSignature) {
      setCompatibility(null);
      setAliases([]);
      setAliasesConfirmed(true);
      setMatching(false);
      return;
    }
    setMatching(true);
    setCompatibility(null);
    setAliasesConfirmed(false);
    void checkLibraryCompatibility(draft.current.screenId, libraryId)
      .then((result) => {
        if (request !== matchRequest.current) return;
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        setCompatibility(result);
        setAliases(result.aliases);
        setAliasesConfirmed(result.aliases.length === 0);
      })
      .catch(() => {
        if (request === matchRequest.current)
          setNotice(
            "Library matching could not finish. Choose the library again to retry.",
          );
      })
      .finally(() => {
        if (request === matchRequest.current) setMatching(false);
      });
  }, [libraryId, uploadSignature, sourceTables, matchRevision]);

  const persist = async () => {
    const context = await ensureDraft();
    if (!context) return false;
    const result = await saveIntakeDraft({
      screenId: context.screenId,
      name,
      experimentDate,
      researcherId,
      config: {
        tables,
        comparisons,
        settings,
        libraryId,
        libraryLabel,
        customLibraries,
        imported: imported.current,
        metadataApplied: [...metadataApplied.current],
      },
    }).catch(() => ({
      ok: false as const,
      error: "The draft save could not finish. Your edits are still on this page.",
    }));
    if (!result.ok) setNotice(result.error);
    return result.ok;
  };
  const inspectFile = (item: UploadItem) => {
    const file = inspections.find((file) => file.fileId === item.fileId);
    return (
      <>
        <label className="flex items-center gap-2 text-[12px] text-body">
          File purpose
          <select
            aria-label={`Purpose of ${item.name}`}
            value={item.kind}
            disabled={busy || starting}
            className="h-8 rounded-md border border-line bg-white px-2 text-[12px]"
            onChange={async (event) => {
              if (!draft.current || !item.fileId) return;
              setBusy(true);
              const result = await setUploadedFilePurpose(
                draft.current.screenId,
                item.fileId,
                event.target.value as IntakeKind,
              ).catch(() => ({
                ok: false as const,
                error: "The file purpose could not be saved. Try again.",
              }));
              setBusy(false);
              if (!result.ok) setNotice(result.error);
              else await review();
            }}
          >
            <option value="counts">Screen counts</option>
            <option value="fastq">Sequencing reads</option>
            <option value="library">Guide library</option>
            <option value="context">Supporting file</option>
          </select>
        </label>
        {!file && <p className="text-[12px] text-muted">Reading file contents…</p>}
        {file?.error && (
          <p role="alert" className="text-[12px] text-orange-700">
            {file.error}
          </p>
        )}
        {file?.shape?.kind === "fastq" && (
          <>
            <p className="text-[12px] text-muted">
              {file.shape.reads_seen.toLocaleString()} reads inspected,{" "}
              {file.shape.read_length ?? "Variable"} bases per read
            </p>
            <pre className="overflow-x-auto bg-canvas p-2 text-[11px]">
              {file.shape.first_read}
            </pre>
          </>
        )}
        {file?.shape?.kind === "context" && (
          <>
            <p className="text-[12px] text-muted">{file.shape.note}</p>
            {file.shape.text && (
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words bg-canvas p-3 font-sans text-[12px]">
                {file.shape.text}
              </pre>
            )}
          </>
        )}
        {sourceTables
          .filter((source) => source.fileId === item.fileId)
          .map(({ fileId, name, table }) => (
            <TableMappingEditor
              key={`${fileId}:${table.sheet}:${JSON.stringify(table.mapping)}`}
              name={name}
              table={table}
              disabled={busy || starting}
              onApply={async (mapping) => {
                if (!draft.current) return;
                setBusy(true);
                try {
                  const result = await setFileTableMapping(
                    draft.current.screenId,
                    fileId,
                    table.sheet,
                    mapping,
                  ).catch(() => ({
                    ok: false as const,
                    error: "The file mapping could not be saved. Try again.",
                  }));
                  if (!result.ok) setNotice(result.error);
                  else await review();
                } finally {
                  setBusy(false);
                }
              }}
            />
          ))}
      </>
    );
  };
  if (stage === "analysing" && started) {
    return (
      <div className="space-y-4">
        <PhaseRail step={4} />
        <div className="flex flex-col items-start gap-3 rounded-sm border border-cyan-100 bg-cyan-50/50 p-5">
          <span className="flex items-center gap-2 text-[13px] font-medium text-cyan-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {name || "Your screen"} is analysing
          </span>
          <p className="max-w-prose text-[12.5px] leading-snug text-body">
            The runs are queued. Each screen shows progress as the worker completes its
            stages.
          </p>
          {experimentScreens.length > 0 && draft.current && (
            <Link
              href={`/dashboard/experiments/${draft.current.screenId}`}
              className="text-[12px] font-medium text-cyan-700 hover:underline"
            >
              Compare experiment rankings
            </Link>
          )}
          {experimentScreens.length > 0 && (
            <ul className="space-y-1">
              {experimentScreens.map((screen) => (
                <li key={screen.screenId}>
                  <Link
                    href={`/dashboard/screens/${screen.screenId}`}
                    className="text-[12px] text-cyan-700 hover:underline"
                  >
                    {screen.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
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
                setName("");
                setStarted(null);
                setStage("drop");
                setWizardStep(1);
                setTables([]);
                setComparisons([]);
                setCustomLibraries([]);
                setLibraryUploads([]);
                setAliases([]);
                setAliasesConfirmed(true);
                setSourceTables([]);
              }}
              className="inline-flex h-8 items-center rounded-md border border-stone-200 px-3 text-[12px] text-ink hover:bg-mist-soft"
            >
              Add another screen
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleNext = async () => {
    if (busy || starting || wizardStep === 4) return;
    if (wizardStep === 1 && !tables.length && !(await review())) return;
    setWizardStep((current) => (current + 1) as WizardStep);
  };
  const handleBack = () =>
    setWizardStep((current) => Math.max(current - 1, 1) as WizardStep);
  const ready =
    items.length > 0 &&
    items.every((item) => item.status === "done" || item.status === "failed");
  const landed = items.filter((item) => item.status === "done").length;

  const isNextDisabled = () => {
    if (busy || starting) return true;
    if (wizardStep === 1) return !ready || landed === 0 || busy || starting;
    if (wizardStep === 2)
      return (
        !libraryId ||
        !aliasesConfirmed ||
        matching ||
        !compatibility ||
        (compatibility.checked > 0 &&
          compatibility.matched / compatibility.checked < 0.95) ||
        (compatibility.readMatch !== null && compatibility.readMatch < 0.5)
      );
    if (wizardStep === 3)
      return (
        !name.trim() ||
        !researcherId ||
        !experimentDate ||
        (!tables[0]?.fileId && comparisons.filter((row) => row.enabled).length !== 1) ||
        !comparisons.some((row) => row.enabled) ||
        comparisons.some(
          (row) => row.enabled && (!row.treatment.length || !row.control.length),
        ) ||
        starting
      );
    if (wizardStep === 4) return starting;
    return false;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 bg-canvas p-4 sm:p-6">
      <PhaseRail step={wizardStep} onStep={setWizardStep} disabled={busy || starting} />

      {wizardStep === 1 && (
        <div className="space-y-6">
          <DropZone
            compact={items.length > 0}
            onFiles={(files) => void onFiles(files)}
            disabled={busy || starting}
          />
          <FileList
            items={items}
            onRemove={(key) => void onRemove(key)}
            onRetry={(key) => void retryUpload(key)}
            busy={busy || starting}
            inspection={inspectFile}
          />
        </div>
      )}

      {wizardStep === 2 && (
        <div className="space-y-6">
          <section className="rounded-sm border border-stone-200 bg-white p-5">
            <h3 className="text-sm font-medium text-ink">Guide library</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                aria-label="Experiment guide library"
                value={libraryId ?? ""}
                disabled={starting || busy || matching}
                onChange={(event) => {
                  libraryEdited.current = true;
                  setLibraryId(event.target.value || null);
                  setLibraryLabel("");
                  const chosen = [...libraries, ...customLibraries].find(
                    (l) => l.id === event.target.value,
                  );
                  if (chosen?.modality) {
                    setModality(chosen.modality);
                    setSettings((current) => ({
                      ...current,
                      modality: chosen.modality,
                      organism_taxid: chosen.taxid,
                    }));
                  }
                }}
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-2 text-[12px] text-ink"
              >
                <option value="">Choose a guide library</option>
                {[
                  ...new Map(
                    [...libraries, ...customLibraries].map((l) => [l.id, l]),
                  ).values(),
                ].map((library) => (
                  <option
                    key={library.id}
                    value={library.id}
                    disabled={library.n_guides < 1}
                  >
                    {library.name}, {library.n_guides.toLocaleString()} guides
                  </option>
                ))}
              </select>
              <label className="flex h-9 cursor-pointer items-center rounded-md border border-line px-3 text-[12px] text-ink">
                Upload library
                <input
                  aria-label="Upload guide library"
                  type="file"
                  className="sr-only"
                  accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json,.gz"
                  onChange={(event) => {
                    if (event.target.files?.length) {
                      libraryEdited.current = false;
                      void onFiles(Array.from(event.target.files), true);
                    }
                    event.target.value = "";
                  }}
                  disabled={starting || busy}
                />
              </label>
            </div>
            {matching ? (
              <p role="status" className="mt-2 text-[12px] text-muted">
                Checking guides against this library…
              </p>
            ) : (
              compatibility && (
                <p className="mt-2 text-[12px] text-muted">
                  {compatibility.checked
                    ? `${compatibility.matched.toLocaleString()} of ${compatibility.checked.toLocaleString()} checked guide IDs match.`
                    : compatibility.readMatch !== null
                      ? `${Math.round(compatibility.readMatch * 100)}% of sampled reads match this library.`
                      : "Library selected."}
                </p>
              )
            )}
            <button
              type="button"
              disabled={matching || busy}
              onClick={() => setMatchRevision((value) => value + 1)}
              className="mt-2 text-[11.5px] text-navy disabled:opacity-50"
            >
              Recheck library
            </button>
            {(!libraryId ||
              (compatibility &&
                ((compatibility.checked > 0 &&
                  compatibility.matched / compatibility.checked < 0.95) ||
                  (compatibility.readMatch !== null &&
                    compatibility.readMatch < 0.5)))) && (
              <p className="mt-3 text-[12px] leading-relaxed text-body">
                {libraryId
                  ? "These inputs do not fit the selected library."
                  : "A guide library could not be identified confidently."}{" "}
                Upload the guide map used in this experiment, or choose another library.
              </p>
            )}
            {libraryId && (
              <label className="mt-4 block text-[12px] text-body">
                Library name for this experiment
                <input
                  aria-label="Experiment library name"
                  placeholder={
                    [...libraries, ...customLibraries].find((l) => l.id === libraryId)
                      ?.name
                  }
                  value={libraryLabel}
                  onChange={(event) => setLibraryLabel(event.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-line px-2 text-[12px]"
                />
              </label>
            )}
            {libraryUploads.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-[12px] text-navy">
                  Configure uploaded library
                </summary>
                <UploadedLibraryImport
                  uploads={libraryUploads}
                  disabled={starting || busy || matching}
                  onImport={importLibrary}
                />
              </details>
            )}
          </section>
          <details className="rounded-sm border border-line bg-white p-4">
            <summary className="cursor-pointer text-[12px] text-ink">
              Review file mappings
            </summary>
            <div className="mt-3">
              <FileList
                items={items}
                onRemove={(key) => void onRemove(key)}
                busy={busy || starting}
                inspection={inspectFile}
              />
            </div>
          </details>
          {aliases.length > 0 && (
            <section className="rounded-sm border border-orange-200 bg-white p-6">
              <h3 className="text-sm font-medium text-ink">Confirm guide ID mapping</h3>
              <p className="mt-1 text-[12px] text-muted">
                These count IDs use different labels. Exact guide sequences link them to
                this library. Review the mapping before running.
              </p>
              {aliases.slice(0, 5).map((alias) => (
                <label
                  key={alias.source}
                  className="mt-2 flex items-center gap-3 text-[12px] text-ink"
                >
                  <span className="min-w-32">{alias.source}</span>
                  <input
                    aria-label={`Map ${alias.source}`}
                    value={alias.target}
                    readOnly
                    className="h-8 min-w-0 flex-1 rounded border border-stone-200 px-2"
                  />
                </label>
              ))}
              {aliases.length > 5 && (
                <p className="mt-2 text-[12px] text-muted">
                  Showing the first 5 of {aliases.length.toLocaleString()} exact sequence
                  matches. All matches are saved in the analysis plan.
                </p>
              )}
              <button
                type="button"
                className="mt-3 mr-2 rounded-md border border-line px-3 py-1.5 text-[12px]"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(aliases, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "guide-id-mapping.json";
                  anchor.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download full mapping
              </button>
              <button
                type="button"
                disabled={starting || aliases.some((alias) => !alias.target)}
                onClick={() => setAliasesConfirmed(true)}
                className="mt-3 rounded-md border border-stone-200 px-3 py-1.5 text-[12px] text-ink"
              >
                {aliasesConfirmed ? "Mapping confirmed" : "Confirm guide mapping"}
              </button>
            </section>
          )}
        </div>
      )}

      {wizardStep === 3 && (
        <div className="space-y-4">
          <section className="rounded-sm border border-line bg-white p-5">
            <h3 className="text-sm font-medium text-ink">Experiment details</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] text-body sm:col-span-2">
                Screen name
                <input
                  aria-label="Screen name"
                  value={name}
                  maxLength={200}
                  disabled={starting}
                  onChange={(event) => {
                    nameEdited.current = true;
                    setName(event.target.value);
                  }}
                  className="mt-1 h-9 w-full rounded-md border border-line px-2 text-[12px]"
                />
              </label>
              <label className="text-[12px] text-body">
                Experiment date
                <input
                  aria-label="Experiment date"
                  type="date"
                  value={experimentDate}
                  disabled={starting}
                  onChange={(event) => {
                    dateEdited.current = true;
                    setExperimentDate(event.target.value);
                  }}
                  className="mt-1 h-9 w-full rounded-md border border-line px-2 text-[12px]"
                />
              </label>
              <label className="text-[12px] text-body">
                Researcher
                <select
                  aria-label="Screen researcher"
                  value={researcherId}
                  disabled={starting}
                  onChange={(event) => setResearcherId(event.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-line px-2 text-[12px]"
                >
                  {researchers.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <ExperimentReview
            expressionFiles={items.filter(item => item.status === "done" && item.fileId && /\.(json|tsv|txt)(\.gz)?$/i.test(item.name)).map(item => ({ id: item.fileId!, name: item.name }))}
            key="comparisons"
            step={3}
            mappingReady={aliasesConfirmed}
            tables={tables}
            onTables={setTables}
            comparisons={comparisons}
            onChange={setComparisons}
            libraryUploads={libraryUploads}
            libraries={[...libraries, ...customLibraries]}
            libraryId={libraryId}
            onLibrary={setLibraryId}
            onImport={importLibrary}
            onFiles={onFiles}
            settings={settings}
            onSettings={setSettings}
            disabled={starting}
            onStart={() => void startExperiment()}
          />
        </div>
      )}

      {wizardStep === 4 && (
        <ExperimentReview
            expressionFiles={items.filter(item => item.status === "done" && item.fileId && /\.(json|tsv|txt)(\.gz)?$/i.test(item.name)).map(item => ({ id: item.fileId!, name: item.name }))}
          key="pipeline"
          planContext={{
            name,
            experiment_date: experimentDate,
            researcher_id: researcherId,
            library_name:
              libraryLabel ||
              [...libraries, ...customLibraries].find((l) => l.id === libraryId)?.name,
            guide_aliases: Object.fromEntries(
              aliases.map((alias) => [alias.source, alias.target]),
            ),
            input_files: items
              .filter((item) => item.status === "done")
              .map((item) => ({
                file_id: item.fileId,
                name: item.name,
                sha256: item.checksum,
                bytes: item.bytes,
                kind: item.kind,
              })),
          }}
          step={4}
          mappingReady={aliasesConfirmed}
          tables={tables}
          onTables={setTables}
          comparisons={comparisons}
          onChange={setComparisons}
          libraryUploads={libraryUploads}
          libraries={[...libraries, ...customLibraries]}
          libraryId={libraryId}
          onLibrary={setLibraryId}
          onImport={importLibrary}
          onFiles={onFiles}
          settings={settings}
          onSettings={setSettings}
          disabled={busy || starting}
          onStart={() => void startExperiment()}
        />
      )}

      {notice && (
        <p
          role="status"
          className="rounded-sm border border-orange-200 p-4 text-[13px] text-orange-700 bg-orange-50"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-6">
        <div className="flex gap-3">
          {wizardStep > 1 && (
            <button
              type="button"
              onClick={handleBack}
              disabled={busy || starting}
              className="h-9 rounded-md border border-stone-200 bg-white px-4 text-[13px] font-medium text-ink hover:bg-mist-soft"
            >
              Back
            </button>
          )}
          {wizardStep < 4 ? (
            <button
              type="button"
              onClick={() => void handleNext()}
              disabled={isNextDisabled()}
              className="h-9 rounded-md bg-ink px-4 text-[13px] font-medium text-white hover:bg-ink/90 disabled:bg-mist disabled:text-muted"
            >
              Next Step
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            try {
              if (await persist()) router.push("/dashboard/screens");
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy || starting || !items.length}
          className="h-9 rounded-md border border-stone-200 bg-white px-4 text-[13px] font-medium text-ink hover:bg-mist-soft disabled:opacity-50"
        >
          Save as Draft
        </button>
      </div>
    </div>
  );
}
