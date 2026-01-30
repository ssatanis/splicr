"use client";

import { useState } from "react";
import { Upload, FolderOpen, CheckCircle, AlertCircle } from "lucide-react";

interface BatchAnalysisUploaderProps {
  onBatchCreated?: (batchId: string) => void;
}

export default function BatchAnalysisUploader({ onBatchCreated }: BatchAnalysisUploaderProps) {
  const [name, setName] = useState("");
  const [analysisIds, setAnalysisIds] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    setBatchId(null);
    try {
      const ids = analysisIds
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!name.trim() || ids.length === 0) {
        setError("Enter a batch name and at least one analysis ID (one per line or comma-separated).");
        return;
      }
      const res = await fetch("/api/batch/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), analysisIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create batch");
        return;
      }
      setBatchId(data.batchJobId);
      onBatchCreated?.(data.batchJobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
      <h3 className="text-xl font-serif text-text-primary mb-2">Batch analysis</h3>
      <p className="text-sm text-text-tertiary mb-6">
        Create a batch job from existing analysis IDs. Run BAGEL2 or DrugZ on each via the Advanced Analysis tab on each result page.
      </p>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Batch name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q1 screens"
            className="w-full px-4 py-2 rounded-xl border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Analysis IDs (one per line or comma-separated)</label>
          <textarea
            value={analysisIds}
            onChange={(e) => setAnalysisIds(e.target.value)}
            placeholder="analysis_123...&#10;analysis_456..."
            rows={4}
            className="w-full px-4 py-2 rounded-xl border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 font-mono text-sm"
          />
        </div>
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-error/10 border border-error/30 text-error text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {batchId && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-success/10 border border-success/30 text-success text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            Batch created: <code className="font-mono">{batchId}</code>
          </div>
        )}
        <button
          type="button"
          onClick={handleCreate}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium bg-accent text-white hover:opacity-90 disabled:opacity-60"
        >
          <FolderOpen className="w-4 h-4" />
          {loading ? "Creating…" : "Create batch"}
        </button>
      </div>
    </div>
  );
}
