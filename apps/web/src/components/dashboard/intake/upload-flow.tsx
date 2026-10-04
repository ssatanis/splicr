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
  discardDraftScreen,
  inspectScreenFiles,
  registerUploadedFile,
  removeUploadedFile,
  startScreenAnalysis,
} from "@/lib/intake/actions";
import { hashFile } from "@/lib/intake/checksum";
import { deriveSamples } from "@/lib/intake/derive";
import {
  CONTROL_ROLES,
  MAX_FILES,
  checkDesign,
  classify,
  contrastName,
  looksCompressed,
  type IntakeKind,
  type IntakeSample,
} from "@/lib/intake/shape";
import { uploadFile } from "@/lib/intake/upload";
import type { Modality } from "@/lib/data/types";

import { DesignForm, type AnalysisSettings, type DetectedLibrary, type LibraryChoice } from "./design-form";
import { DropZone } from "./drop-zone";
import { FileList, type UploadItem } from "./file-list";

const CONCURRENCY = 2;

interface Props {
  libraries: LibraryChoice[];
  defaults: AnalysisSettings & { modality: Modality; librarySlug: string | null };
  librarySlugToId: Record<string, string>;
}

type Stage = "drop" | "confirm" | "design" | "analysing";

const PHASES = ["Uploading", "Checking experiment", "Analysing", "Ready"] as const;

function PhaseRail({ stage }: { stage: Stage }) {
  const active = stage === "drop" ? 0 : stage === "confirm" || stage === "design" ? 1 : 2;
  return (
    <ol aria-label="Analysis progress" className="grid grid-cols-4 overflow-hidden rounded-lg border border-line text-[11px]">
      {PHASES.map((phase, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li
            key={phase}
            className={[
              "border-r border-line px-2 py-1.5 last:border-r-0",
              done ? "bg-cyan-50 text-cyan-700" : current ? "bg-ink text-white" : "bg-white text-muted",
            ].join(" ")}
            aria-current={current ? "step" : undefined}
          >
            {phase}
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

export function UploadFlow({ libraries, defaults, librarySlugToId }: Props) {
  const router = useRouter();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [stage, setStage] = useState<Stage>("drop");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<{ screenId: string } | null>(null);

  const [detected, setDetected] = useState<DetectedLibrary[]>([]);
  const [samples, setSamples] = useState<IntakeSample[]>([]);
  const [name, setName] = useState("");
  const [cellLine, setCellLine] = useState("");
  const [phenotype, setPhenotype] = useState("");
  const [modality, setModality] = useState<Modality>(defaults.modality);
  const [libraryId, setLibraryId] = useState<string | null>(
    defaults.librarySlug ? (librarySlugToId[defaults.librarySlug] ?? null) : null,
  );
  const [settings, setSettings] = useState<AnalysisSettings>({
    normalization: defaults.normalization,
    hit_callers: defaults.hit_callers,
    fdr_threshold: defaults.fdr_threshold,
    cn_correction: defaults.cn_correction,
  });

  // Not state: the File handles and the draft identity are read inside async
  // work that must not re-run when a progress bar moves.
  const blobs = useRef(new Map<string, File>());
  const kinds = useRef(new Map<string, IntakeKind>());
  const aborts = useRef(new Map<string, AbortController>());
  const draft = useRef<{ screenId: string; orgId: string } | null>(null);
  const draftPromise = useRef<Promise<{ screenId: string; orgId: string } | null> | null>(null);

  const patch = useCallback((key: string, next: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...next } : item)));
  }, []);

  /** One draft per visit, even if six files are dropped in the same tick. */
  const ensureDraft = useCallback(async () => {
    if (draft.current) return draft.current;
    if (!draftPromise.current) {
      draftPromise.current = createDraftScreen(name || "Untitled screen").then((result) => {
        if (!result.ok) {
          setNotice(result.error);
          draftPromise.current = null;
          return null;
        }
        draft.current = { screenId: result.screenId, orgId: result.orgId };
        return draft.current;
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

        patch(key, { status: "recording", sent: file.size });
        const digest = await checksum;
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
      setBusy(true);
      const queue = [...keys];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const key = queue.shift();
          if (!key) return;
          await sendOne(key);
        }
      });
      await Promise.all(workers);
      setBusy(false);
    },
    [sendOne],
  );

  const onFiles = useCallback(
    async (files: File[]) => {
      setNotice(null);
      const accepted: { key: string; file: File; kind: IntakeKind }[] = [];
      const refused: string[] = [];

      for (const file of files) {
        const kind = classify(file.name);
        if (kind === null) {
          refused.push(file.name);
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
          `SplicR reads FASTQ and count tables. Not added: ${refused.slice(0, 4).join(", ")}${
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

      if (!name.trim()) {
        const base = taking[0].file.name.replace(/\.(fastq|fq|tsv|txt|csv|counts?|count)(\.gz)?$/i, "");
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

      const context = await ensureDraft();
      if (!context) return;
      await pump(taking.map((entry) => entry.key));
    },
    [ensureDraft, items.length, name, pump],
  );

  const onRemove = useCallback(
    async (key: string) => {
      aborts.current.get(key)?.abort();
      aborts.current.delete(key);
      const item = items.find((entry) => entry.key === key);
      setItems((current) => current.filter((entry) => entry.key !== key));
      blobs.current.delete(key);
      kinds.current.delete(key);
      if (item?.fileId && draft.current) {
        await removeUploadedFile(draft.current.screenId, item.fileId);
      }
    },
    [items],
  );

  /** Read the stored bytes back and turn them into a design to confirm. */
  const review = useCallback(async () => {
    const context = draft.current;
    if (!context) return;
    setBusy(true);
    setNotice(null);

    const result = await inspectScreenFiles(context.screenId);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }

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
    const nextLibraryId = result.libraries.length > 0 && libraryId === null ? result.libraries[0].library_id : libraryId;
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
    if (inferredProblems.length > 0) {
      setNotice(`Needs your input: ${inferredProblems[0].message}`);
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
  }, [cellLine, libraryId, modality, name, phenotype, router, samples, settings]);

  const discard = useCallback(async () => {
    const context = draft.current;
    for (const controller of aborts.current.values()) controller.abort();
    aborts.current.clear();
    if (context) await discardDraftScreen(context.screenId);
    draft.current = null;
    draftPromise.current = null;
    blobs.current.clear();
    kinds.current.clear();
    setItems([]);
    setSamples([]);
    setDetected([]);
    setStage("drop");
    setNotice(null);
    router.refresh();
  }, [router]);

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
            SplicR has started the run. The screen page shows each phase as it finishes.
          </p>
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
        <DropZone onFiles={(files) => void onFiles(files)} disabled={busy} />
      ) : (
        <DropZone onFiles={(files) => void onFiles(files)} disabled={busy || starting} compact />
      )}

      <FileList items={items} onRemove={(key) => void onRemove(key)} busy={busy} />

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
          onLooksRight={() => void start()}
          onEdit={() => setStage("design")}
        />
      )}

      {stage === "design" && samples.length > 0 && (
        <>
          <hr className="border-line" />
          <DesignForm
            name={name}
            cellLine={cellLine}
            phenotype={phenotype}
            modality={modality}
            libraryId={libraryId}
            samples={samples}
            settings={settings}
            libraries={libraries}
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
              onClick={() => void start()}
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
            disabled={starting}
            className="ml-auto inline-flex items-center gap-1 rounded-sm text-[11.5px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" /> Discard
          </button>
        </div>
      )}
    </div>
  );
}
