"use client";
import { useState } from "react";
import { defaultMle, validateMle, type MleDesign } from "@/lib/intake/analysis-plan";
import type { ExperimentComparison, ExperimentTable } from "@/lib/intake/experiment";
const FIELD = "h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] text-ink";
export function MleDesignEditor({ table, comparison, disabled, onChange }: { table: ExperimentTable; comparison: ExperimentComparison; disabled: boolean; onChange: (design: MleDesign) => void }) {
  const [column, setColumn] = useState("");
  const design = comparison.mle_design ?? defaultMle(table.samples, comparison.treatment, comparison.control);
  const problem = validateMle(design, [...comparison.control, ...comparison.treatment]);
  const factors = [...new Set(table.samples.flatMap((sample) => Object.keys(sample.factors ?? {})))].filter((key) => !/^(sample|sample_id|role|replicate)$/i.test(key));
  const add = (name: string, values: number[]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) || design.columns.includes(name)) return;
    onChange({ ...design, columns: [...design.columns, name], rows: design.rows.map((row, i) => ({ ...row, values: [...row.values, values[i]] })) }); setColumn("");
  };
  const encode = (factor: string) => {
    const values = design.rows.map((row) => table.samples.find((sample) => sample.label === row.sample)?.factors?.[factor] ?? "");
    if (values.some((value) => !value)) return;
    if (values.every((value) => Number.isFinite(Number(value)))) { add(factor.replace(/[^a-zA-Z0-9_]/g, "_"), values.map(Number)); return; }
    const levels = [...new Set(values)].sort();
    const next = { ...design, columns: [...design.columns], rows: design.rows.map((row) => ({ ...row, values: [...row.values] })) };
    for (const level of levels.slice(1)) { const name = `${factor}_${level}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40); if (!/^[A-Za-z]/.test(name) || next.columns.includes(name)) continue; next.columns.push(name); next.rows.forEach((row, i) => row.values.push(Number(values[i] === level))); }
    onChange(next);
  };
  return <details className="mt-3 rounded-sm border border-stone-200 p-3"><summary className="cursor-pointer text-[12px] font-medium text-ink">MLE design and coefficient</summary><p className="mt-2 text-[11px] text-muted">Baseline stays 1. Categorical factors use the first sorted level as reference.</p>
    <div className="mt-2 flex flex-wrap gap-3"><label className="text-[11px] text-muted">Coefficient<select aria-label={`MLE coefficient for ${comparison.name}`} className={`${FIELD} ml-2`} disabled={disabled} value={design.coefficient} onChange={(event) => onChange({ ...design, coefficient: event.target.value })}>{design.columns.slice(1).map((name) => <option key={name}>{name}</option>)}</select></label><label className="text-[11px] text-muted">Permutation rounds<input aria-label={`MLE permutations for ${comparison.name}`} className={`${FIELD} ml-2 w-20`} type="number" min={10} max={1000} value={design.permutation_round} disabled={disabled} onChange={(event) => onChange({ ...design, permutation_round: Number(event.target.value) })}/></label><label className="text-[11px] text-muted">Random seed<input aria-label={`MLE random seed for ${comparison.name}`} className={`${FIELD} ml-2 w-24`} type="number" min={0} max={4294967295} value={design.random_seed ?? 0} disabled={disabled} onChange={(event) => onChange({ ...design, random_seed: Number(event.target.value) })}/></label></div>
    <div className="mt-3 overflow-x-auto"><table className="dense-table dense-table-compact"><thead><tr><th>Sample</th>{design.columns.map((name, j) => <th key={name}>{name}{j > 1 && <button type="button" aria-label={`Remove MLE factor ${name}`} disabled={disabled} onClick={() => onChange({ ...design, columns: design.columns.filter((_, i) => i !== j), rows: design.rows.map((row) => ({ ...row, values: row.values.filter((_, i) => i !== j) })), coefficient: design.coefficient === name ? "treatment" : design.coefficient })} className="ml-2 text-muted">×</button>}</th>)}</tr></thead><tbody>{design.rows.map((row, i) => <tr key={row.sample}><td>{row.sample}</td>{row.values.map((value, j) => <td key={j}>{j === 0 ? value : <input aria-label={`MLE ${design.columns[j]} for ${row.sample}`} className={`${FIELD} w-20`} type="number" step="any" value={value} disabled={disabled} onChange={(event) => onChange({ ...design, rows: design.rows.map((current, k) => k === i ? { ...current, values: current.values.map((n, c) => c === j ? Number(event.target.value) : n) } : current) })}/>}</td>)}</tr>)}</tbody></table></div>
    <div className="mt-3 flex flex-wrap gap-2"><input aria-label={`New MLE factor for ${comparison.name}`} className={`${FIELD} w-40`} placeholder="Factor name" value={column} disabled={disabled} onChange={(event) => setColumn(event.target.value)}/><button type="button" className="rounded border border-stone-200 px-2 text-[12px] text-ink" disabled={disabled || !column} onClick={() => add(column, design.rows.map(() => 0))}>Add numeric factor</button>{factors.length > 0 && <select aria-label={`Encode metadata factor for ${comparison.name}`} value="" className={FIELD} disabled={disabled} onChange={(event) => encode(event.target.value)}><option value="">Add metadata factor</option>{factors.map((key) => <option key={key}>{key}</option>)}</select>}</div>
    {problem && <p role="alert" className="mt-2 text-[11px] text-orange-700">{problem}</p>}
  </details>;
}
