"use client";

import Link from "next/link";
import Image from "next/image";

/**
 * Global app header: SplicR branding on the left, full-width border (line) below.
 * Pages can render into #header-actions (e.g. results page puts title + buttons there).
 */
export default function AppHeader() {
  return (
    <header className="w-full border-b border-border bg-surface h-20">
      <div className="w-full h-full flex items-center justify-between gap-4 px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity"
        >
          <Image
            src="/logo.jpeg"
            alt="SplicR"
            width={100}
            height={32}
            className="h-8 w-auto object-contain"
            priority
          />
        </Link>
        <div
          id="header-actions"
          className="flex items-center gap-3 flex-1 justify-end min-w-0 flex-wrap"
          data-header-slot
        />
      </div>
    </header>
  );
}
