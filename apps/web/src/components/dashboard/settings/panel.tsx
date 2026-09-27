"use client";

import { Check, Loader2, Lock, TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, useTransition } from "react";

import type { ActionResult } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * One panel of the workspace settings page.
 *
 * Every panel is a plain form with its own Save button, because these values
 * decide how screens are analysed: an autosave firing on each keystroke would
 * change the next run's thresholds while somebody was still thinking.
 *
 * Three things here are deliberate:
 *
 *  - Submission goes through `onSubmit` and `useTransition`, not through
 *    `<form action={...}>`. React resets an uncontrolled form once a form action
 *    resolves, which on a refused save would throw away what was typed.
 *  - Dirty state is measured, not assumed. The form is serialised when it mounts
 *    and compared on every input, so typing a value and typing it back leaves
 *    the panel clean and the Save button quiet.
 *  - A refused save is shown. Nothing here fails quietly: the action's own
 *    message is rendered beside the button, and the values stay in the form.
 */

type SaveState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: string };

interface PanelFormApi {
  /**
   * Re-measure the dirty state from the DOM. Anything that changes a value
   * programmatically, such as the QC panel's "restore engine defaults", calls
   * this, because setting `input.value` fires no event.
   */
  recheck: () => void;
}

const PanelFormContext = createContext<PanelFormApi>({ recheck: () => {} });

export function usePanelForm(): PanelFormApi {
  return useContext(PanelFormContext);
}

export interface PanelFormProps {
  /** Stable key, so the tab strip can mark panels holding unsaved work. */
  panelKey: string;
  title: string;
  description?: React.ReactNode;
  /** A plain line under the description, for anything the reader should know. */
  note?: React.ReactNode;
  action: (formData: FormData) => Promise<ActionResult>;
  canEdit: boolean;
  /** Why the panel is read only. Shown when `canEdit` is false. */
  lockedReason?: string;
  saveLabel?: string;
  children: React.ReactNode;
  /** Rendered between the fields and the save bar, outside the fieldset. */
  footer?: React.ReactNode;
  onDirtyChange?: (panelKey: string, dirty: boolean) => void;
}

/** Serialise a form so two states can be compared as strings. */
function snapshotForm(form: HTMLFormElement | null): string {
  if (!form) return "";
  const parts: string[] = [];
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string") parts.push(`${key}\u0001${value}`);
  }
  return parts.join("\u0000");
}

export function PanelForm({
  panelKey,
  title,
  description,
  note,
  action,
  canEdit,
  lockedReason,
  saveLabel = "Save changes",
  children,
  footer,
  onDirtyChange,
}: PanelFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const baseline = useRef<string>("");
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const applyDirty = useCallback(
    (next: boolean) => {
      setDirty(next);
      onDirtyChange?.(panelKey, next);
    },
    [onDirtyChange, panelKey],
  );

  const recheck = useCallback(() => {
    applyDirty(snapshotForm(formRef.current) !== baseline.current);
    // A message about the last save stops being true the moment the form
    // changes again. Returning `previous` when it is already idle means no
    // extra render on every keystroke.
    setState((previous) => (previous.status === "idle" ? previous : { status: "idle" }));
  }, [applyDirty]);

  /**
   * The values the server rendered are the clean state. Capturing them in the
   * ref callback rather than in an effect means no render is spent on it: refs
   * are attached after the subtree is committed, so the form is complete, and
   * `dirty` already starts false.
   */
  const attachForm = useCallback((node: HTMLFormElement | null) => {
    formRef.current = node;
    if (node) baseline.current = snapshotForm(node);
  }, []);

  const api = useMemo<PanelFormApi>(() => ({ recheck }), [recheck]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || pending) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setState({ status: "error", error: result.error });
        return;
      }
      setState({ status: "saved" });
      baseline.current = snapshotForm(form);
      applyDirty(false);
    });
  }

  function handleReset() {
    setState({ status: "idle" });
    // The browser resets the fields after this handler, so measure after it.
    window.setTimeout(recheck, 0);
  }

  return (
    <PanelFormContext.Provider value={api}>
      <form
        ref={attachForm}
        onSubmit={handleSubmit}
        onChange={recheck}
        onInput={recheck}
        onReset={handleReset}
        className="rounded-3xl border border-line bg-white p-5 md:p-6"
      >
        <header className="mb-5">
          <h2 className="text-lg font-medium tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
          {note && <p className="mt-2 max-w-2xl text-xs text-body">{note}</p>}
        </header>

        {!canEdit && lockedReason && (
          <p className="mb-5 flex items-start gap-2 rounded-2xl bg-mist-soft px-3.5 py-2.5 text-xs text-body">
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>{lockedReason}</span>
          </p>
        )}

        <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
          {children}
        </fieldset>

        {footer}

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
          <button
            type="submit"
            className="btn btn-teal btn-sm disabled:pointer-events-none disabled:opacity-45"
            disabled={!canEdit || pending || !dirty}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending ? "Saving" : saveLabel}
          </button>

          {canEdit && dirty && !pending && (
            <button type="reset" className="btn btn-ghost btn-sm">
              Revert
            </button>
          )}

          <p
            className="flex min-h-5 max-w-md items-start gap-1.5 text-xs"
            aria-live="polite"
            role={state.status === "error" ? "alert" : undefined}
          >
            {state.status === "error" ? (
              <>
                <TriangleAlert
                  className="mt-px h-3.5 w-3.5 shrink-0 text-orange-600"
                  strokeWidth={1.8}
                />
                <span className="text-orange-700">{state.error}</span>
              </>
            ) : dirty ? (
              <span className="text-orange-700">
                {canEdit ? "Unsaved changes" : "Unsaved changes, and this panel is read only"}
              </span>
            ) : state.status === "saved" ? (
              <>
                <Check className="mt-px h-3.5 w-3.5 shrink-0 text-cyan-600" strokeWidth={2.2} />
                <span className="text-cyan-700">Saved</span>
              </>
            ) : null}
          </p>
        </div>
      </form>
    </PanelFormContext.Provider>
  );
}

/** A dot on the tab strip for a panel with unsaved changes. */
export function DirtyDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-1.5 w-1.5 rounded-full bg-orange-500", className)}
    />
  );
}
