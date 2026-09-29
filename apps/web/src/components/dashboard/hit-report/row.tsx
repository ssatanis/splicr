"use client";

/**
 * A hit row that opens into its evidence.
 *
 * The table shows the few columns a reader scans (gene, direction, effect, FDR,
 * guide support, flags, Atlas history, bench status). Everything else recorded
 * for the gene sits one click away, in a row of its own: every statistic, each
 * flag with its message, the individual guide effects, the stored model output
 * and what the Atlas says. The cells and the detail are rendered on the server
 * and passed in, so this component holds one boolean and no data.
 */
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { ROW_HIT } from "../ui";

export function ExpandableHitRow({
  gene,
  cells,
  detail,
  columns,
}: {
  gene: string;
  cells: ReactNode;
  detail: ReactNode;
  columns: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <tr className={ROW_HIT}>
        <td>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-ink hover:text-orange-600"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-[var(--dur-1)] motion-reduce:transition-none", open && "rotate-90")}
              aria-hidden="true"
            />
            {gene}
            <span className="sr-only">{open ? ", hide the evidence" : ", show the evidence"}</span>
          </button>
        </td>
        {cells}
      </tr>
      {open && (
        <tr id={panelId}>
          <td colSpan={columns} className="!whitespace-normal bg-canvas/70 !py-3">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}
