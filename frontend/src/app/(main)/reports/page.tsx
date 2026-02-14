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
  Edit2,
  Save,
  X,
  Clock,
  AlertCircle,
  Dna,
  Activity,
  Target,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

type FilterType = "all" | "screen" | "editability" | "translation";

const filterTabs: { id: FilterType; label: string; icon: React.ElementType; color: string }[] = [
  { id: "all", label: "All Results", icon: BarChart3, color: "text-text-primary" },
  { id: "screen", label: "Screen Results", icon: Dna, color: "text-blue-400" },
  { id: "editability", label: "Editability", icon: Activity, color: "text-emerald-400" },
  { id: "translation", label: "Translation", icon: Target, color: "text-violet-400" },
];

export default function ReportsPage() {
  const { data: analyses = [] } = useAnalyses();
  const updateAnalysis = useUpdateAnalysis();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  const completed = analyses.filter((a) => a.status === "complete").length;

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
  ).slice(0, 20), [analyses]);

  const showScreenResults = activeFilter === "all" || activeFilter === "screen";
  const showToolCards = activeFilter === "all" || activeFilter === "editability" || activeFilter === "translation";

  return (
    <div className="min-h-screen">
      <div className="max-w-[1200px] mx-auto px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <h1 className="text-5xl font-serif text-text-primary mb-2">Reports</h1>
          <p className="text-text-secondary font-serif">
            Unified results hub — CRISPR screens, editability analyses, and therapeutic translations.
          </p>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-4 mb-8"
        >
          <div className="bg-surface rounded-2xl p-6 shadow-card border border-border">
            <div className="flex items-center gap-3 mb-3">
              <Dna className="w-6 h-6 text-blue-400" strokeWidth={1.5} />
              <span className="font-serif text-text-secondary text-sm">Screen Analyses</span>
            </div>
            <div className="text-3xl font-serif text-text-primary">{analyses.length}</div>
            <p className="text-xs text-text-tertiary mt-1 font-serif">{completed} completed</p>
          </div>
          <div className="bg-surface rounded-2xl p-6 shadow-card border border-border">
            <div className="flex items-center gap-3 mb-3">
              <Activity className="w-6 h-6 text-emerald-400" strokeWidth={1.5} />
              <span className="font-serif text-text-secondary text-sm">TEA Analyses</span>
            </div>
            <div className="text-3xl font-serif text-text-primary">—</div>
            <p className="text-xs text-text-tertiary mt-1 font-serif">Stored per session</p>
          </div>
          <div className="bg-surface rounded-2xl p-6 shadow-card border border-border">
            <div className="flex items-center gap-3 mb-3">
              <Target className="w-6 h-6 text-violet-400" strokeWidth={1.5} />
              <span className="font-serif text-text-secondary text-sm">TxScore Targets</span>
            </div>
            <div className="text-3xl font-serif text-text-primary">—</div>
            <p className="text-xs text-text-tertiary mt-1 font-serif">Saved to workspace</p>
          </div>
        </motion.div>

        {/* Filter tabs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex gap-2 mb-8 border-b border-border pb-0"
        >
          {filterTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-serif border-b-2 transition-all -mb-px ${
                  isActive
                    ? `border-accent ${tab.color} font-medium`
                    : "border-transparent text-text-secondary hover:text-text-primary"
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.5} />
                {tab.label}
              </button>
            );
          })}
        </motion.div>

        {/* Tool Quick-Access Cards (Editability / Translation) */}
        {showToolCards && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8"
          >
            {(activeFilter === "all" || activeFilter === "editability") && (
              <div className="bg-surface border border-emerald-400/20 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-emerald-400/10 rounded-lg">
                    <Activity className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-serif text-text-primary font-medium">Editability Atlas (TEA)</h3>
                    <p className="text-xs text-text-tertiary font-serif">EDIT score & therapeutic window</p>
                  </div>
                </div>
                <p className="text-text-secondary text-xs font-serif mb-4">
                  TEA analyses run in-session. Navigate to the Editability Atlas to analyze variants and view results.
                </p>
                <Link href="/tea">
                  <Button variant="outline" size="sm" className="inline-flex items-center gap-1.5 border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Editability Atlas
                  </Button>
                </Link>
              </div>
            )}
            {(activeFilter === "all" || activeFilter === "translation") && (
              <div className="bg-surface border border-violet-400/20 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-violet-400/10 rounded-lg">
                    <Target className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h3 className="font-serif text-text-primary font-medium">Therapeutic Translation</h3>
                    <p className="text-xs text-text-tertiary font-serif">TVS scores & target workspace</p>
                  </div>
                </div>
                <p className="text-text-secondary text-xs font-serif mb-4">
                  View ranked therapeutic targets, saved gene lists, and target dossiers in the Translation dashboard.
                </p>
                <Link href="/txscore">
                  <Button variant="outline" size="sm" className="inline-flex items-center gap-1.5 border-violet-400/30 text-violet-400 hover:bg-violet-400/10">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Translation Dashboard
                  </Button>
                </Link>
              </div>
            )}
          </motion.div>
        )}

        {/* CRISPR Screen Results Table */}
        {showScreenResults && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-surface rounded-2xl shadow-card border border-border overflow-hidden"
          >
            <div className="px-8 pt-8 pb-4 flex items-center justify-between">
              <h2 className="text-xl font-serif text-text-primary flex items-center gap-2">
                <Dna className="w-5 h-5 text-blue-400" strokeWidth={1.5} />
                CRISPR Screen Analyses
              </h2>
              <Link href="/upload">
                <Button variant="outline" size="sm" className="text-xs">New Screen</Button>
              </Link>
            </div>
            {recentAnalyses.length === 0 ? (
              <p className="px-8 pb-8 text-text-tertiary font-serif">No screen analyses yet.</p>
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
        )}
      </div>
    </div>
  );
}

function ReportsAnalysisRow({
  analysis, editingId, editingName, setEditingName, onStartEdit, onCancelEdit, onSaveEdit, isSaving,
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
                if (e.key === "Enter") { e.preventDefault(); onSaveEdit(analysis.id); }
                if (e.key === "Escape") onCancelEdit();
              }}
              className="flex-1 min-w-[120px] px-3 py-2 bg-background border border-border rounded-lg text-sm font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSaveEdit(analysis.id); }}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 shrink-0 px-3 py-2 bg-success/15 text-success hover:bg-success/25 rounded-lg transition-colors cursor-pointer disabled:opacity-50 font-serif text-sm"
              title="Save"
            >
              <Save className="w-4 h-4 shrink-0" strokeWidth={1.5} />
              Save
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancelEdit(); }}
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
        <div className="flex items-center gap-2">
          <Link href={`/results/${analysis.id}`}>
            <Button variant="outline" size="sm">View results</Button>
          </Link>
          {analysis.status === "complete" && (
            <Link href={`/txscore?from=${analysis.id}`}>
              <Button variant="outline" size="sm" className="text-violet-400 border-violet-400/30 hover:bg-violet-400/10 text-xs">
                → TxScore
              </Button>
            </Link>
          )}
        </div>
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
