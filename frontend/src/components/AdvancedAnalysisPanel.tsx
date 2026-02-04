"use client";

import { useState } from "react";
import { Play, Info, CheckCircle, AlertCircle } from "lucide-react";

interface AdvancedAnalysisPanelProps {
  analysisId: string;
  onResultsUpdate?: () => void;
}

type Algorithm = "bagel2" | "drugz";

interface Bagel2Result {
  gene: string;
  numSgRNAs: number;
  bayesFactor: number;
  precision: number;
  recall: number;
  log2FC: number;
  essentialProbability: number;
  rank: number;
}

interface DrugZResult {
  gene: string;
  numSgRNAs: number;
  normZ: number;
  pValue: number;
  fdr: number;
  log2FC: number;
  syntheticScore: number;
  rank: number;
}

export default function AdvancedAnalysisPanel({ analysisId, onResultsUpdate }: AdvancedAnalysisPanelProps) {
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<Algorithm>("bagel2");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    algorithm: Algorithm;
    totalGenes?: number;
    essentialGenes?: number;
    significantGenes?: number;
    results?: Bagel2Result[] | DrugZResult[];
  } | null>(null);

  const runAdvancedAnalysis = async () => {
    setRunning(true);
    setError(null);
    setLastResult(null);
    try {
      const base = typeof window !== "undefined" ? "" : "";
      const res = await fetch(`${base}/api/analyze/${selectedAlgorithm}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Analysis failed");
        return;
      }
      setLastResult({
        algorithm: selectedAlgorithm,
        totalGenes: data.totalGenes,
        essentialGenes: data.essentialGenes,
        significantGenes: data.significantGenes,
        results: data.results,
      });
      onResultsUpdate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
      <h3 className="text-xl font-serif text-text-primary mb-2">Run BAGEL2 or DrugZ</h3>
      <p className="text-sm text-text-tertiary mb-6">
        Re-run advanced algorithms on this analysis without the command line. Uses the same count matrix from your initial run.
      </p>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <label className="flex items-center gap-3 cursor-pointer p-4 rounded-xl border border-border hover:bg-background/50 transition-colors flex-1">
            <input
              type="radio"
              name="algorithm"
              checked={selectedAlgorithm === "bagel2"}
              onChange={() => setSelectedAlgorithm("bagel2")}
              className="w-4 h-4 text-accent"
            />
            <div>
              <div className="font-semibold text-text-primary">BAGEL2</div>
              <div className="text-sm text-text-tertiary">
                Bayesian gene essentiality classification
              </div>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer p-4 rounded-xl border border-border hover:bg-background/50 transition-colors flex-1">
            <input
              type="radio"
              name="algorithm"
              checked={selectedAlgorithm === "drugz"}
              onChange={() => setSelectedAlgorithm("drugz")}
              className="w-4 h-4 text-accent"
            />
            <div>
              <div className="font-semibold text-text-primary">DrugZ</div>
              <div className="text-sm text-text-tertiary">
                Drug resistance & synthetic lethal interactions
              </div>
            </div>
          </label>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-error/10 border border-error/30 text-error">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={runAdvancedAnalysis}
          disabled={running}
          className="btn w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium bg-accent text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          <Play className="w-4 h-4" />
          <span>{running ? "Running…" : `Run ${selectedAlgorithm.toUpperCase()}`}</span>
        </button>

        {lastResult && (
          <div className="flex items-start gap-2 p-4 rounded-xl bg-success/10 border border-success/30 text-text-primary">
            <CheckCircle className="w-5 h-5 shrink-0 text-success mt-0.5" />
            <div>
              <div className="font-medium">
                {lastResult.algorithm === "bagel2"
                  ? `${lastResult.essentialGenes ?? 0} putative essential genes (BF &gt; 0) from ${lastResult.totalGenes ?? 0} genes`
                  : `${lastResult.significantGenes ?? 0} significant genes (FDR &lt; 0.05) from ${lastResult.totalGenes ?? 0} genes`}
              </div>
              {lastResult.results && lastResult.results.length > 0 && (
                <div className="mt-2 text-sm text-text-tertiary">
                  Top 5: {(lastResult.results as { gene: string }[]).slice(0, 5).map((r) => r.gene).join(", ")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
