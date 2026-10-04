"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { switchWorkspace } from "@/lib/data/actions";
import { ROLE_LABEL, type WorkspaceOption } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * The way back to a researcher's other laboratory.
 *
 * It exists because an invitation moves where somebody lands. Being invited to
 * a second laboratory makes that one the workspace the console opens, which is
 * what the invitation promises; without this menu that would be a one-way door
 * and the laboratory they came from would have no route back to it.
 *
 * It renders nothing at all for the ordinary case of one membership. A control
 * that offers a single choice is a control that teaches a reader to ignore
 * controls.
 */
export function WorkspaceMenu({
  current,
  workspaces,
  collapsed,
}: {
  /** The laboratory this session is in, by id. */
  current: string | null;
  workspaces: WorkspaceOption[];
  collapsed: boolean;
  }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (workspaces.length < 2) return null;

  function choose(id: string) {
    if (id === current) return setOpen(false);
    setNote(null);
    startTransition(async () => {
      const result = await switchWorkspace(id);
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <div ref={host} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={collapsed ? "Switch workspace" : undefined}
        className={cn(
          "mt-1 flex w-full items-center rounded-lg text-[11.5px] text-muted transition-colors duration-[var(--dur-1)] hover:bg-mist-soft hover:text-ink motion-reduce:transition-none",
          collapsed ? "h-7 justify-center px-0" : "h-7 gap-1.5 px-2",
        )}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        {!collapsed && <span className="truncate">Switch workspace</span>}
      </button>

      {open && (
        // Opens upwards: this sits at the bottom of the rail, and a menu that
        // dropped would open past the edge of the viewport.
        <div
          role="menu"
          aria-label="Your workspaces"
          className="absolute bottom-full left-0 z-50 mb-1 min-w-[13rem] overflow-hidden rounded-xl border border-line bg-white py-1 shadow-soft"
        >
          {workspaces.map((workspace) => {
            const here = workspace.id === current;
            return (
              <button
                key={workspace.id}
                type="button"
                role="menuitemradio"
                aria-checked={here}
                disabled={pending}
                onClick={() => choose(workspace.id)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-mist-soft disabled:opacity-60"
              >
                <Check
                  className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", here ? "text-navy" : "opacity-0")}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-ink">{workspace.name}</span>
                  <span className="block text-[11px] text-muted">
                    {ROLE_LABEL[workspace.role]}
                  </span>
                </span>
              </button>
            );
          })}
          {note && (
            <p role="alert" className="border-t border-line px-3 py-2 text-[11px] text-red-700">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
