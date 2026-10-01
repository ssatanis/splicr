"use client";

import { Check, CircleStop, Play, RotateCcw, Terminal } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { pipelineLogs, pipelineSteps } from "./model";

const TICKS_PER_STEP = 3;
const TOTAL_TICKS = pipelineSteps.length * TICKS_PER_STEP;

export function LiveRun() {
  const inputId = useId();
  const [accession, setAccession] = useState("GSE152611");
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const valid = /^GSE\d{3,10}$/i.test(accession.trim());
  const done = tick >= TOTAL_TICKS;
  const activeIndex = done ? pipelineSteps.length - 1 : Math.floor(tick / TICKS_PER_STEP);

  useEffect(() => {
    if (!running || tick >= TOTAL_TICKS) return;
    const timer = window.setTimeout(() => {
      const next = Math.min(tick + 1, TOTAL_TICKS);
      setTick(next);
      if (next >= TOTAL_TICKS) setRunning(false);
    }, 720);
    return () => window.clearTimeout(timer);
  }, [running, tick]);

  const shownLogs = useMemo(() => {
    const rows: Array<{ step: number; text: string }> = [];
    for (let step = 0; step < pipelineSteps.length; step += 1) {
      const completedInStep = Math.min(TICKS_PER_STEP, Math.max(0, tick - step * TICKS_PER_STEP));
      pipelineLogs[pipelineSteps[step].key].slice(0, completedInStep).forEach((text) => {
        rows.push({ step, text });
      });
    }
    return rows.slice(-7);
  }, [tick]);

  function start() {
    if (!valid) return;
    setTick(0);
    setRunning(true);
  }

  return (
    <section id="live-run" aria-labelledby="live-run-title" className="scroll-mt-4 rounded-xl border border-line bg-white shadow-card">
      <div className="flex flex-col gap-4 border-b border-line px-4 py-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-cyan-700">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" /> Live run
          </div>
          <h2 id="live-run-title" className="mt-1 text-xl font-medium text-ink">From accession to mechanism</h2>
          <p className="mt-1 max-w-2xl text-[12px] text-muted">
            A deterministic walkthrough of the recorded pipeline. Structural context is attached after scoring; it never reweights the effect.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
          <div>
            <label htmlFor={inputId} className="sr-only">GEO accession</label>
            <input
              id={inputId}
              value={accession}
              onChange={(event) => setAccession(event.target.value.toUpperCase())}
              disabled={running}
              aria-invalid={!valid}
              className="h-10 w-full rounded-lg border border-line-strong bg-white px-3 font-mono text-[12px] text-ink outline-none focus:border-cyan-600 disabled:bg-canvas sm:w-44"
              placeholder="GSE152611"
            />
          </div>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (running) setRunning(false);
              else if (done || tick === 0) start();
              else setRunning(true);
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-[12px] font-medium text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <CircleStop className="h-4 w-4" aria-hidden="true" /> : done ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {running ? "Pause run" : done ? "Run again" : tick > 0 ? "Resume run" : "Start live run"}
          </button>
        </div>
      </div>

      <div className="p-4">
        <ol className="grid gap-2 md:grid-cols-5" aria-label="Pipeline progress">
          {pipelineSteps.map((step, index) => {
            const complete = tick >= (index + 1) * TICKS_PER_STEP;
            const active = index === activeIndex && !done;
            return (
              <li key={step.key} className="relative">
                <div className={`h-full rounded-lg border px-3 py-3 transition-colors ${
                  complete ? "border-teal-200 bg-teal-50" : active ? "border-cyan-500 bg-cyan-50" : "border-line bg-canvas"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`num grid h-5 w-5 place-items-center rounded-full text-[10px] font-medium ${
                      complete ? "bg-teal-800 text-white" : active ? "bg-cyan-600 text-white" : "bg-mist text-muted"
                    }`}>
                      {complete ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}
                    </span>
                    <span className="text-[9px] uppercase tracking-[0.12em] text-muted">
                      {complete ? "complete" : active ? "active" : "queued"}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] font-medium leading-tight text-ink">{step.label}</p>
                </div>
                {index < pipelineSteps.length - 1 && (
                  <span className="absolute -right-2 top-1/2 z-10 hidden h-px w-2 bg-line-strong md:block" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-3 overflow-hidden rounded-lg bg-[#071f28] text-white">
          <div className="flex h-9 items-center border-b border-white/10 px-3 text-[10px] text-white/55">
            <span className="mr-2 h-2 w-2 rounded-full bg-cyan-400" aria-hidden="true" />
            run/{accession.toLowerCase()}, deterministic execution log
            <span className="num ml-auto">{Math.round((tick / TOTAL_TICKS) * 100)}%</span>
          </div>
          <div className="h-[150px] overflow-hidden px-3 py-2.5 font-mono text-[10.5px] leading-[1.55]" role="log" aria-live="polite">
            {shownLogs.length === 0 ? (
              <p className="text-white/35">$ Ready. Enter a GEO series and start the run.</p>
            ) : (
              shownLogs.map((line, index) => (
                <p key={`${line.step}-${line.text}`} className={index === shownLogs.length - 1 && running ? "text-cyan-300" : "text-white/65"}>
                  <span className="mr-2 text-white/25">{String(index + Math.max(1, tick - 6)).padStart(2, "0")}</span>
                  <span className="mr-2 text-orange-300">[{pipelineSteps[line.step].short}]</span>
                  {line.text}
                </p>
              ))
            )}
            {done && <p className="mt-1 text-cyan-300">✓ Evidence package sealed, provenance manifest written</p>}
          </div>
          <div className="h-1 bg-white/5">
            <div className="h-full bg-cyan-400 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(tick / TOTAL_TICKS) * 100}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
