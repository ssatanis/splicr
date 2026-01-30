"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import ReportBuilder from "./ReportBuilder";
import type { AnalysisContextForReport } from "@/types/report";

interface ReportBuilderModalProps {
  open: boolean;
  onClose: () => void;
  analysisContext?: Partial<AnalysisContextForReport>;
  analysisName?: string;
}

export default function ReportBuilderModal({
  open,
  onClose,
  analysisContext,
  analysisName = "Report",
}: ReportBuilderModalProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 bg-surface/80 backdrop-blur-md rounded-b-2xl shadow-sm">
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">
              Create Report
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2.5 rounded-xl hover:bg-background/80 text-text-secondary hover:text-text-primary transition-colors focus:ring-2 focus:ring-success/30 focus:outline-none"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.05 }}
              className="h-full"
            >
              <ReportBuilder
                analysisContext={analysisContext}
                onClose={onClose}
                initialTitle={analysisName}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
