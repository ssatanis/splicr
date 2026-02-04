"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import Button from "@/components/Button";

export function AnalyticsEmptyState() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-16 text-center shadow-card">
      <BarChart3 className="w-16 h-16 text-text-tertiary mx-auto mb-6" strokeWidth={1} />
      <h3 className="text-2xl font-serif text-text-primary mb-3">No analytics yet</h3>
      <p className="text-text-secondary font-serif mb-8 max-w-md mx-auto">
        Start your first analysis to see usage stats, screen types, and activity over time here.
      </p>
      <Link href="/upload">
        <Button variant="primary" size="lg">
          Create analysis
        </Button>
      </Link>
    </div>
  );
}
