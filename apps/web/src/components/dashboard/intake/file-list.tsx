"use client";

/**
 * The files in this screen, while they are going up and after they have landed.
 *
 * Two things are happening to every file at once: it is being sent, and it is
 * being checksummed. Only the first is shown as a bar, because only the first
 * is what the researcher is waiting for; the checksum appears as its first
 * eight hex digits when it is done, which is what you would quote in a methods
 * section. Nothing is shown as complete until the server has confirmed the
 * uploaded object can be read back.
 */
import { AlertTriangle, Check, FileText, Loader2, Microscope, X } from "lucide-react";

import { formatBytes, type IntakeKind } from "@/lib/intake/shape";
import { cn } from "@/lib/utils";

export type ItemStatus = "queued" | "uploading" | "recording" | "done" | "failed";

export interface UploadItem {
  key: string;
  name: string;
  bytes: number;
  kind: IntakeKind;
  sent: number;
  checksum: string | null;
  status: ItemStatus;
  error: string | null;
  fileId: string | null;
}

const KIND_LABEL: Record<IntakeKind, string> = {
  counts: "Counts",
  fastq: "Reads",
  library: "Library",
};

function Progress({ item }: { item: UploadItem }) {
  if (item.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-orange-700">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Failed
      </span>
    );
  }
  if (item.status === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-cyan-600">
        <Check className="h-3 w-3" aria-hidden="true" /> Uploaded
      </span>
    );
  }
  if (item.status === "recording") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking
      </span>
    );
  }

  const pct = item.bytes > 0 ? Math.min(100, Math.round((item.sent / item.bytes) * 100)) : 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="progress-track block h-1.5 w-20"
      >
        <span className="progress-fill block bg-cyan-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="num w-9 text-right text-[11.5px] text-muted">{pct}%</span>
    </span>
  );
}

export function FileList({
  items,
  onRemove,
  busy,
}: {
  items: UploadItem[];
  onRemove: (key: string) => void;
  busy: boolean;
}) {
  if (items.length === 0) return null;

  const total = items.reduce((sum, item) => sum + item.bytes, 0);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 border-b border-line pb-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Files</span>
        <span className="num text-[11px] text-muted">
          {items.length}, {formatBytes(total)}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 py-2">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                item.status === "failed" ? "bg-orange-50 text-orange-700" : "bg-mist-soft text-muted",
              )}
              aria-hidden="true"
            >
              {item.kind === "fastq" ? <Microscope className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="truncate text-[12.5px] font-medium text-ink">{item.name}</span>
                <span className="chip bg-mist-soft text-[10.5px] uppercase tracking-[0.06em] text-muted">
                  {KIND_LABEL[item.kind]}
                </span>
                <span className="num text-[11px] text-muted">{formatBytes(item.bytes)}</span>
                {item.checksum && (
                  <span
                    className="num text-[11px] text-muted"
                    title={`SHA-256 ${item.checksum}`}
                  >
                    sha256 {item.checksum.slice(0, 8)}
                  </span>
                )}
              </span>
              {item.error && (
                <span className="mt-0.5 block text-[11.5px] leading-snug text-orange-700">{item.error}</span>
              )}
            </span>

            <Progress item={item} />

            <button
              type="button"
              onClick={() => onRemove(item.key)}
              disabled={busy && item.status === "recording"}
              aria-label={`Remove ${item.name}`}
              className="rounded-sm p-1 text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
