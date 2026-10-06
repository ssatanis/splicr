import type { DiscoveryReceipt } from "./receipt";

/** Formula-safe CSV for bench software. No ranking, arm, priority or interpretation leaks. */
function cell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text) && typeof value !== "number") text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function blindedWorksheet(receipt: DiscoveryReceipt): string {
  const rows = [...receipt.plan.experiments].sort((a, b) => receipt.blind_ids[a.id].localeCompare(receipt.blind_ids[b.id]));
  return [["blind_id", "target", "partner", "model", "assay", "compound", "dose_um", "partner_compound", "partner_dose_um", "time_hours", "required_controls"],
    ...rows.map((e) => [receipt.blind_ids[e.id], e.gene, e.partner, e.model_id, e.kind, e.combination_evidence?.[0]?.compound_a ?? e.compound, e.combination_evidence?.[0]?.dose_a_um ?? e.dose_um, e.combination_evidence?.[0]?.compound_b ?? null, e.combination_evidence?.[0]?.dose_b_um ?? null, e.time_hours, e.controls.join("; ")])].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
