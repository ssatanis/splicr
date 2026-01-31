"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import Button from "@/components/Button";
import { useUser } from "@/lib/context/UserContext";
import { Analysis } from "@/lib/types";
import {
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Upload,
} from "lucide-react";
import BatchAnalysisUploader from "@/components/BatchAnalysisUploader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

const IN_PROGRESS_STATUSES = ["running", "queued", "pending"];

export default function MyAnalysesPage() {
  const { analyses, isLoading, refreshAnalyses } = useUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [filteredAnalyses, setFilteredAnalyses] = useState<Analysis[]>([]);

  useEffect(() => {
    let filtered = analyses;
    if (statusFilter !== "all") filtered = filtered.filter((a) => a.status === statusFilter);
    if (searchQuery)
      filtered = filtered.filter((a) =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    setFilteredAnalyses(filtered);
  }, [analyses, statusFilter, searchQuery]);

  // Auto-refresh list while any analysis is in progress so progress bars update
  useEffect(() => {
    const hasInProgress = analyses.some((a) => IN_PROGRESS_STATUSES.includes(a.status));
    if (!hasInProgress) return;
    const interval = setInterval(refreshAnalyses, 4000);
    return () => clearInterval(interval);
  }, [analyses, refreshAnalyses]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-[260px] min-h-screen">
        <div className="max-w-[1400px] mx-auto px-8 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6"
          >
            <div>
              <h1 className="text-6xl font-serif text-text-primary mb-2">My analyses</h1>
              <p className="text-lg text-text-secondary">
                All CRISPR screen runs and their status.
              </p>
            </div>
            <Link href="/upload">
              <Button variant="primary" size="lg">
                <Upload className="w-5 h-5 mr-2" strokeWidth={1.5} />
                New analysis
              </Button>
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-wrap items-center gap-4 mb-8"
          >
            <div className="relative flex-1 min-w-[200px]">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary"
                strokeWidth={1.5}
              />
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-xl text-sm font-serif focus:outline-none focus:ring-2 focus:ring-text-primary"
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
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="created">Created</option>
            </select>
          </motion.div>

          {isLoading ? (
            <div className="bg-surface rounded-2xl p-32 shadow-card border border-border">
              <div className="flex items-center justify-center">
                <div className="animate-pulse text-text-secondary font-serif">Loading analyses...</div>
              </div>
            </div>
          ) : filteredAnalyses.length === 0 ? (
            <div className="bg-surface rounded-2xl p-32 shadow-card border border-border text-center">
              <FileText className="w-16 h-16 text-text-tertiary mx-auto mb-6" strokeWidth={1} />
              <h3 className="text-2xl font-serif text-text-primary mb-3">No analyses found</h3>
              <p className="text-text-secondary font-serif mb-8 max-w-md mx-auto">
                {analyses.length === 0
                  ? "Upload FASTQ files and start your first screen analysis."
                  : "No analyses match your filters."}
              </p>
              <Link href="/upload">
                <Button variant="primary" size="lg">Upload dataset</Button>
              </Link>
            </div>
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
                    <tr
                      key={analysis.id}
                      className="border-b border-border-light hover:bg-background transition-colors duration-200"
                    >
                      <td className="px-8 py-5">
                        <Link href={`/results/${analysis.id}`} className="block">
                          <div className="font-serif text-text-primary hover:text-accent transition-colors">{analysis.name}</div>
                          <div className="text-sm text-text-tertiary mt-1">{analysis.fileKeys.length} files</div>
                        </Link>
                      </td>
                      <td className="px-8 py-5 text-sm font-serif text-text-secondary">
                        {formatDate(analysis.createdAt)}
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-2 min-w-[140px]">
                          <StatusBadge status={analysis.status} />
                          {(analysis.status === "running" || analysis.status === "queued" || analysis.status === "pending") && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-background rounded-full overflow-hidden border border-border-light">
                                <div
                                  className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                                  style={{ width: `${Math.min(100, Math.max(0, analysis.progress ?? 0))}%` }}
                                />
                              </div>
                              <span className="text-xs font-serif text-text-tertiary tabular-nums w-8">
                                {Math.round(analysis.progress ?? 0)}%
                              </span>
                            </div>
                          )}
                        </div>
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
                        <Link href={`/results/${analysis.id}`}>
                          <Button variant="outline" size="sm">View results</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredAnalyses.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-12"
            >
              <BatchAnalysisUploader />
            </motion.section>
          )}
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; color: string; bg: string; label: string }> = {
    complete: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", label: "Complete" },
    running: { icon: Clock, color: "text-info", bg: "bg-info/10", label: "Running" },
    queued: { icon: Clock, color: "text-warning", bg: "bg-warning/10", label: "Queued" },
    pending: { icon: Clock, color: "text-info", bg: "bg-info/10", label: "In progress" },
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
