import type { ExportScreen } from "@/lib/data/screens-export";
import type { ExportRequest } from "./export-options";

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every(item => typeof item === "string") ? value : null;

/** Describe executed methods only from completed stage records, never requested callers. */
export function methodsRecord(screen: ExportScreen, request: ExportRequest, exportedAt: string) {
  const run = screen.run!;
  const stages = (screen.stages ?? []).filter(stage => stage.stage === "hits" && stage.status === "done");
  // Ambiguous duplicate stage records must not silently select one execution.
  const metrics = stages.length === 1 ? object(stages[0].metrics) : {};
  return {
    schema: "splicr.methods-record.v1",
    screen_id: screen.screen.id,
    run_id: run.id,
    exported_at: exportedAt,
    comparisons: screen.comparisons,
    completed_methods: strings(metrics.methods),
    execution_evidence: stages.length === 1 ? "completed hits stage" : "unavailable or ambiguous hits stage",
    engine_version: run.engine_version ?? null,
    container_digest: run.image_digest ?? null,
    tool_versions: metrics.tool_versions ?? null,
    effective_parameters: {
      normalization: metrics.normalization ?? null,
      fdr_threshold: metrics.fdr_threshold ?? null,
      fdr_method: metrics.fdr_method ?? null,
      essentiality_contrast: metrics.essentiality_contrast ?? null,
      mle_design: metrics.mle_design ?? null,
      drugz_options: metrics.drugz_options ?? null,
      normalization_controls: metrics.normalization_controls ?? null,
    },
    lab_evidence: (screen.labEvidence ?? []).map(row => ({ gene: row.gene_symbol, kind: row.kind, sha256: row.sha256, status: object(object(row.document).payload).status ?? null })),
    requested_settings: run.settings ?? null,
    warnings: metrics.warnings ?? null,
    qc: screen.qcEvidence ?? { verdict: screen.screen.qc, detail: "Detailed QC was not selected or recorded." },
    export_selection: {
      fields: request.fields, sections: request.sections, rows: request.rowScope,
      filter: request.rowScope === "fdr" ? { metric: request.fdrMetric, threshold: request.fdrThreshold, operator: "<=" } : null,
    },
    limitations: [
      "Methods draft for author review; not a claim of biological validation or statistical superiority.",
      "Requested settings are distinct from effective execution parameters. Null means not recorded.",
      "Engine revision is not a version of MAGeCK, BAGEL2, JACKS or Chronos.",
      "Container identity, tool versions, reference releases, command lines and input hashes require their own execution evidence.",
      "An export filter selects stored rows; it does not rerun multiple-testing correction.",
    ],
  };
}

export function methodsText(record: ReturnType<typeof methodsRecord>): string {
  const known = (value: unknown) => value == null ? "not recorded" : JSON.stringify(value);
  return `SplicR analysis methods — draft for author review

Screen ID: ${record.screen_id}
Run ID: ${record.run_id}
Exported at: ${record.exported_at}

This export contains recorded analysis results. No statistical analysis was
rerun during export. The recorded engine revision was ${known(record.engine_version)}.
The completed hit-calling methods were ${known(record.completed_methods)}.
Execution evidence: ${record.execution_evidence}.
Tool-specific versions: ${known(record.tool_versions)}.
Container digest: ${known(record.container_digest)}.

The recorded count normalization was ${known(record.effective_parameters.normalization)}.
The recorded analysis FDR threshold was ${known(record.effective_parameters.fdr_threshold)}.
The recorded FDR definition was ${known(record.effective_parameters.fdr_method)}.
The recorded QC verdict was ${known(object(record.qc).verdict)}.
Detailed parameters, comparisons, requested settings, QC and export selection
are preserved in methods-record.json and in the exact record below.

An analysis threshold and an export filter are different operations. Missing
values are unknown, not defaults. Method agreement, a Bayes factor, or a
confounder flag does not establish a calibrated validation probability or
prove that a published candidate is false. Before publication, the authors
must resolve missing versions, reference releases, command lines and input
provenance using the original run artifacts, and verify the experimental
design and QC limitations.

Exact recorded evidence:
${JSON.stringify(record, null, 2)}
`;
}
