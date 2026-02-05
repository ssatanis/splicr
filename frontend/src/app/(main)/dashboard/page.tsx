"use client";

import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { useAnalyses, useUpdateAnalysis, analysisKeys } from "@/lib/hooks/useAnalyses";
import { Analysis } from "@/lib/types";
import {
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Activity,
  XCircle,
  Edit2,
  Save,
  X,
  Ban,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

const CANCELLABLE_STATUSES = ["queued", "pending", "running"];

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: analyses = [], isLoading, refetch: refreshAnalyses } = useAnalyses();
  const updateAnalysis = useUpdateAnalysis();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<{ id: string; name: string } | null>(null);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Memoized stats calculation for performance
  const stats = useMemo(() => ({
    total: analyses.length,
    completed: analyses.filter((a) => a.status === "complete").length,
    running: analyses.filter((a) => a.status === "running" || a.status === "queued").length,
    failed: analyses.filter((a) => a.status === "failed").length,
  }), [analyses]);

  // Memoized filtering for performance
  const filteredAnalyses = useMemo(() => {
    let filtered = analyses;
    if (statusFilter !== "all") {
      filtered = filtered.filter((a) => a.status === statusFilter);
    }
    if (searchQuery) {
      filtered = filtered.filter((a) =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return filtered;
  }, [analyses, statusFilter, searchQuery]);

  const handleStartEdit = (analysis: Analysis) => {
    setEditingId(analysis.id);
    setEditingName(analysis.name);
  };
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };
  const handleSaveEdit = (analysisId: string) => {
    const name = editingName.trim();
    if (!name) return;
    updateAnalysis.mutate(
      { id: analysisId, updates: { name } },
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

  const handleRequestCancelJob = (analysis: { id: string; name: string }) => {
    setCancelConfirm(analysis);
  };

  const handleConfirmCancelJob = async () => {
    if (!cancelConfirm) return;
    setCancellingId(cancelConfirm.id);
    try {
      const res = await fetch(`/api/analysis/${cancelConfirm.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to cancel");
      }
      setCancelConfirm(null);
      await queryClient.invalidateQueries({ queryKey: analysisKeys.lists() });
      await refreshAnalyses();
    } catch (err) {
      console.error("Cancel analysis error:", err);
      alert(err instanceof Error ? err.message : "Failed to cancel analysis");
    } finally {
      setCancellingId(null);
    }
  };

  // Track page load time
  useEffect(() => {
    console.time('⏱️ Dashboard Page Interactive');
    return () => {
      console.timeEnd('⏱️ Dashboard Page Interactive');
    };
  }, []);

  return (
      <div className="min-h-screen">
        <ConfirmModal
          open={!!cancelConfirm}
          onClose={() => setCancelConfirm(null)}
          onConfirm={handleConfirmCancelJob}
          title="Cancel analysis?"
          message={
            cancelConfirm
              ? `"${cancelConfirm.name}" will be removed from the queue so the next job can run. You can start a new analysis later if needed.`
              : ""
          }
          confirmLabel="Cancel analysis"
          cancelLabel="Keep"
          variant="danger"
          loading={cancellingId !== null}
        />
        <div className="max-w-[1400px] mx-auto px-8 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-16"
          >
            <h1 className="text-6xl font-serif text-text-primary mb-2">Dashboard</h1>
            <p className="text-lg text-text-secondary">{today}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
          >
            <StatsCard
              icon={FileText}
              label="Total screen analyses"
              value={stats.total}
              color="text-text-primary"
            />
            <StatsCard
              icon={CheckCircle2}
              label="Completed"
              value={stats.completed}
              color="text-success"
            />
            <StatsCard
              icon={Activity}
              label="In progress"
              value={stats.running}
              color="text-info"
            />
            <StatsCard
              icon={XCircle}
              label="Failed"
              value={stats.failed}
              color="text-error"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-4xl font-serif text-text-primary">Recent analyses</h2>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary"
                    strokeWidth={1.5}
                  />
                  <input
                    type="text"
                    placeholder="Search analyses..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 bg-surface border border-border rounded-xl text-sm font-serif focus:outline-none focus:ring-2 focus:ring-text-primary w-64"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2 bg-surface border border-border rounded-xl text-sm font-serif focus:outline-none focus:ring-2 focus:ring-text-primary"
                >
                  <option value="all">All status</option>
                  <option value="complete">Complete</option>
                  <option value="running">Running</option>
                  <option value="queued">Queued</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            {filteredAnalyses.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="bg-surface rounded-2xl shadow-card border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-light">
                      <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Name</th>
                      <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Date</th>
                      <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Status</th>
                      <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Algorithm</th>
                      <th className="text-left px-8 py-4 text-sm font-serif text-text-secondary font-normal">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAnalyses.map((analysis) => (
                      <AnalysisRow
                        key={analysis.id}
                        analysis={analysis}
                        editingId={editingId}
                        editingName={editingName}
                        setEditingName={setEditingName}
                        onStartEdit={handleStartEdit}
                        onCancelEdit={handleCancelEdit}
                        onSaveEdit={handleSaveEdit}
                        isSaving={updateAnalysis.isPending}
                        onCancelJob={handleRequestCancelJob}
                        cancellingId={cancellingId}
                        cancellableStatuses={CANCELLABLE_STATUSES}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        </div>
      </div>
  );
}

function StatsCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-surface rounded-2xl p-8 shadow-card border border-border hover:shadow-card-hover transition-all duration-200">
      <div className="flex items-center justify-between mb-4">
        <Icon className={`w-6 h-6 ${color}`} strokeWidth={1.5} />
      </div>
      <div className="text-4xl font-serif text-text-primary mb-2">{value}</div>
      <div className="text-sm font-serif text-text-secondary">{label}</div>
    </div>
  );
}

function AnalysisRow({
  analysis,
  editingId,
  editingName,
  setEditingName,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  isSaving,
  onCancelJob,
  cancellingId,
  cancellableStatuses,
}: {
  analysis: Analysis;
  editingId: string | null;
  editingName: string;
  setEditingName: (v: string) => void;
  onStartEdit: (a: Analysis) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  isSaving?: boolean;
  onCancelJob?: (a: { id: string; name: string }) => void;
  cancellingId?: string | null;
  cancellableStatuses?: string[];
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
          <div className="group">
            <div className="flex items-center gap-2">
              <Link href={`/results/${analysis.id}`} className="flex-1">
                <span className="font-serif text-text-primary hover:text-accent transition-colors">{analysis.name}</span>
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStartEdit(analysis);
                }}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent/10 rounded-lg transition-all"
                title="Edit name"
              >
                <Edit2 className="w-4 h-4 text-text-primary" strokeWidth={1.5} />
              </button>
            </div>
            <Link href={`/results/${analysis.id}`}>
              <div className="text-sm text-text-tertiary mt-1">{analysis.fileKeys.length} files</div>
            </Link>
          </div>
        )}
      </td>
      <td className="px-8 py-5">
        <div className="text-sm font-serif text-text-secondary">{formatDate(analysis.createdAt)}</div>
      </td>
      <td className="px-8 py-5">
        <StatusBadge status={analysis.status} />
      </td>
      <td className="px-8 py-5">
        <div className="flex gap-2">
          {analysis.algorithm.map((alg) => (
            <span
              key={alg}
              className="px-2 py-1 bg-background border border-border-light rounded-lg text-xs font-serif text-text-secondary"
            >
              {alg.toUpperCase()}
            </span>
          ))}
        </div>
      </td>
      <td className="px-8 py-5">
        <div className="flex items-center gap-2">
          <Link href={`/results/${analysis.id}`}>
            <Button variant="outline" size="sm">View results</Button>
          </Link>
          {onCancelJob && cancellableStatuses?.includes(analysis.status) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancelJob(analysis);
              }}
              disabled={cancellingId === analysis.id}
              className="text-error hover:bg-error/10"
            >
              <Ban className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
              {cancellingId === analysis.id ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; color: string; bg: string; label: string }> = {
    complete: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", label: "Complete" },
    running: { icon: Clock, color: "text-info", bg: "bg-info/10", label: "Running" },
    queued: { icon: Clock, color: "text-warning", bg: "bg-warning/10", label: "Queued" },
    failed: { icon: AlertCircle, color: "text-error", bg: "bg-error/10", label: "Failed" },
    cancelled: { icon: Ban, color: "text-text-tertiary", bg: "bg-background", label: "Cancelled" },
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

function EmptyState() {
  return (
    <div className="bg-surface rounded-2xl p-32 shadow-card border border-border text-center">
      <FileText className="w-16 h-16 text-text-tertiary mx-auto mb-6" strokeWidth={1} />
      <h3 className="text-2xl font-serif text-text-primary mb-3">No analyses yet</h3>
      <p className="text-text-secondary font-serif mb-8 max-w-md mx-auto">
        Run your first CRISPR screen analysis by uploading sequencing data and selecting an sgRNA library.
      </p>
      <Link href="/upload">
        <Button variant="primary" size="lg">Upload dataset</Button>
      </Link>
    </div>
  );
}
