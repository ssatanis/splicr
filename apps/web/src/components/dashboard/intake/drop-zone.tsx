"use client";

import { FolderOpen, LockKeyhole, Upload } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Directory readers return batches of at most 100 entries. Read every batch. */
async function walk(entry: FileSystemEntry, depth = 0): Promise<File[]> {
  if (depth > 20) throw new Error("This folder is nested too deeply. Select the files directly.");
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([new File([file], entry.fullPath.replace(/^\//, ""), { type: file.type, lastModified: file.lastModified })]),
        () => reject(new Error(`Could not read ${entry.name}. Select it with Browse files.`)),
      );
    });
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  return (await Promise.all(entries.map((child) => walk(child, depth + 1)))).flat();
}

function filesFrom(transfer: DataTransfer): Promise<File[]> {
  // Capture handles synchronously: browsers clear the drag data after onDrop returns.
  const files = Array.from(transfer.files);
  const handles = Array.from(transfer.items ?? []).filter((item) => item.kind === "file")
    .map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  if (!handles.some(({ entry }) => entry?.isDirectory)) return Promise.resolve(files);
  return Promise.all(handles.map(({ entry, file }) => entry ? walk(entry) : Promise.resolve(file ? [file] : [])))
    .then((groups) => groups.flat());
}

export function DropZone({ onFiles, disabled = false, compact = false }: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);
  const open = useCallback(() => { if (!disabled) input.current?.click(); }, [disabled]);

  return (
    <div>
      <div
        data-testid="file-drop-zone"
        onDragEnter={(event) => { event.preventDefault(); depth.current += 1; if (!disabled) setOver(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
        onDragLeave={(event) => { event.preventDefault(); depth.current -= 1; if (depth.current <= 0) { depth.current = 0; setOver(false); } }}
        onDrop={(event) => {
          event.preventDefault(); depth.current = 0; setOver(false);
          if (disabled) return;
          setError(null);
          void filesFrom(event.dataTransfer).then((files) => { if (files.length) onFiles(files); })
            .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not read the dropped files. Try Browse files."));
        }}
        className={cn(
          "relative overflow-hidden rounded-2xl border border-dashed transition-colors motion-reduce:transition-none",
          over ? "border-navy bg-navy-tint" : "border-stone-200-strong bg-gradient-to-b from-canvas to-white",
          disabled && "opacity-60",
        )}
      >
        <input ref={input} id={inputId} type="file" multiple disabled={disabled} className="sr-only"
          aria-label="Upload experiment files" tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = ""; setError(null);
            if (files.length) onFiles(files);
          }}
        />
        <div className={cn("flex items-center justify-center gap-6", compact ? "flex-wrap px-5 py-4" : "flex-col px-5 py-9 sm:py-11")}>
          <div className={cn("flex shrink-0 items-center justify-center rounded-2xl border border-stone-200 bg-white text-navy shadow-sm", compact ? "h-10 w-10" : "h-14 w-14", over && "scale-105")}>
            <Upload className={compact ? "h-5 w-5" : "h-6 w-6"}/>
          </div>
          <div className={cn(compact ? "min-w-0 flex-1" : "text-center")}>
            <p className={cn("font-medium tracking-tight text-ink", compact ? "text-sm" : "text-lg")}>
              {over ? "Drop to add your files" : compact ? "Add more files" : "Your experiment starts here"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {compact ? "Drag and drop files or folders." : "Drag and drop your files, or browse to select them."}
            </p>
          </div>
          <button type="button" onClick={open} disabled={disabled}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-sm bg-navy px-5 text-[13px] font-medium text-white shadow-sm outline-none transition-colors hover:bg-navy-hover focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:cursor-wait">
            <FolderOpen className="h-4 w-4" aria-hidden="true"/> Browse files
          </button>
          {!compact && <p className="text-center text-[11.5px] text-muted">Any file type, Up to 64 files at once, 50 GB per file</p>}
        </div>
        {!compact && <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-stone-200 bg-white/70 px-4 py-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3 w-3" aria-hidden="true"/> Private to your workspace</span>
          <span>Folders are optional. Drop one here to include its files.</span>
        </div>}
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-orange-700">{error}</p>}
    </div>
  );
}
