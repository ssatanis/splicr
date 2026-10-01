"use client";

import {
  Activity,
  BookOpenCheck,
  Gauge,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";

const sections = [
  { href: "#diligence", label: "Target diligence", icon: Gauge },
  { href: "#live-run", label: "Live run", icon: Activity },
  { href: "#candidate-evidence", label: "Candidate evidence", icon: BookOpenCheck },
];

export function PitchShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-[#edf2f3]">
      <aside className="hidden w-[248px] shrink-0 flex-col bg-teal-950 text-white lg:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <Logo tone="light" href="/pitch" size="sm" />
          <div className="mt-4 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
            </span>
            <span className="text-[11px] uppercase tracking-[0.14em] text-white/70">
              Advanced workspace
            </span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5" aria-label="Advanced workspace sections">
          <p className="px-3 text-[10px] uppercase tracking-[0.16em] text-white/45">Analysis surface</p>
          <ul className="mt-2 space-y-1">
            {sections.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <a
                  href={href}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-white/[0.06] px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-white/70">
              Illustrative workspace. Every figure on it is invented, including the run
              log and the diligence index; none of it is a measurement. The measured
              results are in the console and on the evidence page.
            </p>
          </div>
          <Link
            href="/"
            className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px] text-white/75 hover:bg-white/10 hover:text-white"
          >
            <span className="flex items-center gap-2">
              <LogOut className="h-4 w-4" aria-hidden="true" /> Honest public view
            </span>
            <kbd className="rounded border border-white/20 px-1.5 py-0.5 text-[9px]">⌘⇧D</kbd>
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-hidden">
        <header className="flex h-12 items-center border-b border-line bg-white px-4 lg:hidden">
          <Logo href="/pitch" size="sm" />
          <span className="ml-3 rounded-full bg-teal-50 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-teal-700">
            Advanced
          </span>
          <Link href="/" className="ml-auto text-[12px] text-muted hover:text-ink">Exit</Link>
        </header>
        <main className="thin-scroll h-[calc(100dvh-3rem)] overflow-y-auto lg:h-dvh">
          {children}
        </main>
      </div>
    </div>
  );
}
