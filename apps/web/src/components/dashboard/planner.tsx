"use client";

/**
 * The screen planner.
 *
 * It answers one question before anything is ordered: what does this design
 * need, in guides, cells, reads, weeks and consumables, and where will it be
 * thin? Every figure is arithmetic on what the reader typed, with the working
 * printed beside it (see lib/planner/model.ts for the model and its limits).
 *
 * There is no power percentage. An earlier version showed "Power 97%" from an
 * expression with no alpha, no dispersion and no library size, and a hopeless
 * design still scored 97. This one prints a sampling-noise floor and says it is
 * a lower bound.
 *
 * STATE. Two objects, because a text field and a number are not the same thing
 * while somebody is typing. `inputs` is always valid and is what the plan is
 * computed from. `drafts` holds the raw text of any field being edited, so
 * clearing a box to type a new value does not make the plan jump to a default.
 * The address carries only what differs from the defaults, so a design can be
 * sent as a link and reopens exactly as it was.
 */

import { Check, Copy, Download, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { planCsv } from "@/lib/planner/export";
import { formatInt } from "@/lib/planner/format";
import { MODALITY_NAME, PLANNER_LIBRARIES, findLibrary } from "@/lib/planner/libraries";
import {
  DEFAULT_INPUTS,
  MODEL_VERSION,
  PRESETS,
  applyPreset,
  buildPlan,
  inputsToParams,
  parseField,
  planRows,
  type NumericKey,
  type PlanInputs,
} from "@/lib/planner/model";
import { cn } from "@/lib/utils";

import { PageHeader, Panel, Segmented } from "./ui";
import {
  Disclosure,
  Field,
  SelectField,
  Section,
  type FieldBag,
} from "./planner/fields";
import {
  ChecksPanel,
  CostPanel,
  MethodPanel,
  NoisePanel,
  PlanKpis,
  RepresentationPanel,
  SequencingPanel,
  TimelinePanel,
} from "./planner/results";

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const PRESET_INPUTS = PRESETS.map((preset) => ({ preset, inputs: applyPreset(preset) }));

function sameInputs(a: PlanInputs, b: PlanInputs): boolean {
  return (Object.keys(a) as (keyof PlanInputs)[]).every((key) => a[key] === b[key]);
}

export function Planner({ initial }: { initial: PlanInputs }) {
  const [inputs, setInputs] = useState<PlanInputs>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const copiedTimer = useRef<number | undefined>(undefined);

  const plan = useMemo(() => buildPlan(inputs), [inputs]);

  // The address follows the design. replaceState, not navigation: there is
  // nothing to fetch, and twelve keystrokes should not be twelve history entries.
  useEffect(() => {
    const query = inputsToParams(inputs).toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [inputs]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const onChange = useCallback((key: NumericKey, text: string) => {
    setDrafts((current) => ({ ...current, [key]: text }));
    const parsed = parseField(key, text);
    setIssues((current) => {
      const next = { ...current };
      if (parsed.issue) next[key] = parsed.issue;
      else delete next[key];
      return next;
    });
    // Half-typed text keeps the last good value rather than jumping to a default.
    if (parsed.ok) setInputs((current) => ({ ...current, [key]: parsed.value }));
  }, []);

  const onBlur = useCallback((key: NumericKey) => {
    // Once the reader leaves the box it shows the value actually in use, and any
    // note about a correction goes away with the draft that caused it.
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setIssues((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const replaceAll = (next: PlanInputs) => {
    setInputs(next);
    setDrafts({});
    setIssues({});
  };

  const bag: FieldBag = { inputs, drafts, issues, onChange, onBlur };
  const catalog = findLibrary(inputs.library);

  const copyLink = async () => {
    window.clearTimeout(copiedTimer.current);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    copiedTimer.current = window.setTimeout(() => setCopied("idle"), 2400);
  };

  const day = new Date().toISOString().slice(0, 10);
  const rows = () => planRows(inputs, plan);

  const useAsCustom = () => {
    if (!catalog) return;
    const targeting = catalog.guides - catalog.controls;
    replaceAll({
      ...inputs,
      library: "custom",
      genes: catalog.genes,
      // Three decimals keeps the total within a handful of guides of the real library.
      guidesPerGene: Math.max(1, Number((targeting / catalog.genes).toFixed(3))),
      controls: catalog.controls,
    });
  };

  const isDefault = sameInputs(inputs, DEFAULT_INPUTS);

  return (
    <div className="flex flex-col gap-3 pb-6">
      <PageHeader
        dense
        title="Screen Planner"
        body="What a design needs in guides, cells, reads, weeks and consumables, before anything is ordered."
        actions={
          <>
            <button type="button" onClick={copyLink} className="btn btn-ghost h-7 rounded-md px-2.5 py-0 text-[11px]">
              {copied === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied === "copied" ? "Link copied" : copied === "failed" ? "Copy the address bar" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => download(`splicr-screen-plan_${day}.csv`, planCsv(inputs, rows()), "text/csv;charset=utf-8")}
              className="btn btn-ghost h-7 rounded-md px-2.5 py-0 text-[11px]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `splicr-screen-plan_${day}.json`,
                  `${JSON.stringify({ model: MODEL_VERSION, note: "Design arithmetic, not a power calculation, a quote or a guarantee.", inputs, plan }, null, 2)}\n`,
                  "application/json",
                )
              }
              className="btn btn-ghost h-7 rounded-md px-2.5 py-0 text-[11px]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> JSON
            </button>
          </>
        }
      />
      <span className="sr-only" role="status" aria-live="polite">
        {copied === "copied" ? "Link copied to the clipboard." : ""}
      </span>

      <div className="grid grid-cols-12 content-start gap-4">
        <Panel
          title="Describe the screen"
          span={4}
          className="lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6.5rem)] lg:self-start"
          footer={
            <>
              <span className="min-w-0 truncate text-[11px] text-muted">Runs in your browser. Nothing is sent anywhere.</span>
              <button
                type="button"
                onClick={() => replaceAll(DEFAULT_INPUTS)}
                disabled={isDefault}
                className="inline-flex shrink-0 items-center gap-1 text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600 disabled:text-muted disabled:no-underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset
              </button>
            </>
          }
          bodyClassName="space-y-4"
        >
          <a
            href="#plan-results"
            className="block rounded-md bg-cyan-50 px-2.5 py-1.5 text-center text-[12px] text-cyan-700 lg:hidden"
          >
            Jump to the plan
          </a>
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Start from</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Starting points">
              {PRESET_INPUTS.map(({ preset, inputs: presetInputs }) => {
                const active = sameInputs(inputs, presetInputs);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    title={preset.blurb}
                    onClick={() => replaceAll(presetInputs)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-left text-[11.5px] leading-tight transition-colors duration-[var(--dur-1)]",
                      active ? "border-cyan-500 bg-cyan-50 text-ink" : "border-line bg-white text-body hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Section title="Library">
            <SelectField
              label="Library"
              value={inputs.library}
              onChange={(library) => replaceAll({ ...inputs, library })}
            >
              <option value="custom">Custom library</option>
              {PLANNER_LIBRARIES.map((library) => (
                <option key={library.slug} value={library.slug}>
                  {library.name}, {library.organism.toLowerCase()} {MODALITY_NAME[library.modality]}
                </option>
              ))}
            </SelectField>
            {catalog ? (
              <div className="rounded-md bg-mist-soft px-2.5 py-2 text-[11.5px] leading-snug text-body">
                <span className="num text-ink">{formatInt(catalog.guides)}</span> guides:{" "}
                <span className="num">{formatInt(catalog.guides - catalog.controls)}</span> targeting{" "}
                <span className="num">{formatInt(catalog.genes)}</span> genes, plus{" "}
                <span className="num">{formatInt(catalog.controls)}</span> controls.{" "}
                <button
                  type="button"
                  onClick={useAsCustom}
                  className="text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
                >
                  Edit as a custom library
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Field bag={bag} name="genes" />
                <Field bag={bag} name="guidesPerGene" />
                <Field bag={bag} name="controls" />
              </div>
            )}
          </Section>

          <Section title="Cells">
            <div className="grid grid-cols-2 gap-2">
              <Field bag={bag} name="coverage" />
              <Field bag={bag} name="moi" />
              <Field bag={bag} name="startingCellsM" />
              <Field bag={bag} name="doublingHours" />
            </div>
          </Section>

          <Section title="Screen">
            <div>
              <div className="mb-1 text-[12px] text-ink">Design</div>
              <Segmented
                label="Screen design"
                value={inputs.design}
                onChange={(design) => replaceAll({ ...inputs, design })}
                options={[
                  { value: "treatment", label: "Treated vs control" },
                  { value: "dropout", label: "Dropout vs day 0" },
                ]}
              />
              <p className="mt-1 text-[11px] leading-snug text-muted">
                {inputs.design === "treatment"
                  ? "Two arms, each in replicate, and a day-zero reference."
                  : "One arm in replicate, compared with the day-zero reference."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field bag={bag} name="replicates" />
              <Field bag={bag} name="screenDays" />
            </div>
          </Section>

          <Section title="Sequencing">
            <div className="grid grid-cols-2 gap-2">
              <Field bag={bag} name="readsPerGuide" />
              <Field bag={bag} name="runReadsM" />
              <Field bag={bag} name="skew" />
              <div />
              <Field bag={bag} name="cellFloor" />
              <Field bag={bag} name="readFloor" />
            </div>
          </Section>

          <div className="space-y-2">
            <Disclosure title="DNA and PCR" summary={`${inputs.gdnaPgPerCell} pg, ${inputs.gdnaUgPerPcr} µg`}>
              <div className="grid grid-cols-2 gap-2">
                <Field bag={bag} name="gdnaPgPerCell" />
                <Field bag={bag} name="gdnaUgPerPcr" />
              </div>
            </Disclosure>
            <Disclosure title="Unit costs" summary="placeholders">
              <p className="text-[11px] leading-snug text-muted">
                These are stand-ins, not quotes. Replace them with your core&apos;s prices.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Field bag={bag} name="costLibrary" />
                <Field bag={bag} name="costVirus" />
                <Field bag={bag} name="costCulturePerBillion" />
                <Field bag={bag} name="costGdnaPerUg" />
                <Field bag={bag} name="costPcr" />
                <Field bag={bag} name="costSeqPerMillion" />
              </div>
            </Disclosure>
            <Disclosure title="Timeline assumptions" summary="weeks per phase">
              <div className="grid grid-cols-2 gap-2">
                <Field bag={bag} name="weeksLibrary" />
                <Field bag={bag} name="weeksVirus" />
                <Field bag={bag} name="weeksSelection" />
                <Field bag={bag} name="weeksHarvest" />
                <Field bag={bag} name="weeksSequencing" />
                <Field bag={bag} name="weeksAnalysis" />
              </div>
            </Disclosure>
          </div>
        </Panel>

        <div id="plan-results" tabIndex={-1} className="col-span-12 flex min-w-0 scroll-mt-4 flex-col gap-4 outline-none lg:col-span-8">
          <PlanKpis plan={plan} inputs={inputs} />
          <ChecksPanel plan={plan} />
          <RepresentationPanel plan={plan} inputs={inputs} />
          <TimelinePanel plan={plan} />
          <div className="grid gap-4 md:grid-cols-2">
            <SequencingPanel plan={plan} inputs={inputs} />
            <NoisePanel plan={plan} inputs={inputs} />
          </div>
          <CostPanel plan={plan} />
          <MethodPanel />
        </div>
      </div>
    </div>
  );
}
