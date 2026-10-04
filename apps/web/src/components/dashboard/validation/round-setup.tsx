"use client";

/**
 * Setting up a round, in place.
 *
 * This was a drawer. A drawer was the wrong shape for it: it covered the list
 * of rounds you were trying to add to, and the whole point of the page is the
 * round, so the round is the page. Controls on the left, what they will draw on
 * the right, updating as you change them.
 */
import { useState, useTransition } from "react";

import { Panel } from "@/components/dashboard/ui";
import { createRound } from "@/lib/data/round-actions";
import { cn } from "@/lib/utils";
import {
  ARM_LABEL,
  ARM_RANKS_BY,
  DESIGN_LABEL,
  MAX_BUDGET,
  MIN_BUDGET,
  ROUND_DESIGNS,
  SELECTABLE_ARMS,
} from "@/lib/validation/model";

const FIELD =
  "h-8 w-full rounded-md border border-line bg-white px-2 text-[13px] text-ink outline-none transition-colors focus:border-cyan-500";

export interface SetupScreen {
  id: string;
  name: string;
  nHits: number;
}

export interface SetupEndpoint {
  key: string;
  label: string;
  thresholdOwner: string;
  effectMetric: string;
  /** What a negative result on this endpoint does not mean. Shown when chosen. */
  negativeMeans: string;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11.5px] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

export function RoundSetup({
  screens,
  endpoints,
}: {
  screens: SetupScreen[];
  endpoints: SetupEndpoint[];
}) {
  const [screenId, setScreenId] = useState(screens[0]?.id ?? "");
  const [name, setName] = useState("");
  const [design, setDesign] = useState<string>(ROUND_DESIGNS[0]);
  const [budget, setBudget] = useState("20");
  const [endpointKey, setEndpointKey] = useState(endpoints[0]?.key ?? "");
  const [threshold, setThreshold] = useState("");
  const [arms, setArms] = useState<string[]>([...SELECTABLE_ARMS]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const endpoint = endpoints.find((e) => e.key === endpointKey);
  const screen = screens.find((s) => s.id === screenId);
  const byArms = design === "stratified_arms";
  const needsThreshold = endpoint?.thresholdOwner === "laboratory";
  const budgetNumber = Number(budget);

  /**
   * What this configuration will draw, and separately what is stopping it.
   *
   * The two are separate on purpose. Hiding the description until every field
   * is filled means the panel is blank exactly while somebody is deciding what
   * to fill in, which is when it is most useful.
   */
  const plan = (() => {
    const budgetOk =
      Number.isInteger(budgetNumber) && budgetNumber >= MIN_BUDGET && budgetNumber <= MAX_BUDGET;
    const blockers: string[] = [];
    if (!budgetOk) {
      blockers.push(`Budget is a whole number from ${MIN_BUDGET} to ${MAX_BUDGET}.`);
    } else if (screen && budgetNumber > screen.nHits) {
      blockers.push(`That screen has ${screen.nHits.toLocaleString()} candidates.`);
    }
    if (needsThreshold && !(Number(threshold) > 0)) {
      blockers.push("Set the effect size that counts as a pass.");
    }
    if (byArms && arms.length < 2) {
      blockers.push("Pick at least two strategies, or there is nothing to compare.");
    }
    if (byArms && budgetOk && arms.length >= 2 && budgetNumber < arms.length * 2) {
      blockers.push(`${budgetNumber} across ${arms.length} strategies is too few each.`);
    }

    const lines: string[] = [];
    if (budgetOk) {
      lines.push(`${budgetNumber} candidates to test.`);
      if (!byArms) {
        const scale = Math.min(1, budgetNumber / 70);
        const top = Math.max(1, Math.round(20 * scale));
        const per = Math.max(1, Math.round(10 * scale));
        lines.push(`The top ${top} by rank, plus about ${per} at each of five percentiles.`);
      } else if (arms.length >= 2) {
        const each = Math.max(1, Math.floor(budgetNumber / arms.length));
        lines.push(`About ${each} from each of ${arms.length} strategies.`);
        lines.push("A candidate two strategies both pick is tested once and counts for both.");
      }
    }
    return { ok: blockers.length === 0, lines, blockers };
  })();

  const toggle = (arm: string) =>
    setArms((current) =>
      current.includes(arm) ? current.filter((a) => a !== arm) : [...current, arm],
    );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await createRound({
        screenId,
        name,
        design,
        budget,
        endpointKey,
        laboratoryThreshold: threshold,
        arms,
      });
      if (result.ok) setName("");
      else setError(result.error);
    });
  };

  if (screens.length === 0) {
    return (
      <Panel span={12} title="Set up a round">
        <p className="text-[12.5px] text-body">
          Analyse a screen first. A round is drawn from its candidates.
        </p>
      </Panel>
    );
  }

  return (
    <Panel span={12} title="Set up a round" count="pick what to test">
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="Screen">
              <select
                value={screenId}
                onChange={(e) => setScreenId(e.target.value)}
                className={cn(FIELD, "pr-6")}
              >
                {screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.nHits.toLocaleString()})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Validation round"
                className={FIELD}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="How to pick">
              <select
                value={design}
                onChange={(e) => setDesign(e.target.value)}
                className={cn(FIELD, "pr-6")}
              >
                {ROUND_DESIGNS.map((key) => (
                  <option key={key} value={key}>
                    {DESIGN_LABEL[key]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Budget">
              <input
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className={cn(FIELD, "num")}
              />
            </Field>
            {needsThreshold && (
              <Field label="Counts as a pass" hint={endpoint?.effectMetric}>
                <input
                  inputMode="decimal"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  placeholder="1.0"
                  className={cn(FIELD, "num")}
                />
              </Field>
            )}
          </div>

          {byArms && (
            <fieldset className="min-w-0">
              <legend className="mb-1 text-[11.5px] text-muted">Strategies to compare</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {SELECTABLE_ARMS.map((arm) => (
                  <label
                    key={arm}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
                      arms.includes(arm)
                        ? "border-cyan-500 bg-cyan-50"
                        : "border-line bg-white hover:border-line-strong",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={arms.includes(arm)}
                      onChange={() => toggle(arm)}
                      className="mt-0.5 h-3.5 w-3.5 accent-cyan-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] text-ink">{ARM_LABEL[arm]}</span>
                      <span className="block text-[11px] leading-snug text-muted">
                        {ARM_RANKS_BY[arm]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <Field
            label="What counts as validated"
            hint={endpoint?.negativeMeans}
          >
            <select
              value={endpointKey}
              onChange={(e) => setEndpointKey(e.target.value)}
              className={cn(FIELD, "pr-6")}
            >
              {endpoints.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* What the controls on the left will actually do, before they do it. */}
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-mist-soft p-3">
          <span className="text-[11px] uppercase tracking-[0.06em] text-muted">
            This will draw
          </span>
          <div className="flex min-h-[72px] flex-col gap-1.5 text-[12.5px] leading-snug text-ink">
            {plan.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
            {plan.blockers.map((line) => (
              <span key={line} className="text-orange-700">
                {line}
              </span>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-[11.5px] leading-snug text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || !plan.ok}
            className="btn btn-orange mt-auto rounded-lg px-4 py-2 text-[13px] disabled:opacity-50"
          >
            {pending ? "Drawing" : "Draw the set"}
          </button>
          <span className="text-[11px] leading-snug text-muted">
            Nothing is locked yet. You freeze the list in the next step.
          </span>
        </div>
      </form>
    </Panel>
  );
}
