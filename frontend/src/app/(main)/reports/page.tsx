"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useAnalyses, useUpdateAnalysis } from "@/lib/hooks/useAnalyses";
import { Analysis } from "@/lib/types";
import Button from "@/components/Button";
import { formatDate } from "@/lib/utils";
import {
  BarChart3,
  FileText,
  CheckCircle2,
  TrendingUp,
  PieChart,
  Edit2,
  Save,
  X,
  Clock,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";

export default function ReportsPage() {
  const { data: analyses = [] } = useAnalyses();
  const updateAnalysis = useUpdateAnalysis();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const completed = analyses.filter((a) => a.status === "complete").length;
  const byAlgorithm = useMemo(() => analyses.reduce(
    (acc, a) => {
      a.algorithm.forEach((alg) => {
        acc[alg] = (acc[alg] || 0) + 1;
      });
      return acc;
    },
    {} as Record<string, number>,
  ), [analyses]);

  const handleStartEdit = (analysis: Analysis) => {
    setEditingId(analysis.id);
    setEditingName(analysis.name);
  };
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };
  const handleSaveEdit = (analysisId: string) => {
    if (!editingName.trim()) return;
    updateAnalysis.mutate(
      { id: analysisId, updates: { name: editingName.trim() } },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditingName("");
        },
        onError: (err) => {
          console.error("Failed to save analysis name:", err instanceof Error ? err.message : err);
        },
      }
    );
  };

  const recentAnalyses = useMemo(() => [...analyses].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ).slice(0, 10), [analyses]);

  return (
      <div className="min-h-screen">
        <div className="max-w-[1200px] mx-auto px-8 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-16"
          >
            <h1 className="text-6xl font-serif text-text-primary mb-2">Reports</h1>
            <p className="text-lg text-text-secondary">
              Aggregate metrics and outcomes across your screen analyses.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16"
          >
            <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
              <div className="flex items-center gap-4 mb-4">
                <BarChart3 className="w-8 h-8 text-text-primary" strokeWidth={1.5} />
                <span className="font-serif text-text-primary text-lg">Total analyses</span>
              </div>
              <div className="text-4xl font-serif text-text-primary">{analyses.length}</div>
              <p className="text-sm text-text-tertiary mt-2">All screen runs</p>
            </div>
            <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
              <div className="flex items-center gap-4 mb-4">
                <CheckCircle2 className="w-8 h-8 text-success" strokeWidth={1.5} />
                <span className="font-serif text-text-primary text-lg">Completed</span>
              </div>
              <div className="text-4xl font-serif text-text-primary">{completed}</div>
              <p className="text-sm text-text-tertiary mt-2">Successfully finished</p>
            </div>
            <div className="bg-surface rounded-2xl p-8 shadow-card border border-border">
              <div className="flex items-center gap-4 mb-4">
                <TrendingUp className="w-8 h-8 text-info" strokeWidth={1.5} />
                <span className="font-serif text-text-primary text-lg">Success rate</span>
              </div>
              <div className="text-4xl font-serif text-text-primary">
                {analyses.length ? Math.round((completed / analyses.length) * 100) : 0}%
              </div>
              <p className="text-sm text-text-tertiary mt-2">Completion rate</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-surface rounded-2xl p-8 shadow-card border border-border mb-12"
          >
            <h2 className="text-2xl font-serif text-text-primary mb-6 flex items-center gap-3">
              <PieChart className="w-6 h-6" strokeWidth={1.5} />
              Analyses by algorithm
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {Object.entries(byAlgorithm).map(([alg, count]) => (
                <div
                  key={alg}
                  className="p-6 bg-background rounded-xl border border-border"
                >
                  <div className="text-3xl font-serif text-text-primary">{count}</div>
                  <div className="text-sm font-serif text-text-secondary mt-1 uppercase tracking-wide">
                    {alg}
                  </div>
                </div>
              ))}
              {Object.keys(byAlgorithm).length === 0 && (
                <p className="text-text-tertiary font-serif col-span-full">No analyses yet.</p>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-surface rounded-2xl shadow-card border border-border overflow-hidden mb-12"
          >
            <h2 className="text-2xl font-serif text-text-primary mb-6 flex items-center gap-3 px-8 pt-8">
              <FileText className="w-6 h-6" strokeWidth={1.5} />
              Recent analyses
            </h2>
            {recentAnalyses.length === 0 ? (
              <p className="px-8 pb-8 text-text-tertiary font-serif">No analyses yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-light">
                    <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Name</th>
                    <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Date</th>
                    <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Status</th>
                    <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAnalyses.map((analysis) => (
                    <ReportsAnalysisRow
                      key={analysis.id}
                      analysis={analysis}
                      editingId={editingId}
                      editingName={editingName}
                      setEditingName={setEditingName}
                      onStartEdit={handleStartEdit}
                      onCancelEdit={handleCancelEdit}
                      onSaveEdit={handleSaveEdit}
                      isSaving={updateAnalysis.isPending}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </motion.div>
        </div>
      </div>
  );
}

function ReportsAnalysisRow({
  analysis,
  editingId,
  editingName,
  setEditingName,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  isSaving,
}: {
  analysis: Analysis;
  editingId: string | null;
  editingName: string;
  setEditingName: (v: string) => void;
  onStartEdit: (a: Analysis) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  isSaving?: boolean;
}) {
  const isEditing = editingId === analysis.id;
  return (
    <tr className="border-b border-border-light hover:bg-background transition-colors duration-200">
      <td className="px-8 py-5">
        {isEditing ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSaveEdit(analysis.id);
                }
                if (e.key === "Escape") onCancelEdit();
              }}
              className="flex-1 min-w-[120px] px-3 py-2 bg-background border border-border rounded-lg text-sm font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSaveEdit(analysis.id);
              }}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 shrink-0 px-3 py-2 bg-success/15 text-success hover:bg-success/25 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-serif text-sm"
              title="Save"
            >
              <Save className="w-4 h-4 shrink-0" strokeWidth={1.5} />
              <span>Save</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancelEdit();
              }}
              disabled={isSaving}
              className="inline-flex items-center shrink-0 p-2 hover:bg-background rounded-lg transition-colors cursor-pointer disabled:opacity-50 text-text-secondary"
              title="Cancel"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <div className="group flex items-center gap-2">
            <Link href={`/results/${analysis.id}`} className="flex-1 font-serif text-text-primary hover:text-accent">
              {analysis.name}
            </Link>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onStartEdit(analysis); }}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent/10 rounded-lg"
              title="Edit name"
            >
              <Edit2 className="w-4 h-4 text-text-primary" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </td>
      <td className="px-8 py-5 text-sm font-serif text-text-secondary">{formatDate(analysis.createdAt)}</td>
      <td className="px-8 py-5">
        <ReportsStatusBadge status={analysis.status} />
      </td>
      <td className="px-8 py-5">
        <Link href={`/results/${analysis.id}`}>
          <Button variant="outline" size="sm">View results</Button>
        </Link>
      </td>
    </tr>
  );
}

function ReportsStatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; color: string; bg: string; label: string }> = {
    complete: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", label: "Complete" },
    running: { icon: Clock, color: "text-info", bg: "bg-info/10", label: "Running" },
    queued: { icon: Clock, color: "text-warning", bg: "bg-warning/10", label: "Queued" },
    failed: { icon: AlertCircle, color: "text-error", bg: "bg-error/10", label: "Failed" },
    created: { icon: Clock, color: "text-text-tertiary", bg: "bg-background", label: "Created" },
  };
  const cfg = config[status] || config.created;
  const Icon = cfg.icon;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${cfg.bg}`}>
      <Icon className={`w-4 h-4 ${cfg.color}`} strokeWidth={1.5} />
      <span className={`text-sm font-serif ${cfg.color}`}>{cfg.label}</span>
    </div>
  );
}
