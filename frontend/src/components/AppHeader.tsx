"use client";

import { useSidebar } from "@/lib/context/SidebarContext";
import { cn } from "@/lib/utils";

/**
 * Global app header: top bar only. SplicR logo lives in the sidebar (correct spot).
 * Pages can render into #header-actions (e.g. results page puts title + buttons there).
 */
export default function AppHeader() {
  const { isMinimized } = useSidebar();

  return (
    <header
      className={cn(
        "fixed top-0 right-0 border-b border-border bg-surface min-h-[5rem] transition-all duration-200 ease-in-out z-40",
        isMinimized ? "left-[72px]" : "left-[260px]"
      )}
    >
      <div className="w-full h-full flex items-center justify-end gap-4 px-6 pr-8 py-4">
        <div
          id="header-actions"
          className="flex items-center gap-2 flex-1 justify-end min-w-0 flex-wrap max-w-full"
          data-header-slot
        />
      </div>
    </header>
  );
}
