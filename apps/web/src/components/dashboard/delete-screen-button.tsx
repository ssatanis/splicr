"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { deleteScreen } from "@/lib/data/screen-actions";

export function DeleteScreenButton({ screenId, screenName, disabled, iconOnly }: { screenId: string; screenName: string; disabled?: boolean; iconOnly?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    const result = await deleteScreen(screenId);
    if (!result.ok) {
      setError(result.error);
      setIsDeleting(false);
    } else {
      router.push("/dashboard/screens");
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        title="Delete screen"
        className={`inline-flex h-7 items-center justify-center rounded bg-red-50 text-[12px] text-red-600 hover:bg-red-100 disabled:opacity-50 ${iconOnly ? "w-7" : "px-2 gap-1.5"}`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {!iconOnly && "Delete screen"}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-line bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-ink">Delete Screen</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-body">
              Are you sure you want to permanently delete <strong>{screenName}</strong>? This action cannot be undone. All associated files, count tables, analysis runs, and evidence records will be genuinely and permanently removed.
            </p>
            {error && <p className="mt-3 text-[12px] font-medium text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
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
                {isDeleting ? "Deleting..." : "Yes, delete screen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
