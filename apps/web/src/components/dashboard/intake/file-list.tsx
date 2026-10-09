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
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Microscope,
  RotateCcw,
  X,
} from "lucide-react";

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
  context: "Supporting file",
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
  if (item.status === "queued")
    return <span className="text-[11.5px] text-muted">Waiting</span>;
  if (item.status === "recording") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking
      </span>
    );
  }

  const pct =
    item.bytes > 0 ? Math.min(100, Math.round((item.sent / item.bytes) * 100)) : 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="progressbar"
        aria-label={`Uploading ${item.name}`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="progress-track block h-1.5 w-16 sm:w-20"
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
  onRetry,
  onPurpose,
  inspection,
  busy,
}: {
  items: UploadItem[];
  onRemove: (key: string) => void;
  onRetry?: (key: string) => void;
  onPurpose?: (key: string, kind: IntakeKind) => void;
  busy: boolean;
  inspection?: (item: UploadItem) => ReactNode;
}) {
  if (items.length === 0) return null;

  const total = items.reduce((sum, item) => sum + item.bytes, 0);

  return (
    <div className="overflow-hidden rounded-sm border border-stone-200 bg-white">
      <div className="flex items-baseline justify-between gap-2 border-b border-stone-200 bg-canvas/60 px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          Attached files
        </span>
        <span className="num text-[11px] text-muted">
          {items.filter((item) => item.status === "done").length}/{items.length} uploaded,{" "}
          {formatBytes(total)}
        </span>
      </div>
      <ul className="divide-y divide-line" aria-label="Attached files" aria-live="polite">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex flex-wrap items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4"
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-sm",
                item.status === "failed"
                  ? "bg-orange-50 text-orange-700"
                  : "bg-mist-soft text-muted",
              )}
              aria-hidden="true"
            >
              {item.kind === "fastq" ? (
                <Microscope className="h-3.5 w-3.5" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
            </span>

            <span className="min-w-0 flex-1 basis-1/2 sm:basis-auto">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className="max-w-full truncate text-[12.5px] font-medium text-ink"
                  title={item.name}
                >
                  {item.name}
                </span>
                <span className="chip bg-mist-soft text-[10.5px] uppercase tracking-[0.06em] text-muted">
                  {KIND_LABEL[item.kind]}
                </span>
                <span className="num text-[11px] text-muted">
                  {formatBytes(item.bytes)}
                </span>
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
                <span className="mt-0.5 block text-[11.5px] leading-snug text-orange-700">
                  {item.error}
                </span>
              )}
            </span>

            <Progress item={item} />
            {item.status === "failed" && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(item.key)}
                disabled={busy}
                aria-label={`Retry ${item.name}`}
                className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-[11px] text-navy hover:bg-mist-soft disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Retry
              </button>
            )}
            {onPurpose && item.status === "done" && (
              <select
                aria-label={`Purpose of ${item.name}`}
                value={item.kind}
                disabled={busy}
                onChange={(event) =>
                  onPurpose(item.key, event.target.value as IntakeKind)
                }
                className="h-7 max-w-32 rounded border border-stone-200 bg-white text-[11px] text-ink"
              >
                {Object.entries(KIND_LABEL).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => onRemove(item.key)}
              disabled={busy && item.status !== "uploading" && item.status !== "queued"}
              aria-label={`Remove ${item.name}`}
              className="rounded-sm p-1 text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {item.status === "done" && inspection && (
              <details className="w-full pl-0 sm:pl-12">
                <summary className="w-fit cursor-pointer text-[11.5px] text-navy">
                  Inspect file
                </summary>
                <div className="mt-2 space-y-2">{inspection(item)}</div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
