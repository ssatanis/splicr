"use client";

import { cn } from "@/lib/utils";

export function MetricsCardsSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6", className)}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-border bg-surface p-6 animate-pulse"
        >
          <div className="h-6 w-6 bg-border rounded mb-4" />
          <div className="h-9 w-16 bg-border rounded mb-2" />
          <div className="h-4 w-24 bg-border rounded" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-6 animate-pulse min-h-[320px]",
        className
      )}
    >
      <div className="h-5 w-40 bg-border rounded mb-4" />
      <div className="h-[280px] w-full bg-border/50 rounded-lg" />
    </div>
  );
}

export function TimelineSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-6 animate-pulse min-h-[200px]",
        className
      )}
    >
      <div className="h-5 w-32 bg-border rounded mb-4" />
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-border" />
            <div className="flex-1">
              <div className="h-4 w-3/4 bg-border rounded mb-2" />
              <div className="h-3 w-20 bg-border rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
