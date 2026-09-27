"use client";

/**
 * The side drawer every dashboard surface opens over its table.
 *
 * It exists because the pattern was already written correctly once, in the
 * command palette and in the overview's evidence panel, and then written again
 * by hand on the screen workspace without any of it: no role, no aria-modal, no
 * Escape, no focus trap, no focus restore, and a bare div as the dismiss
 * overlay. A keyboard user could open that drawer and had no way out of it.
 *
 * So the behaviour lives here and the callers supply content. A modal owes the
 * reader four things and this gives all four: it takes focus when it opens, it
 * keeps Tab inside itself, Escape closes it, and focus goes back to whatever
 * opened it.
 */

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalDrawer({
  title,
  eyebrow,
  onClose,
  children,
  closeLabel = "Close",
  className,
}: {
  title: ReactNode;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const stops = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* A button, not a div with a click handler: the overlay is a control, and
          a control that only a mouse can reach is not one. It is out of the tab
          order because Escape and the close button are the keyboard routes. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-teal-950/40"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative h-full w-full max-w-md overflow-y-auto thin-scroll bg-white p-5 shadow-float outline-none md:p-6",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            <h2 id={titleId} className="text-2xl font-medium tracking-tight text-ink">
              {title}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="icon-btn h-9 w-9" aria-label={closeLabel}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
