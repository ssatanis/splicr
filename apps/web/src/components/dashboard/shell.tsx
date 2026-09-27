"use client";

import {
  Bell,
  Cable,
  CheckCircle2,
  Compass,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  UploadCloud,
  Waypoints,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { Logo } from "@/components/brand/logo";
import { CommandPalette, useCommandPalette } from "@/components/dashboard/command-palette";
import { initials } from "@/lib/utils";

const nav = [
  { group: "Work", items: [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/dashboard/screens", label: "Screens", icon: FlaskConical },
    { href: "/dashboard/upload", label: "New run", icon: UploadCloud },
  ]},
  { group: "Evidence", items: [
    { href: "/dashboard/atlas", label: "Atlas", icon: Compass },
    { href: "/dashboard/validation", label: "Truth Loop", icon: CheckCircle2 },
    { href: "/dashboard/planner", label: "Planner", icon: Waypoints },
  ]},
  { group: "Workspace", items: [
    { href: "/dashboard/connect", label: "Connect", icon: Cable },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ]},
];

/** Platform never changes within a session, so there is nothing to subscribe to. */
const subscribePlatform = () => () => {};
const macSnapshot = () =>
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? "\u2318" : "Ctrl ";
const serverSnapshot = () => "Ctrl ";

export type ShellUser = { name: string; email: string; org: string; demo: boolean };

export function DashboardShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  // The server does not know the viewer's platform, so the glyph is read as
  // external state with a server snapshot. Rendering it directly would mismatch
  // on hydration; correcting it in an effect would render the wrong key first.
  const modifier = useSyncExternalStore(subscribePlatform, macSnapshot, serverSnapshot);

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <Logo tone="light" href="/dashboard" size="md" />
        <button className="lg:hidden text-white/70 p-1" onClick={close} aria-label="Close menu">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-3">
        <Link href="/dashboard/upload" onClick={close} className="btn btn-orange w-full btn-sm">
          <Plus className="w-4 h-4" /> New run
        </Link>
      </div>

      <nav className="px-3 mt-6 space-y-6 flex-1 overflow-y-auto thin-scroll">
        {nav.map((section) => (
          <div key={section.group}>
            <div className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.16em] text-white/35">
              {section.group}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className="dash-nav-link"
                    data-active={active}
                  >
                    <Icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <span className="w-8 h-8 rounded-full bg-orange-500 text-white text-[11px] font-medium flex items-center justify-center shrink-0">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-white truncate leading-tight">{user.name}</div>
            <div className="text-[11px] text-white/45 truncate">{user.org}</div>
          </div>
        </div>
        <form action="/auth/signout" method="post" className="mt-1">
          <button type="submit" className="dash-nav-link w-full text-[13px]">
            <LogOut className="w-4 h-4" /> {user.demo ? "Exit demo" : "Sign out"}
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas flex">
      <aside className="hidden lg:flex w-[236px] shrink-0 bg-teal-900 text-white sticky top-0 h-screen">
        {sidebar}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-teal-950/50 backdrop-blur-[2px]" onClick={close} />
          <aside className="absolute left-0 top-0 h-full w-[268px] bg-teal-900 text-white shadow-float">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur border-b border-line">
          <div className="px-4 md:px-7 h-14 flex items-center gap-3">
            <button className="lg:hidden icon-btn w-9 h-9" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="w-4 h-4" />
            </button>
            {/* A button, not an input: the palette owns the text field, so a
                second one here would be a decoy that swallows the first
                keystroke and does nothing with it. */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2.5 flex-1 max-w-md rounded-lg bg-white
                         border border-line px-3 py-1.5 text-muted hover:border-cyan-400
                         focus-visible:border-cyan-400 transition-colors text-left"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-sm">Search screens, genes and commands</span>
              <kbd className="hidden md:inline text-[10px] border border-line rounded px-1 py-0.5">
                {modifier}K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="sm:hidden icon-btn w-9 h-9"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
            <div className="flex-1 sm:hidden" />
            {user.demo && <span className="chip bg-orange-50 text-orange-700 text-[11px] py-1">Demo data</span>}
            <button className="icon-btn w-9 h-9" aria-label="Notifications">
              <Bell className="w-4 h-4" />
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 md:px-7 py-5 md:py-7">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
