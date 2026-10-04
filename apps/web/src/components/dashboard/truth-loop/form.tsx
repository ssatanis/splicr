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
  fieldsFor,
  parseOutcomeDraft,
  type OutcomeDraft,
  type OutcomeFormField,
  type Tristate,
} from "@/lib/outcomes/schema";
import {
  TYPE_QUESTION,
  QUESTION_LABEL,
  VALIDATION_TYPES,
  VALIDATION_TYPE_HELP,
  VALIDATION_TYPE_LABEL,
} from "@/lib/validation/model";
import { cn } from "@/lib/utils";

import { ModalDrawer } from "../drawer";
import type { OutcomeAdapter } from "./adapter";

const FIELD =
  "h-8 w-full rounded-md border bg-white px-2 text-[13px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 disabled:bg-mist-soft disabled:text-muted motion-reduce:transition-none";

type Errors = Partial<Record<OutcomeFormField, string>>;

/** A recorded boolean as the form's three states. Null stays blank, not "no". */
const tristateOf = (value: unknown): Tristate =>
  value === true ? "yes" : value === false ? "no" : "";

const numberOf = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

function draftFromRow(row: OutcomeRow): OutcomeDraft {
  // The measurement round-trips through the same keys the engine's endpoints
  // read, so amending an outcome cannot silently drop a criterion that was
  // recorded the first time.
  const m = row.measurement ?? {};
  return {
    screenId: row.screenId,
    gene: row.gene,
    validationType: row.validationType ?? "",
    result: row.result,
    assay: row.assay ?? "",
    nGuides:
      row.nGuides === null ? numberOf(m.n_perturbations) : String(row.nGuides),
    effectSize: row.effectSize === null ? "" : String(row.effectSize),
    labId: row.labId ?? "",
    independentPerturbation: tristateOf(m.independent_perturbation),
    distinctConstructs: tristateOf(m.distinct_from_screen_constructs),
    nReplicates: numberOf(m.n_replicates),
    compound: textOf(m.compound),
    concentrationUm: numberOf(m.concentration_um),
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
    const order: OutcomeFormField[] = [
      "screenId", "gene", "validationType", "result", "assay",
      "independentPerturbation", "distinctConstructs", "nGuides", "nReplicates",
      "effectSize", "compound", "concentrationUm", "labId", "notes", "evidenceUrl",
    ];
    const key = order.find((field) => problems[field]);
    if (!key) return;
    const selector: Record<OutcomeFormField, string> = {
      screenId: `#${CSS.escape(`${base}-screen`)}`,
      gene: `#${CSS.escape(`${base}-gene`)}`,
      validationType: `#${CSS.escape(`${base}-type`)}`,
      result: 'input[type="radio"]',
      assay: `#${CSS.escape(`${base}-assay`)}`,
      nGuides: `#${CSS.escape(`${base}-guides`)}`,
      effectSize: `#${CSS.escape(`${base}-effect`)}`,
      labId: `#${CSS.escape(`${base}-lab`)}`,
      independentPerturbation: `#${CSS.escape(`${base}-independent`)}`,
      distinctConstructs: `#${CSS.escape(`${base}-constructs`)}`,
      nReplicates: `#${CSS.escape(`${base}-replicates`)}`,
      compound: `#${CSS.escape(`${base}-compound`)}`,
      concentrationUm: `#${CSS.escape(`${base}-concentration`)}`,
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
  const typeId = `${base}-type`;
  const labId = `${base}-lab`;
  const independentId = `${base}-independent`;
  const constructsId = `${base}-constructs`;
  const replicatesId = `${base}-replicates`;
  const compoundId = `${base}-compound`;
  const concentrationId = `${base}-concentration`;
  // Which criteria this experiment makes sense to ask about. A concentration
  // field on a CRISPRi outcome is a field somebody will fill in wrongly.
  const relevant = fieldsFor(draft.validationType);
  const question = draft.validationType ? TYPE_QUESTION[draft.validationType] : null;
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

        {/* Which experiment this was. It comes before "what did it find",
            because a result without an experiment is not a measurement of
            anything, and the question it bears on is shown as soon as the
            choice is made so nobody has to learn the mapping. */}
        <Labelled
          label="Which experiment was this?"
          id={typeId}
          error={errors.validationType}
          hint={
            draft.validationType
              ? VALIDATION_TYPE_HELP[draft.validationType]
              : "A genetic reproduction and a pharmacologic test are different questions with different answers."
          }
        >
          <select
            id={typeId}
            value={draft.validationType}
            onChange={(event) =>
              set("validationType", event.target.value as OutcomeDraft["validationType"])
            }
            aria-invalid={errors.validationType ? true : undefined}
            aria-describedby={describe(typeId, "validationType", true)}
            className={cn(
              FIELD,
              "pr-6",
              errors.validationType ? "border-orange-500" : "border-line",
            )}
          >
            <option value="">Choose the experiment</option>
            {VALIDATION_TYPES.map((kind) => (
              <option key={kind} value={kind}>
                {VALIDATION_TYPE_LABEL[kind]}
              </option>
            ))}
          </select>
        </Labelled>
        {draft.validationType && (
          <p className="-mt-2 text-[11.5px] leading-snug text-muted">
            {question
              ? `Bears on: ${QUESTION_LABEL[question].toLowerCase()}.`
              : "Bears on none of the four questions. It is kept and exported, and it enters no model, because its meaning is not fixed."}
          </p>
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

        {/* The prespecified criteria. Each is yes, no, or blank, and blank is a
            third answer rather than a hidden "no": the engine treats an
            unrecorded criterion as "not scorable", which keeps the outcome out
            of a rate's numerator and its denominator. A checkbox here would
            record "no" for every form filled in a hurry. */}
        <fieldset className="min-w-0 rounded-lg border border-line px-3 py-2.5">
          <legend className="px-1 text-[12px] text-ink">
            Prespecified criteria
          </legend>
          <p className="mb-2 text-[11.5px] leading-snug text-muted">
            Leave a criterion blank if it was not recorded. Blank is not
            &ldquo;no&rdquo;: an outcome missing a criterion the endpoint
            requires is reported as not scorable, never as a failure.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Labelled
              label="Independent perturbation"
              id={independentId}
              error={errors.independentPerturbation}
              hint="Not the construct the screen used."
            >
              <select
                id={independentId}
                value={draft.independentPerturbation}
                onChange={(event) =>
                  set("independentPerturbation", event.target.value as Tristate)
                }
                aria-describedby={describe(independentId, "independentPerturbation", true)}
                className={cn(FIELD, "pr-6", errors.independentPerturbation ? "border-orange-500" : "border-line")}
              >
                <option value="">Not recorded</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Labelled>
            {relevant.constructs && (
              <Labelled
                label="Different constructs"
                id={constructsId}
                error={errors.distinctConstructs}
                hint="None of the screening library's own guides."
              >
                <select
                  id={constructsId}
                  value={draft.distinctConstructs}
                  onChange={(event) => set("distinctConstructs", event.target.value as Tristate)}
                  aria-describedby={describe(constructsId, "distinctConstructs", true)}
                  className={cn(FIELD, "pr-6", errors.distinctConstructs ? "border-orange-500" : "border-line")}
                >
                  <option value="">Not recorded</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Labelled>
            )}
            <Labelled
              label="Biological replicates"
              id={replicatesId}
              error={errors.nReplicates}
              hint="Independent biological replicates, not technical ones."
            >
              <input
                id={replicatesId}
                inputMode="numeric"
                value={draft.nReplicates}
                onChange={(event) => set("nReplicates", event.target.value)}
                aria-describedby={describe(replicatesId, "nReplicates", true)}
                className={cn(FIELD, "num", errors.nReplicates ? "border-orange-500" : "border-line")}
              />
            </Labelled>
            <Labelled
              label="Laboratory"
              id={labId}
              error={errors.labId}
              hint="Who ran it. Two screens from one lab are not two independent observations."
            >
              <input
                id={labId}
                value={draft.labId}
                onChange={(event) => set("labId", event.target.value)}
                autoComplete="off"
                aria-describedby={describe(labId, "labId", true)}
                className={cn(FIELD, errors.labId ? "border-orange-500" : "border-line")}
              />
            </Labelled>
          </div>
          {relevant.compound && (
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
              <Labelled
                label="Compound"
                id={compoundId}
                error={errors.compound}
                hint="A pharmacologic outcome without the compound cannot be reused."
              >
                <input
                  id={compoundId}
                  value={draft.compound}
                  onChange={(event) => set("compound", event.target.value)}
                  autoComplete="off"
                  aria-describedby={describe(compoundId, "compound", true)}
                  className={cn(FIELD, errors.compound ? "border-orange-500" : "border-line")}
                />
              </Labelled>
              <Labelled
                label="Concentration (µM)"
                id={concentrationId}
                error={errors.concentrationUm}
                hint="A compound dosed below its range is not evidence about the gene."
              >
                <input
                  id={concentrationId}
                  inputMode="decimal"
                  value={draft.concentrationUm}
                  onChange={(event) => set("concentrationUm", event.target.value)}
                  aria-describedby={describe(concentrationId, "concentrationUm", true)}
                  className={cn(FIELD, "num", errors.concentrationUm ? "border-orange-500" : "border-line")}
                />
              </Labelled>
            </div>
          )}
        </fieldset>

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
