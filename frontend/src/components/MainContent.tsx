"use client";

import { useSidebar } from "@/lib/context/SidebarContext";
import { cn } from "@/lib/utils";

export default function MainContent({ children }: { children: React.ReactNode }) {
  const { isMinimized } = useSidebar();

  return (
    <main 
      className={cn(
        "flex-1 transition-all duration-200 ease-in-out pt-20",
        isMinimized ? "ml-sidebar-min" : "ml-sidebar-max"
      )}
    >
      {children}
    </main>
  );
}
