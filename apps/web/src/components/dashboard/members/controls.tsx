"use client";

/**
 * The two controls the members page reuses: a wrapper that explains a disabled
 * control, and the role picker.
 */

import { AlertCircle, Check, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { ORG_ROLES, ROLE_LABEL, ROLE_RANK, type OrgRole } from "@/lib/data/types";
import { cn } from "@/lib/utils";

import { ROLE_SUMMARY } from "./shared";

/**
 * Wraps a disabled control and says why it is disabled.
 *
 * The wrapper carries the hover and the focus rather than the control, because
 * a disabled button fires neither. `tabIndex` puts the reason on the keyboard
 * path and `aria-describedby` hands it to a screen reader, so the explanation is
 * not visual only. With no reason the child is returned untouched, so the extra
 * span exists only where there is something to explain.
 */
export function Locked({
  reason,
  children,
  className,
}: {
  reason: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();

  if (!reason) return <>{children}</>;

  return (
    <span
      className={cn("group relative inline-flex", className)}
      tabIndex={0}
      aria-describedby={id}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-40 mb-2 w-56 max-w-[calc(100vw-3rem)] rounded-xl bg-teal-900 px-3 py-2 text-left text-[11px] leading-snug font-normal text-white opacity-0 shadow-soft transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {reason}
      </span>
    </span>
  );
}

/**
 * Role picker: a pill that opens a short menu of the four roles, each with one
 * line about what it can do.
 *
 * A native `<select>` cannot carry those explanations, which is the whole point
 * of the control, so this is a button and a menu. Roles above `maxRole` are
 * listed but disabled, because hiding them leaves the reader wondering whether
 * the role exists at all.
 */
export function RoleMenu({
  value,
  onSelect,
  maxRole,
  disabled = false,
  busy = false,
  label,
  align = "right",
}: {
  value: OrgRole;
  onSelect: (role: OrgRole) => void;
  maxRole: OrgRole;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Derived rather than synchronised with an effect: if the control goes dead
  // while the menu is open, the menu is simply not rendered, and reopening is
  // still one click once the control comes back.
  const showMenu = open && !disabled && !busy;

  // A menu that cannot be dismissed is a trap, so close on an outside click and
  // on Escape, and hand focus back to the trigger when the keyboard closed it.
  useEffect(() => {
    if (!showMenu) return;

    function onPointerDown(event: MouseEvent) {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showMenu]);

  return (
    <div className="relative" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={showMenu}
        aria-label={`${label}. Currently ${ROLE_LABEL[value].toLowerCase()}.`}
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-white px-3 py-1.5 text-xs whitespace-nowrap text-ink transition-colors",
          disabled || busy ? "cursor-not-allowed opacity-55" : "hover:bg-mist-soft",
        )}
      >
        {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted" />}
        {ROLE_LABEL[value]}
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted transition-transform",
            showMenu && "rotate-180",
          )}
        />
      </button>

      {showMenu && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-40 mt-2 w-[17rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-line bg-white p-1.5 shadow-soft",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {ORG_ROLES.map((role) => {
            const outOfReach = ROLE_RANK[role] > ROLE_RANK[maxRole];
            const current = role === value;

            return (
              <button
                key={role}
                type="button"
                role="menuitem"
                disabled={outOfReach || current}
                onClick={() => {
                  setOpen(false);
                  onSelect(role);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                  outOfReach
                    ? "cursor-not-allowed opacity-55"
                    : current
                      ? "bg-mist-soft"
                      : "hover:bg-mist-soft",
                )}
              >
                <span className="mt-0.5 w-3.5 shrink-0">
                  {current && <Check className="h-3.5 w-3.5 text-orange-500" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink">
                    {ROLE_LABEL[role]}
                    {current && <span className="text-muted"> (current)</span>}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                    {outOfReach
                      ? `Only an owner can grant the ${ROLE_LABEL[role].toLowerCase()} role.`
                      : ROLE_SUMMARY[role]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One line of success or failure, straight from a Server Action result. */
export function ActionNote({ tone, children }: { tone: "ok" | "err"; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={tone === "err" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-1.5 text-xs leading-snug",
        tone === "ok" ? "text-cyan-700" : "text-red-700",
      )}
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
