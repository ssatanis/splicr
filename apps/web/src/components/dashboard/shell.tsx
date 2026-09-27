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
  Waypoints,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { Logo } from "@/components/brand/logo";
import { CommandPalette, useCommandPalette } from "@/components/dashboard/command-palette";
import { initials } from "@/lib/utils";

/**
 * The navigation follows the order a screen is actually worked through: look at
 * what moved, analyse the counts against prior art, decide what is real and plan
 * the next one. Upload is not listed here because it is the orange button above
 * the groups, which is the one action the shell offers on every page; listing it
 * twice would be two entry points to the same screen.
 */
const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [{ href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true }],
  },
  {
    group: "Analyse",
    items: [
      { href: "/dashboard/screens", label: "Screens", icon: FlaskConical },
      { href: "/dashboard/atlas", label: "Atlas", icon: Compass },
    ],
  },
  {
    group: "Decide and plan",
    items: [
      { href: "/dashboard/validation", label: "Truth Loop", icon: CheckCircle2 },
      { href: "/dashboard/planner", label: "Planner", icon: Waypoints },
    ],
  },
  {
    group: "Workspace",
    items: [
      { href: "/dashboard/connect", label: "Connect", icon: Cable },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}

const UPLOAD = "/dashboard/upload";

/**
 * Matches on a path segment rather than a string prefix, so `/dashboard/screens`
 * does not light up for a future `/dashboard/screens-archive` while still
 * staying lit for `/dashboard/screens/scr_002`.
 */
function isActive(pathname: string, href: string, exact = false) {
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}

/** Platform never changes within a session, so there is nothing to subscribe to. */
const subscribePlatform = () => () => {};
const macSnapshot = () =>
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl ";
const serverSnapshot = () => "Ctrl ";

export type ShellUser = { name: string; email: string; org: string; demo: boolean };

export function DashboardShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  // The server does not know the viewer's platform, so the glyph is read as
  // external state with a server snapshot. Rendering it directly would mismatch
  // on hydration; correcting it in an effect would render the wrong key first.
  const modifier = useSyncExternalStore(subscribePlatform, macSnapshot, serverSnapshot);

  return (
    /* A fixed app shell rather than a document that scrolls.
       The sidebar was sticky inside a page taller than the viewport, which
       works while you are looking at it but means the rail has an end: scroll
       far enough, or capture the whole page, and the teal simply stops. Here
       the shell is exactly the viewport, the rail is a flex child of it, and
       only the content column scrolls. The rail cannot end because it is never
       longer than the screen. */
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <aside className="hidden w-[236px] shrink-0 bg-teal-900 text-white lg:flex">
        <Sidebar
          user={user}
          pathname={pathname}
          modifier={modifier}
          onSearch={() => setPaletteOpen(true)}
        />
      </aside>

      {open && (
        <MenuDrawer
          user={user}
          pathname={pathname}
          modifier={modifier}
          onSearch={() => {
            close();
            setPaletteOpen(true);
          }}
          onClose={close}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Narrow widths only. At lg the rail carries search, the workspace and
            the one primary action, so a second bar across the top would repeat
            all three and charge the content column 57px of height for it. The
            overview has to fit in that column, which makes every row of chrome
            a row of hit table somebody does not get to see. */}
        <header className="z-30 shrink-0 border-b border-line bg-canvas/90 backdrop-blur lg:hidden">
          <div className="flex h-12 items-center gap-2 px-4">
            <button
              className="icon-btn h-8 w-8"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <Logo href="/dashboard" size="sm" />
            <div className="flex-1" />
            {user.demo && (
              <span className="chip bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">
                Demo data
              </span>
            )}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="icon-btn h-8 w-8"
              aria-label="Search"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* The only scroll container on the page. thin-scroll keeps the bar from
            adding a visual edge beside the content.

            The gutter lives on the inner wrapper rather than on main, so a page
            that fills the viewport can say `min-h-0 flex-1` and get the space
            that is actually left after the gutter. With the padding on main
            itself, 100% height plus padding overflowed by exactly the padding,
            which is how a page that fits still scrolled 40px. */}
        <main className="thin-scroll flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col gap-3 px-4 py-4 md:px-6 md:py-5">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * One definition of the sidebar, rendered by both the fixed column and the
 * drawer, so the two can never drift into different menus at different widths.
 */
function Sidebar({
  user,
  pathname,
  modifier,
  onSearch,
  onClose,
}: {
  user: ShellUser;
  pathname: string;
  /** The viewer's own modifier glyph, resolved once by the shell. */
  modifier: string;
  onSearch: () => void;
  /** Present only in the drawer, which closes itself once a link is followed. */
  onClose?: () => void;
}) {
  const groupId = useId();
  const uploadActive = isActive(pathname, UPLOAD);

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-4">
        <Logo tone="light" href="/dashboard" size="sm" />
        <div className="flex-1" />
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/75 transition-colors duration-[120ms] hover:bg-white/10 hover:text-white motion-reduce:transition-none"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
        </button>
        {onClose && (
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/90 hover:bg-white/10 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* The one primary action in the console, on every page, above the
          navigation: starting a run is what a researcher came to do. */}
      <div className="shrink-0 px-3">
        <Link
          href={UPLOAD}
          onClick={onClose}
          className="btn btn-orange w-full rounded-lg px-3 py-2 text-[13px]"
          aria-current={uploadActive ? "page" : undefined}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> New run
        </Link>
      </div>

      {/* A button, not an input: the palette owns the text field, so a second one
          here would be a decoy that swallows the first keystroke. The shortcut is
          printed because a researcher who never sees it never learns it. */}
      <div className="mt-2 shrink-0 px-3">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-white/10 px-2.5 text-left text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white motion-reduce:transition-none"
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate text-[12.5px]">Search screens and genes</span>
          <kbd className="shrink-0 rounded border border-white/25 px-1 text-[10px] text-white/80">
            {modifier}K
          </kbd>
        </button>
      </div>

      <nav aria-label="Workspace" className="thin-scroll mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-2">
        {NAV.map((section, index) => {
          const headingId = `${groupId}-${index}`;
          return (
            <div key={section.group ?? "top"}>
              {/* A div rather than a heading: these label the lists beside
                  them, and promoting them would put four headings above the
                  page's own h1 in the document outline. */}
              {section.group && (
                <div
                  id={headingId}
                  className="mb-1 px-3 text-[10px] uppercase tracking-[0.16em] text-white/70"
                >
                  {section.group}
                </div>
              )}
              <ul
                className="space-y-0.5"
                aria-labelledby={section.group ? headingId : undefined}
              >
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href, item.exact);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className="dash-nav-link py-1.5 text-[12.5px]"
                        data-active={active}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Pinned to the bottom of the rail, and shrink-0 so it stays pinned when
          the navigation above it has to scroll on a short viewport. */}
      <div className="shrink-0 border-t border-white/10 p-3">
        {user.demo && (
          <p className="mb-2 rounded-md bg-orange-500/20 px-2 py-1 text-[11px] leading-snug text-white">
            Demo workspace. Every figure in the console is sample data.
          </p>
        )}
        <div className="flex items-center gap-2.5 px-1 py-1">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[11px] font-medium text-white">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] leading-tight text-white">{user.name}</div>
            <div className="truncate text-[11px] text-white/75">{user.org}</div>
          </div>
        </div>
        <form action="/auth/signout" method="post" className="mt-1">
          <button type="submit" className="dash-nav-link w-full text-[12.5px]">
            <LogOut className="h-4 w-4" aria-hidden="true" /> {user.demo ? "Exit demo" : "Sign out"}
          </button>
        </form>
      </div>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The narrow-width menu. It is modal, so it takes focus, keeps Tab inside
 * itself, closes on Escape and hands focus back to the button that opened it.
 */
function MenuDrawer({
  user,
  pathname,
  modifier,
  onSearch,
  onClose,
}: {
  user: ShellUser;
  pathname: string;
  modifier: string;
  onSearch: () => void;
  onClose: () => void;
}) {
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    drawer.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !drawer.current) return;
      const stops = Array.from(drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-teal-950/50 backdrop-blur-[2px]"
      />
      <div
        ref={drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace menu"
        tabIndex={-1}
        className="absolute left-0 top-0 h-full w-[268px] bg-teal-900 text-white shadow-float outline-none"
      >
        <Sidebar
          user={user}
          pathname={pathname}
          modifier={modifier}
          onSearch={onSearch}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
