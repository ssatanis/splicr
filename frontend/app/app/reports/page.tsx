"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import { useUser } from "@/lib/context/UserContext";
import {
  BarChart3,
  FileText,
  CheckCircle2,
  TrendingUp,
  PieChart,
} from "lucide-react";
import Link from "next/link";

export default function ReportsPage() {
  const { analyses } = useUser();
  const completed = analyses.filter((a) => a.status === "complete").length;
  const byAlgorithm = analyses.reduce(
    (acc, a) => {
      a.algorithm.forEach((alg) => {
        acc[alg] = (acc[alg] || 0) + 1;
      });
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-[260px] min-h-screen">
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
            transition={{ delay: 0.3 }}
          >
            <h2 className="text-2xl font-serif text-text-primary mb-6 flex items-center gap-3">
              <FileText className="w-6 h-6" strokeWidth={1.5} />
              Quick actions
            </h2>
            <div className="flex flex-wrap gap-4">
              <Link href="/app">
                <button className="px-6 py-3 bg-accent text-text-primary font-serif rounded-xl hover:opacity-90 transition-opacity">
                  New analysis
                </button>
              </Link>
              <Link href="/app/analyses">
                <button className="px-6 py-3 bg-surface border border-border text-text-primary font-serif rounded-xl hover:bg-background transition-colors">
                  View all analyses
                </button>
              </Link>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
