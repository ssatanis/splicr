"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileText, FileSpreadsheet, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExportButtonProps {
  onExportPDF?: () => void;
  onExportCSV?: () => void;
  className?: string;
}

export function ExportButton({ onExportPDF, onExportCSV, className }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-border text-text-primary font-serif text-sm hover:bg-background hover:border-accent/50 transition-colors"
      >
        <Download className="w-4 h-4" strokeWidth={1.5} />
        Export report
        <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 py-2 rounded-xl bg-surface border border-border shadow-elevated z-10 min-w-[200px]">
          <button
            type="button"
            onClick={() => {
              onExportPDF?.();
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-serif text-text-primary hover:bg-background transition-colors"
          >
            <FileText className="w-4 h-4 text-text-tertiary" />
            Download as PDF
          </button>
          <button
            type="button"
            onClick={() => {
              onExportCSV?.();
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-serif text-text-primary hover:bg-background transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-text-tertiary" />
            Download as CSV
          </button>
        </div>
      )}
    </div>
  );
}
