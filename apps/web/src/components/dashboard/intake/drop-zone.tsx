"use client";

/**
 * Where a researcher puts their sequencing.
 *
 * It is a button as well as a drop target, because a drop target that is only a
 * drop target excludes anyone not using a mouse, and because about half of all
 * people reach for the file picker anyway. The same element handles both, so
 * there is one affordance and not two.
 *
 * Dropped folders are walked. A core hands back a run directory, and asking a
 * researcher to open it and select sixteen files by hand is work the browser
 * can do.
 */
import { UploadCloud } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ACCEPT_ATTRIBUTE } from "@/lib/intake/shape";

/** Everything under a dropped directory, depth first, to a sane depth. */
async function walk(entry: FileSystemEntry, depth = 0): Promise<File[]> {
  if (depth > 6) return [];
  if (entry.isFile) {
    return new Promise<File[]>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return [];

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = [];
  // readEntries returns at most 100 at a time and signals the end with an
  // empty batch. A single call silently truncates a large run directory.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  const nested = await Promise.all(entries.map((child) => walk(child, depth + 1)));
  return nested.flat();
}

async function filesFrom(transfer: DataTransfer): Promise<File[]> {
  const items = [...transfer.items].filter((item) => item.kind === "file");
  const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.some((entry) => entry?.isDirectory)) {
    const walked = await Promise.all(entries.map((entry) => (entry ? walk(entry) : Promise.resolve([]))));
    return walked.flat();
  }
  return [...transfer.files];
}

export function DropZone({
  onFiles,
  disabled = false,
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // Drag events fire for every child element, so a plain boolean flickers.
  const depth = useRef(0);

  const open = useCallback(() => {
    if (!disabled) input.current?.click();
  }, [disabled]);

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        if (!disabled) setOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        void filesFrom(event.dataTransfer).then((files) => {
          if (files.length > 0) onFiles(files);
        });
      }}
      className={cn(
        "relative rounded-xl border border-dashed transition-colors duration-[var(--dur-2)] motion-reduce:transition-none",
        over ? "border-cyan-500 bg-cyan-50/60" : "border-line-strong bg-mist-soft/40",
        disabled && "opacity-60",
      )}
    >
      <input
        ref={input}
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />

      <button
        type="button"
        onClick={open}
        disabled={disabled}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-xl text-center outline-none focus-visible:ring-2 focus-visible:ring-cyan-500",
          compact ? "px-4 py-5" : "px-6 py-10",
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-white text-cyan-600 shadow-[var(--shadow-card)] transition-transform duration-[var(--dur-2)] motion-reduce:transition-none",
            compact ? "h-8 w-8" : "h-11 w-11",
            over && "scale-110",
          )}
        >
          <UploadCloud className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden="true" />
        </span>
        <span className={cn("font-medium text-ink", compact ? "mt-1 text-[12.5px]" : "mt-2 text-sm")}>
          {over ? "Drop to add them" : compact ? "Add more files" : "Drop your sequencing here"}
        </span>
        {!compact && (
          <span className="max-w-sm text-[12px] leading-snug text-muted">
            Count tables or FASTQ, gzipped or not. A whole run folder works too.
          </span>
        )}
      </button>
    </div>
  );
}
