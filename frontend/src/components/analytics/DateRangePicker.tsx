"use client";

import { cn } from "@/lib/utils";

const RANGES = [
  { key: "1M", label: "1 Month" },
  { key: "3M", label: "3 Months" },
  { key: "6M", label: "6 Months" },
  { key: "1Y", label: "1 Year" },
  { key: "all", label: "All time" },
] as const;

export type DateRangeKey = (typeof RANGES)[number]["key"];

interface DateRangePickerProps {
  value: DateRangeKey;
  onChange: (range: DateRangeKey) => void;
  className?: string;
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {RANGES.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "px-4 py-2 rounded-xl text-sm font-serif transition-colors",
            value === key
              ? "bg-accent text-white shadow-md"
              : "bg-surface border border-border text-text-secondary hover:bg-background hover:border-accent/50"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
