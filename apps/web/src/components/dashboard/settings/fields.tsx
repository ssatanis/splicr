"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Form controls for the settings panels.
 *
 * They are ordinary named inputs, so a panel is a plain HTML form that the
 * Server Actions in `@/lib/data/actions` can read. Nothing here holds state:
 * the panel shell measures the form to decide whether it is dirty.
 *
 * Every control is styled for the disabled case as well as the editable one,
 * because a read-only panel wraps its children in a disabled fieldset rather
 * than swapping in different markup.
 */

/** Two columns from the small breakpoint up, one column on a phone. */
export function FieldGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("grid gap-x-8 gap-y-5 sm:grid-cols-2", className)}>{children}</div>;
}

/** Small print under a control: the default, and where the number comes from. */
export function Provenance({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{children}</p>;
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="label-sm block">
      {children}
    </label>
  );
}

interface TextFieldProps {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: React.ReactNode;
  type?: "text" | "email" | "url";
  maxLength?: number;
  pattern?: string;
  /** Shown by the browser when `pattern` rejects what was typed. */
  title?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}

export function TextField({
  name,
  label,
  defaultValue = "",
  placeholder,
  hint,
  type = "text",
  maxLength,
  pattern,
  title,
  required,
  autoComplete,
  className,
}: TextFieldProps) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={maxLength}
        pattern={pattern}
        title={title}
        required={required}
        autoComplete={autoComplete}
        className="underline-input text-[0.95rem] disabled:text-muted disabled:cursor-not-allowed"
      />
      {hint && <Provenance>{hint}</Provenance>}
    </div>
  );
}

interface NumberFieldProps {
  name: string;
  label: string;
  defaultValue: number | string;
  min?: number;
  max?: number;
  step?: number | "any";
  hint?: React.ReactNode;
  suffix?: string;
  className?: string;
}

export function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
  step = "any",
  hint,
  suffix,
  className,
}: NumberFieldProps) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-baseline gap-2">
        <input
          id={id}
          name={name}
          type="number"
          inputMode="decimal"
          defaultValue={defaultValue}
          min={min}
          max={max}
          step={step}
          required
          className="underline-input tabular-nums text-[0.95rem] disabled:text-muted disabled:cursor-not-allowed"
        />
        {suffix && <span className="shrink-0 text-xs text-muted">{suffix}</span>}
      </div>
      {hint && <Provenance>{hint}</Provenance>}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  name: string;
  label: string;
  defaultValue: string;
  options: readonly SelectOption[];
  hint?: React.ReactNode;
  className?: string;
}

export function SelectField({
  name,
  label,
  defaultValue,
  options,
  hint,
  className,
}: SelectFieldProps) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-cyan-400 disabled:text-muted disabled:cursor-not-allowed"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <Provenance>{hint}</Provenance>}
    </div>
  );
}

/**
 * A switch that submits "true" or "false".
 *
 * The hidden input comes first on purpose: when the box is unchecked the form
 * carries only "false", and when it is checked the later "true" wins. The
 * actions read the last value submitted under the name, which is what makes an
 * unchecked box a real false rather than a missing field.
 */
export function ToggleField({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description?: React.ReactNode;
  defaultChecked: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-ink">
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
        )}
      </div>
      <span className="relative inline-flex shrink-0 pt-0.5">
        <input type="hidden" name={name} value="false" />
        <input
          id={id}
          name={name}
          type="checkbox"
          value="true"
          defaultChecked={defaultChecked}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="h-6 w-11 rounded-full border border-line-strong bg-mist-soft transition-colors peer-checked:border-cyan-500 peer-checked:bg-cyan-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-400 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0.5 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 peer-disabled:opacity-60"
        />
      </span>
    </div>
  );
}

/** One checkbox in a group, as a card with room for a sentence of context. */
export function CheckField({
  name,
  value,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  description?: React.ReactNode;
  defaultChecked: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line p-3.5 transition-colors has-[:checked]:border-cyan-200 has-[:checked]:bg-cyan-50">
      <input
        id={id}
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-600 disabled:cursor-not-allowed"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-ink">
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}

/** A value the user cannot change here, shown so the panel is complete. */
export function ReadOnlyField({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label-sm">{label}</div>
      <div className="mt-1.5 flex min-h-[2.65rem] items-center border-b border-line text-[0.95rem] break-words text-body">
        {value}
      </div>
      {hint && <Provenance>{hint}</Provenance>}
    </div>
  );
}
