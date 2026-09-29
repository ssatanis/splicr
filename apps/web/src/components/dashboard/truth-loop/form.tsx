"use client";

/**
 * The outcome form, in a drawer.
 *
 * One form for logging and for amending. When amending, the screen and the gene
 * are shown and not editable: they say what the outcome is about, and changing
 * them would be a different outcome. What can change is what the assay found.
 *
 * The four results are a radio group with each result's meaning printed under
 * its name, because "did not validate" and "inconclusive" get confused at the
 * bench at 6pm and the difference decides whether a gene is dropped from the
 * plan or re-tested.
 */
import { useId, useRef, useState } from "react";

import { RESULT_COPY, OUTCOME_RESULTS, type OutcomeRow } from "@/lib/outcomes/model";
import {
  EMPTY_DRAFT,
  parseOutcomeDraft,
  type OutcomeDraft,
  type OutcomeFormField,
} from "@/lib/outcomes/schema";
import { cn } from "@/lib/utils";

import { ModalDrawer } from "../drawer";
import type { OutcomeAdapter } from "./adapter";

const FIELD =
  "h-8 w-full rounded-md border bg-white px-2 text-[13px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 disabled:bg-mist-soft disabled:text-muted motion-reduce:transition-none";

type Errors = Partial<Record<OutcomeFormField, string>>;

function draftFromRow(row: OutcomeRow): OutcomeDraft {
  return {
    screenId: row.screenId,
    gene: row.gene,
    result: row.result,
    assay: row.assay ?? "",
    nGuides: row.nGuides === null ? "" : String(row.nGuides),
    effectSize: row.effectSize === null ? "" : String(row.effectSize),
    notes: row.notes ?? "",
    evidenceUrl: row.evidenceUrl ?? "",
  };
}

function Labelled({
  label,
  error,
  hint,
  children,
  id,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12px] text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[11px] leading-snug text-orange-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-[11px] leading-snug text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function OutcomeDrawer({
  adapter,
  screens,
  editing,
  prefill,
  canDelete,
  onClose,
  onDone,
}: {
  adapter: OutcomeAdapter;
  screens: { id: string; name: string }[];
  editing: OutcomeRow | null;
  prefill: { gene: string; screenId: string } | null;
  canDelete: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const base = useId();
  const [draft, setDraft] = useState<OutcomeDraft>(() =>
    editing
      ? draftFromRow(editing)
      : { ...EMPTY_DRAFT, gene: prefill?.gene ?? "", screenId: prefill?.screenId ?? (screens.length === 1 ? screens[0].id : "") },
  );
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends keyof OutcomeDraft>(key: K, value: OutcomeDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // The summary line described the last submit, not the text now in the box.
    setFormError(null);
    // An error goes away the moment its field is touched, not when it is
    // resubmitted, so the message never describes text that has since changed.
    setErrors((current) => (current[key as OutcomeFormField] ? { ...current, [key]: undefined } : current));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    // The same schema the server uses, so the message is the one it would give.
    const check = parseOutcomeDraft(draft);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError("Some fields need attention.");
      focusFirstProblem(check.errors);
      return;
    }
    setPending(true);
    try {
      const result = editing ? await adapter.update(editing.id, draft) : await adapter.log(draft);
      if (result.ok) {
        onDone(
          `${editing ? "Updated" : "Recorded"} ${result.outcome.gene}: ${RESULT_COPY[result.outcome.result].label.toLowerCase()}.${result.note ? ` ${result.note}` : ""}`,
        );
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      if (result.fieldErrors) focusFirstProblem(result.fieldErrors);
    } catch {
      // A rejected action (network drop, expired deployment) is not a server verdict.
      setFormError("The outcome could not be saved. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!editing || pending) return;
    setPending(true);
    setFormError(null);
    try {
      const result = await adapter.remove(editing.id);
      if (result.ok) {
        onDone(`Deleted the outcome for ${editing.gene}.`);
        return;
      }
      setFormError(result.error);
      setConfirmingDelete(false);
    } catch {
      setFormError("The outcome could not be deleted. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  // A failed submit puts the cursor on the first field that needs attention, in
  // reading order, so a keyboard or screen-reader user is not left at the button.
  const focusFirstProblem = (problems: Errors) => {
    const order: OutcomeFormField[] = ["screenId", "gene", "result", "assay", "nGuides", "effectSize", "notes", "evidenceUrl"];
    const key = order.find((field) => problems[field]);
    if (!key) return;
    const selector: Record<OutcomeFormField, string> = {
      screenId: `#${CSS.escape(`${base}-screen`)}`,
      gene: `#${CSS.escape(`${base}-gene`)}`,
      result: 'input[type="radio"]',
      assay: `#${CSS.escape(`${base}-assay`)}`,
      nGuides: `#${CSS.escape(`${base}-guides`)}`,
      effectSize: `#${CSS.escape(`${base}-effect`)}`,
      notes: `#${CSS.escape(`${base}-notes`)}`,
      evidenceUrl: `#${CSS.escape(`${base}-url`)}`,
    };
    window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(selector[key])?.focus());
  };

  const screenName = screens.find((screen) => screen.id === draft.screenId)?.name ?? editing?.screenName ?? draft.screenId;
  const geneId = `${base}-gene`;
  const screenId = `${base}-screen`;
  const assayId = `${base}-assay`;
  const guidesId = `${base}-guides`;
  const effectId = `${base}-effect`;
  const notesId = `${base}-notes`;
  const urlId = `${base}-url`;
  const describe = (id: string, key: OutcomeFormField, hasHint: boolean) =>
    errors[key] ? `${id}-error` : hasHint ? `${id}-hint` : undefined;

  return (
    <ModalDrawer
      title={editing ? `Outcome for ${editing.gene}` : "Log an outcome"}
      eyebrow={adapter.demo ? "Sample workspace" : "Truth Loop"}
      onClose={onClose}
      closeLabel="Close the outcome form"
    >
      <form ref={formRef} onSubmit={submit} noValidate className="mt-5 space-y-4">
        {adapter.demo && (
          <p className="rounded-md bg-orange-50 px-3 py-2 text-[12px] leading-snug text-orange-700">
            This is a demonstration. What you enter stays in this browser tab and is not saved.
          </p>
        )}
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700">
            {formError}
          </p>
        )}

        {editing ? (
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-muted">Gene</dt>
            <dd className="font-medium text-ink">{editing.gene}</dd>
            <dt className="text-muted">Screen</dt>
            <dd className="text-ink">{screenName}</dd>
            {editing.predicted !== null && (
              <>
                <dt className="text-muted">Score then</dt>
                <dd className="text-ink">
                  <span className="num">{editing.predicted.toFixed(3)}</span>
                  <span className="ml-2 text-[11px] text-muted">
                    uncalibrated model output stored when the gene was called; not a probability
                  </span>
                </dd>
              </>
            )}
          </dl>
        ) : (
          <>
            <Labelled label="Screen" id={screenId} error={errors.screenId} hint="The screen this gene was called in.">
              <select
                id={screenId}
                value={draft.screenId}
                onChange={(event) => set("screenId", event.target.value)}
                aria-invalid={errors.screenId ? true : undefined}
                aria-describedby={describe(screenId, "screenId", true)}
                className={cn(FIELD, "pr-6", errors.screenId ? "border-orange-500" : "border-line")}
              >
                <option value="">Choose a screen</option>
                {screens.map((screen) => (
                  <option key={screen.id} value={screen.id}>
                    {screen.name}
                  </option>
                ))}
              </select>
            </Labelled>
            <Labelled label="Gene symbol" id={geneId} error={errors.gene} hint="For example TP53. Matched to the screen's recorded hits, ignoring case.">
              <input
                id={geneId}
                value={draft.gene}
                onChange={(event) => set("gene", event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.gene ? true : undefined}
                aria-describedby={describe(geneId, "gene", true)}
                className={cn(FIELD, errors.gene ? "border-orange-500" : "border-line")}
              />
            </Labelled>
          </>
        )}

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-[12px] text-ink">What did the assay find?</legend>
          <div role="radiogroup" aria-describedby={errors.result ? `${base}-result-error` : undefined} className="grid gap-1.5">
            {OUTCOME_RESULTS.map((value) => {
              const on = draft.result === value;
              return (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors duration-[var(--dur-1)]",
                    on ? "border-cyan-500 bg-cyan-50" : "border-line bg-white hover:border-line-strong",
                  )}
                >
                  <input
                    type="radio"
                    name={`${base}-result`}
                    value={value}
                    checked={on}
                    onChange={() => set("result", value)}
                    className="mt-0.5 h-3.5 w-3.5 accent-cyan-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{RESULT_COPY[value].label}</span>
                    <span className="block text-[11.5px] leading-snug text-muted">{RESULT_COPY[value].help}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.result && (
            <p id={`${base}-result-error`} role="alert" className="mt-1 text-[11px] text-orange-700">
              {errors.result}
            </p>
          )}
        </fieldset>

        <Labelled label="Assay" id={assayId} error={errors.assay} hint="For example arrayed knockout with RSL3 viability.">
          <input
            id={assayId}
            value={draft.assay}
            onChange={(event) => set("assay", event.target.value)}
            aria-describedby={describe(assayId, "assay", true)}
            className={cn(FIELD, errors.assay ? "border-orange-500" : "border-line")}
          />
        </Labelled>

        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Guides used" id={guidesId} error={errors.nGuides} hint="Independent guides, 1 to 100.">
            <input
              id={guidesId}
              inputMode="numeric"
              value={draft.nGuides}
              onChange={(event) => set("nGuides", event.target.value)}
              aria-describedby={describe(guidesId, "nGuides", true)}
              className={cn(FIELD, "num", errors.nGuides ? "border-orange-500" : "border-line")}
            />
          </Labelled>
          <Labelled label="Effect size" id={effectId} error={errors.effectSize} hint="In the assay's own units. Blank if not measured.">
            <input
              id={effectId}
              inputMode="decimal"
              value={draft.effectSize}
              onChange={(event) => set("effectSize", event.target.value)}
              aria-describedby={describe(effectId, "effectSize", true)}
              className={cn(FIELD, "num", errors.effectSize ? "border-orange-500" : "border-line")}
            />
          </Labelled>
        </div>

        <Labelled label="Notes" id={notesId} error={errors.notes}>
          <textarea
            id={notesId}
            rows={3}
            value={draft.notes}
            onChange={(event) => set("notes", event.target.value)}
            aria-describedby={describe(notesId, "notes", false)}
            className={cn(FIELD, "h-auto py-1.5 leading-snug", errors.notes ? "border-orange-500" : "border-line")}
          />
        </Labelled>

        <Labelled label="Link to the evidence" id={urlId} error={errors.evidenceUrl} hint="A notebook page, plate image or dataset. Web addresses only.">
          <input
            id={urlId}
            type="url"
            inputMode="url"
            value={draft.evidenceUrl}
            onChange={(event) => set("evidenceUrl", event.target.value)}
            placeholder="https://"
            aria-describedby={describe(urlId, "evidenceUrl", true)}
            className={cn(FIELD, errors.evidenceUrl ? "border-orange-500" : "border-line")}
          />
        </Labelled>

        <p className="text-[11.5px] leading-snug text-muted">
          Saving records what the bench found. It does not change any score and it does not retrain a model.
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button type="submit" disabled={pending} className="btn btn-orange rounded-lg px-4 py-2 text-[13px] disabled:opacity-60">
            {pending ? "Saving" : editing ? "Save changes" : "Save outcome"}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className="btn btn-ghost rounded-lg px-3 py-2 text-[13px]">
            Cancel
          </button>
          {editing && canDelete && (
            <div className="ml-auto flex items-center gap-2">
              {confirmingDelete ? (
                <>
                  <span className="text-[12px] text-red-700">Delete this outcome?</span>
                  <button type="button" onClick={remove} disabled={pending} className="rounded-md bg-red-600 px-2.5 py-1.5 text-[12px] text-white hover:bg-red-700 disabled:opacity-60">
                    Yes, delete
                  </button>
                  <button type="button" onClick={() => setConfirmingDelete(false)} className="text-[12px] text-muted underline">
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmingDelete(true)} className="text-[12px] text-red-700 underline decoration-red-200 underline-offset-2 hover:decoration-red-600">
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </ModalDrawer>
  );
}
