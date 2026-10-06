"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { ScreensExportDialog } from "./screens-export-dialog";
import { DenseTable } from "@/components/dashboard/ui";
import { deleteScreen } from "@/lib/data/screen-actions";
import type { ScreenListRow } from "@/lib/data/workspace-lists";

export function ScreensTable({ screens, canDelete = false }: { screens: ScreenListRow[]; canDelete?: boolean }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (showConfirm) deleteDialog.current?.showModal();
  }, [showConfirm]);
  const selectedScreens = screens.filter(screen => selectedIds.has(screen.id));
  const selection = selectedScreens.map(screen => screen.id);

  const toggleSelectAll = () => {
    if (selectedScreens.length === screens.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(screens.map(s => s.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    const deleted = new Set<string>();
    try {
      for (const id of selection) {
        const result = await deleteScreen(id);
        if (!result.ok) {
          setError(`${deleted.size} deleted. ${result.error} Remaining screens are still selected.`);
          break;
        }
        deleted.add(id);
      }
      if (deleted.size === selection.length) {
        setSelectMode(false); setShowConfirm(false);
      }
    } catch {
      setError(`${deleted.size} deleted. Deletion could not finish. Remaining screens are still selected.`);
    } finally {
      setSelectedIds(current => new Set([...current].filter(id => !deleted.has(id))));
      if (deleted.size > 0) router.refresh();
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium text-ink">
          {selectMode ? `${selectedScreens.length} selected` : "Recorded screens"}
        </h2>
        <div className="flex gap-2">
          {selectMode ? (
            <>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                className="inline-flex h-7 items-center justify-center rounded px-3 text-[12px] font-medium text-muted hover:text-ink hover:bg-line/50 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={() => setShowExport(true)} disabled={selection.length === 0 || isDeleting}
                className="inline-flex h-7 items-center justify-center gap-1.5 rounded border border-line px-3 text-[12px] font-medium text-ink hover:bg-line/50 disabled:opacity-50">
                <Download className="h-3.5 w-3.5" />Export selected
              </button>
              {canDelete && (
              <button
                type="button"
                onClick={() => { setError(null); setShowConfirm(true); }}
                disabled={selection.length === 0 || isDeleting}
                className="inline-flex h-7 items-center justify-center gap-1.5 rounded bg-red-50 px-3 text-[12px] font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected
              </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              disabled={screens.length === 0}
              className="inline-flex h-7 items-center justify-center rounded px-3 text-[12px] font-medium text-cyan-600 hover:bg-cyan-50 transition-colors disabled:opacity-50"
            >
              Select screens
            </button>
          )}
        </div>
      </div>

      <DenseTable minWidth={760}>
        <caption className="sr-only">Your workspace experiments and recorded analysis status</caption>
        <thead>
          <tr>
            {selectMode && (
              <th scope="col" className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all screens on this page"
                  disabled={isDeleting}
                  checked={screens.length > 0 && selectedScreens.length === screens.length}
                  onChange={toggleSelectAll}
                  className="rounded border-line text-cyan-600 focus:ring-cyan-600"
                />
              </th>
            )}
            {["Screen", "Cell line", "Phenotype", "Modality", "Status", "QC"].map((heading) => (
              <th key={heading} scope="col">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {screens.map((screen) => {
            const isActive = screen.status === "queued" || screen.status === "running" || screen.status === "analysing" || screen.status === "pending";
            
            let progressPercent = 0;
            if (screen.current_run?.stages) {
               const completedCount = screen.current_run.stages.filter(s => s.status === 'done' || s.status === 'skipped').length;
               progressPercent = Math.min(100, Math.max(5, (completedCount / 9) * 100));
            }

            return (
              <tr key={screen.id} className={selectedIds.has(screen.id) ? "bg-cyan-50/50" : ""}>
                {selectMode && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${screen.name}`}
                      disabled={isDeleting}
                      checked={selectedIds.has(screen.id)}
                      onChange={() => toggleSelect(screen.id)}
                      className="rounded border-line text-cyan-600 focus:ring-cyan-600"
                    />
                  </td>
                )}
                <td>
                  {isActive ? (
                    <span className="text-muted">{screen.name}</span>
                  ) : (
                    <Link href={`/dashboard/screens/${screen.id}`} className="underline text-cyan-600 hover:text-cyan-800">
                      {screen.name}
                    </Link>
                  )}
                </td>
                <td>{screen.cell_line ?? "Not recorded"}</td>
                <td>{screen.phenotype ?? "Not recorded"}</td>
                <td>{screen.modality}</td>
                <td className="w-32">
                  {isActive ? (
                    <div className="flex flex-col gap-1.5 w-full pr-4 mt-1">
                      <div className="flex items-center justify-between text-[10px] font-medium text-ink uppercase tracking-wider">
                        <span>{screen.status}</span>
                        <span>{Math.round(progressPercent)}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-cyan-600 transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
                      </div>
                    </div>
                  ) : (
                    screen.status
                  )}
                </td>
                <td>{screen.qc}</td>
              </tr>
            );
          })}
        </tbody>
      </DenseTable>

      {showExport && <ScreensExportDialog screenIds={selection} onClose={() => setShowExport(false)} />}

      {showConfirm && (
        <dialog ref={deleteDialog} onCancel={event => { event.preventDefault(); if (!isDeleting) setShowConfirm(false); }} aria-labelledby="delete-screens-title" className="m-auto w-[min(448px,calc(100vw-32px))] rounded-xl border border-line bg-white p-6 shadow-xl backdrop:bg-black/30">
            <h2 id="delete-screens-title" className="text-lg font-semibold text-ink">Delete selected screens</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-body">
              Permanently delete <strong>{selection.length} screens</strong> and their associated analysis records? This action cannot be undone.
            </p>
            {error && <p role="alert" className="mt-3 text-[12px] font-medium text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={isDeleting}
                className="rounded-md border border-line px-4 py-2 text-[12px] font-medium text-ink hover:bg-mist-soft disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-md bg-red-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Yes, delete screens"}
              </button>
            </div>
        </dialog>
      )}
    </>
  );
}
