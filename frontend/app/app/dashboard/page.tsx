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
  Activity,
  XCircle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default function DashboardPage() {
  const { analyses, isLoading } = useUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [filteredAnalyses, setFilteredAnalyses] = useState<Analysis[]>([]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const stats = {
    total: analyses.length,
    completed: analyses.filter((a) => a.status === "complete").length,
    running: analyses.filter((a) => a.status === "running" || a.status === "queued").length,
    failed: analyses.filter((a) => a.status === "failed").length,
  };

  useEffect(() => {
    let filtered = analyses;
    if (statusFilter !== "all") filtered = filtered.filter((a) => a.status === statusFilter);
    if (searchQuery)
      filtered = filtered.filter((a) =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    setFilteredAnalyses(filtered);
  }, [analyses, statusFilter, searchQuery]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-[260px] min-h-screen">
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
                </select>
              </div>
            </div>

            {isLoading ? (
              <div className="bg-surface rounded-2xl p-32 shadow-card border border-border">
                <div className="flex items-center justify-center">
                  <div className="animate-pulse text-text-secondary font-serif">
                    Loading analyses...
                  </div>
                </div>
              </div>
            ) : filteredAnalyses.length === 0 ? (
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
                      <AnalysisRow key={analysis.id} analysis={analysis} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        </div>
      </main>
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

function AnalysisRow({ analysis }: { analysis: Analysis }) {
  return (
    <tr className="border-b border-border-light hover:bg-background transition-colors duration-200">
      <td className="px-8 py-5">
        <Link href={`/app/results/${analysis.id}`} className="block">
          <div className="font-serif text-text-primary hover:text-accent transition-colors">{analysis.name}</div>
          <div className="text-sm text-text-tertiary mt-1">{analysis.fileKeys.length} files</div>
        </Link>
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
        <Link href={`/app/results/${analysis.id}`}>
          <Button variant="outline" size="sm">View results</Button>
        </Link>
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
      <Link href="/app">
        <Button variant="primary" size="lg">Upload dataset</Button>
      </Link>
    </div>
  );
}
