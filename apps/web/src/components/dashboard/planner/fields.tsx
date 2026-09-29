"use client";

/**
 * Form controls for the planner.
 *
 * A number field here is text you can type into freely. While you are mid-edit
 * it may hold nothing, or "0.", or a value out of range, and none of those
 * should make the plan jump. The field reports what it is, and the planner
 * decides what to do: keep the last good value while the text is not a number,
 * use the nearest legal value when it is out of range, and say so under the
 * field in both cases.
 */

import { useId, type ReactNode } from "react";

import { FIELDS, type NumericKey, type PlanInputs } from "@/lib/planner/model";
import { cn } from "@/lib/utils";

const INPUT =
  "h-8 w-full rounded-md border bg-white px-2 text-[13px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 disabled:bg-mist-soft disabled:text-muted motion-reduce:transition-none";

export function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-2 border-b border-line pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        <span>{title}</span>
        {hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}
      </legend>
      <div className="space-y-2.5">{children}</div>
    </fieldset>
  );
}

export function NumberField({
  field,
  value,
  draft,
  issue,
  onChange,
  onBlur,
  disabled,
  label,
}: {
  field: (typeof FIELDS)[NumericKey];
  value: number;
  draft: string | undefined;
  issue: string | undefined;
  onChange: (key: NumericKey, text: string) => void;
  onBlur: (key: NumericKey) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const issueId = `${id}-issue`;
  const shown = draft ?? String(value);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-[12px] text-ink">
        <span>{label ?? field.label}</span>
        {field.unit && <span className="text-[11px] text-muted">{field.unit}</span>}
      </label>
      <input
        id={id}
        type="text"
        inputMode={field.integer ? "numeric" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        value={shown}
        disabled={disabled}
        onChange={(event) => onChange(field.key, event.target.value)}
        onBlur={() => onBlur(field.key)}
        aria-invalid={issue ? true : undefined}
        aria-describedby={[field.help ? helpId : null, issue ? issueId : null].filter(Boolean).join(" ") || undefined}
        className={cn(INPUT, "num", issue ? "border-orange-500" : "border-line")}
      />
      {field.help && !issue && (
        <p id={helpId} className="mt-1 text-[11px] leading-snug text-muted">
          {field.help}
        </p>
      )}
      {issue && (
        <p id={issueId} role="status" className="mt-1 text-[11px] leading-snug text-orange-700">
          {issue}
        </p>
      )}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  children,
  help,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
  help?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12px] text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={cn(INPUT, "border-line pr-6")}
      >
        {children}
      </select>
      {help && <p className="mt-1 text-[11px] leading-snug text-muted">{help}</p>}
    </div>
  );
}

/** A group of fields that most readers never touch, closed until asked for. */
export function Disclosure({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-line bg-canvas/50 open:bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[12px] font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="flex items-center gap-2 text-[11px] font-normal text-muted">
          {summary}
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            {"›"}
          </span>
        </span>
      </summary>
      <div className="space-y-2.5 border-t border-line px-3 py-3">{children}</div>
    </details>
  );
}

export type FieldBag = {
  inputs: PlanInputs;
  drafts: Record<string, string>;
  issues: Record<string, string>;
  onChange: (key: NumericKey, text: string) => void;
  onBlur: (key: NumericKey) => void;
};

/** A number field wired to the planner's state by key alone. */
export function Field({
  bag,
  name,
  disabled,
  label,
}: {
  bag: FieldBag;
  name: NumericKey;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <NumberField
      field={FIELDS[name]}
      value={bag.inputs[name]}
      draft={bag.drafts[name]}
      issue={bag.issues[name]}
      onChange={bag.onChange}
      onBlur={bag.onBlur}
      disabled={disabled}
      label={label}
    />
  );
}
