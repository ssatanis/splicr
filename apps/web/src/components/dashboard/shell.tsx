"use client";

import {
  Cable,
  CheckCircle2,
  Compass,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Waypoints,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { Logo, LogoGlyph } from "@/components/brand/logo";
import { CommandPalette, useCommandPalette } from "@/components/dashboard/command-palette";
import { cn, initials } from "@/lib/utils";

/**
 * The navigation follows the order a screen is actually worked through: look at
 * what moved, analyse the counts against prior art, decide what is real and plan
 * the next one. Upload is not listed here because it is the primary action above
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
      { href: "/dashboard/validation", label: "Truth Loop", icon: CheckCircle2, exact: true },
      { href: "/dashboard/validation/network", label: "Validation Network", icon: Gauge },
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

const NEW_SCREEN = "/dashboard/new";

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

export type ShellUser = {
  name: string;
  email: string;
  org: string;
  /** The lab's uploaded logo, or null while it has not set one. */
  orgLogo: string | null;
  demo: boolean;
};

/** Where the desktop rail remembers whether it is collapsed.
 *
 *  Browser storage rather than the database: it is a per-device preference, not
 *  a property of the researcher. Somebody who collapses the rail on a laptop to
 *  get more width for a hit table has not said anything about how they want the
 *  console to look on the large screen in the lab, and a migration for it would
 *  make that decision for them. */
export const RAIL_COOKIE = "splicr_rail";
const RAIL_KEY = RAIL_COOKIE;

const RAIL_WIDE = "15rem";
const RAIL_NARROW = "4.25rem";

/**
 * The stored preference, kept in a cookie rather than in `localStorage`.
 *
 * That choice is what makes the animation correct. The server can read a
 * cookie, so a researcher who collapsed the rail last visit gets a collapsed
 * rail in the very first HTML: there is no expanded-then-collapsed render for
 * them to watch, and the width transition can be on from the start instead of
 * being switched on afterwards. Browser storage would have meant the opposite
 * on every single page load.
 *
 * It is a per-device preference either way, and it is read as external state so
 * that a second tab picks up the change.
 */
const railListeners = new Set<() => void>();

function subscribeRail(onChange: () => void) {
  railListeners.add(onChange);
  return () => {
    railListeners.delete(onChange);
  };
}

function railSnapshot() {
  return document.cookie.split("; ").includes(`${RAIL_KEY}=1`);
}

function storeRail(collapsed: boolean) {
  document.cookie = `${RAIL_KEY}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  railListeners.forEach((listener) => listener());
}

export function DashboardShell({
  user,
  railCollapsed,
  children,
}: {
  user: ShellUser;
  /** What the server read from the rail cookie, so the first paint is already
   *  the width this researcher chose. */
  railCollapsed: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  const collapsed = useSyncExternalStore(subscribeRail, railSnapshot, () => railCollapsed);
  const toggleRail = useCallback(() => storeRail(!railSnapshot()), []);

  // The server does not know the viewer's platform, so the glyph is read as
  // external state with a server snapshot. Rendering it directly would mismatch
  // on hydration; correcting it in an effect would render the wrong key first.
  const modifier = useSyncExternalStore(subscribePlatform, macSnapshot, serverSnapshot);

  return (
    /* A fixed app shell rather than a document that scrolls.
       The sidebar was sticky inside a page taller than the viewport, which
       works while you are looking at it but means the rail has an end: scroll
       far enough, or capture the whole page, and the rail simply stops. Here
       the shell is exactly the viewport, the rail is a flex child of it, and
       only the content column scrolls. The rail cannot end because it is never
       longer than the screen.

       `console` is the theme scope. Everything inside it reads the console's
       palette: white surfaces, near black type, navy for action. Nothing
       outside it changes, which is what keeps the public site intact. */
    <div className="console flex h-dvh overflow-hidden bg-white">
      <aside
        style={{ width: collapsed ? RAIL_NARROW : RAIL_WIDE }}
        className={cn(
          "hidden shrink-0 overflow-hidden border-r border-line bg-white lg:flex",
          // Width only, and nothing else: animating padding or content would
          // make the labels slide, which reads as a panel arriving rather than
          // a rail narrowing. `motion-reduce` drops it entirely.
          "transition-[width] duration-[180ms] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
        )}
      >
        <Sidebar
          user={user}
          pathname={pathname}
          modifier={modifier}
          collapsed={collapsed}
          onToggleRail={toggleRail}
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
        <header className="z-30 shrink-0 border-b border-line bg-white/90 backdrop-blur lg:hidden">
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
          {/* h-full, not min-h-full. A minimum leaves the wrapper's height
              indefinite, so a child asking for `flex-1` gets no definite basis
              and a `1fr` grid track inside it degenerates to max-content.
              Measured on the overview: the track resolved to 2547px and main
              scrolled 2794px into an 800px viewport. With a definite height the
              same track resolves to 552px, main is 800px with nothing to
              scroll, and the candidate table absorbs its own overflow. Content
              taller than the viewport still overflows this box and main still
              scrolls it, so the short-page case is unchanged. */}
          <div className="flex h-full flex-col gap-3 px-4 py-4 md:px-6 md:py-5">{children}</div>
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
  collapsed = false,
  onToggleRail,
  onSearch,
  onClose,
}: {
  user: ShellUser;
  pathname: string;
  /** The viewer's own modifier glyph, resolved once by the shell. */
  modifier: string;
  /** Icons only. Never set in the drawer, which is always at full width. */
  collapsed?: boolean;
  /** Present only on desktop, where the rail can be narrowed. */
  onToggleRail?: () => void;
  onSearch: () => void;
  /** Present only in the drawer, which closes itself once a link is followed. */
  onClose?: () => void;
}) {
  const groupId = useId();
  const newScreenActive = isActive(pathname, NEW_SCREEN);

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {/* The bell that used to sit here opened nothing and there is no
          notification store behind it. A control that does nothing is the one
          thing this audience reads as a mock-up rather than an instrument, and
          the rail is where they would look first. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 pb-3 pt-4",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        {collapsed ? (
          <Link href="/dashboard" aria-label="SplicR home" className="flex h-8 w-8 items-center justify-center">
            <LogoGlyph tone="ink" className="h-[18px] w-[18px]" />
          </Link>
        ) : (
          <Logo href="/dashboard" size="sm" />
        )}
        {!collapsed && <div className="flex-1" />}
        {onToggleRail && !collapsed && (
          <button
            type="button"
            onClick={onToggleRail}
            aria-label="Collapse sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors duration-[var(--dur-1)] hover:bg-mist-soft hover:text-ink motion-reduce:transition-none"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {onClose && (
          <button
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-mist-soft hover:text-ink lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {onToggleRail && collapsed && (
        <div className="shrink-0 px-2 pb-2">
          <RailTip label="Expand sidebar">
            <button
              type="button"
              onClick={onToggleRail}
              aria-label="Expand sidebar"
              className="flex h-9 w-full items-center justify-center rounded-lg text-muted transition-colors duration-[var(--dur-1)] hover:bg-mist-soft hover:text-ink motion-reduce:transition-none"
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </RailTip>
        </div>
      )}

      {/* The one primary action in the console, on every page, above the
          navigation: starting an analysis is what a researcher came to do. */}
      <div className={cn("shrink-0", collapsed ? "px-2" : "px-3")}>
        <RailTip label="New analysis" when={collapsed}>
          <Link
            href={NEW_SCREEN}
            onClick={onClose}
            aria-label={collapsed ? "New analysis" : undefined}
            className={cn("btn btn-navy w-full", collapsed && "px-0")}
            aria-current={newScreenActive ? "page" : undefined}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed && "New analysis"}
          </Link>
        </RailTip>
      </div>

      {/* A button, not an input: the palette owns the text field, so a second one
          here would be a decoy that swallows the first keystroke. The shortcut is
          printed because a researcher who never sees it never learns it. */}
      <div className={cn("mt-2 shrink-0", collapsed ? "px-2" : "px-3")}>
        <RailTip label={`Search  ${modifier}K`} when={collapsed}>
          <button
            type="button"
            onClick={onSearch}
            aria-label={collapsed ? "Search screens and genes" : undefined}
            className={cn(
              "flex h-8 w-full items-center rounded-lg border border-line bg-white text-left text-muted transition-colors duration-[var(--dur-1)] hover:border-line-strong hover:text-ink motion-reduce:transition-none",
              collapsed ? "justify-center px-0" : "gap-2 px-2.5",
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-[12.5px]">Search screens and genes</span>
                <kbd className="shrink-0 rounded border border-line-strong px-1 text-[10px] text-muted">
                  {modifier}K
                </kbd>
              </>
            )}
          </button>
        </RailTip>
      </div>

      <nav
        aria-label="Workspace"
        className={cn(
          "thin-scroll mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pb-2",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {NAV.map((section, index) => {
          const headingId = `${groupId}-${index}`;
          return (
            <div key={section.group ?? "top"}>
              {/* A div rather than a heading: these label the lists beside
                  them, and promoting them would put four headings above the
                  page's own h1 in the document outline. */}
              {/* Collapsed, the group label becomes a hairline: the grouping is
                  still visible, and a five-letter word squeezed into 44px is
                  not a label, it is noise. */}
              {section.group &&
                (collapsed ? (
                  <div className="mx-2 mb-1.5 h-px bg-line" aria-hidden="true" />
                ) : (
                  <div
                    id={headingId}
                    className="mb-1 px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
                  >
                    {section.group}
                  </div>
                ))}
              <ul
                className="space-y-0.5"
                aria-labelledby={section.group && !collapsed ? headingId : undefined}
                aria-label={section.group && collapsed ? section.group : undefined}
              >
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href, item.exact);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <RailTip label={item.label} when={collapsed}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn("dash-nav-link", collapsed && "justify-center px-0")}
                          data-active={active}
                          aria-current={active ? "page" : undefined}
                        >
                          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                          {/* The label stays in the accessibility tree at both
                              widths. A rail of unlabelled icons is unusable with
                              a screen reader, and `sr-only` costs nothing. */}
                          <span className={cn(collapsed && "sr-only")}>{item.label}</span>
                        </Link>
                      </RailTip>
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
      <div className={cn("shrink-0 border-t border-line", collapsed ? "p-2" : "p-3")}>
        <RailTip label={`${user.name}  ${user.org}`} when={collapsed}>
          <div
            className={cn(
              "flex items-center py-1",
              collapsed ? "justify-center px-0" : "gap-2.5 px-1",
            )}
          >
            {/* The lab's own mark once it has uploaded one, and the person's
                initials until then. One square either way, so the row does not
                move the day a logo arrives. */}
            {user.orgLogo ? (
              <span
                role="img"
                aria-label={`${user.org} logo`}
                className="h-7 w-7 shrink-0 rounded-full border border-line bg-white bg-contain bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${JSON.stringify(user.orgLogo)})` }}
              />
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-tint text-[11px] font-medium text-navy">
                {initials(user.name)}
              </span>
            )}
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] leading-tight text-ink">{user.name}</div>
                <div className="truncate text-[11px] text-muted">{user.org}</div>
              </div>
            )}
          </div>
        </RailTip>
        <form action="/auth/signout" method="post" className="mt-1">
          <RailTip label="Sign out" when={collapsed}>
            <button
              type="submit"
              aria-label={collapsed ? "Sign out" : undefined}
              className={cn("dash-nav-link w-full", collapsed && "justify-center px-0")}
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && "Sign out"}
            </button>
          </RailTip>
        </form>
      </div>
    </div>
  );
}

/**
 * The label a collapsed rail control shows beside itself.
 *
 * `title` was the obvious choice and is the wrong one: it appears after a delay
 * the reader did not ask for, it never appears on keyboard focus, and on a
 * touch device it does not appear at all. This is an ordinary element, shown on
 * hover and on focus-within, so tabbing through a collapsed rail names every
 * stop. It is `aria-hidden` because the control it belongs to already has an
 * accessible name; announcing both would read every item twice.
 *
 * It is positioned against the viewport, not against the control, and that is
 * the whole point of the rewrite. An absolutely positioned label at `left-full`
 * sits outside the rail, which has two consequences that cancelled each other
 * out and left the label useless: the rail clips it, so nothing was ever
 * visible, and the navigation is a scroll container, so the label it could not
 * show still counted towards scrollable width and put a horizontal scrollbar
 * across the bottom of a 68px rail. A fixed box has the viewport for its
 * containing block, so no ancestor clips it and no ancestor scrolls for it.
 *
 * The coordinates are read when the label is asked for rather than kept in
 * state, and the label unmounts when it is not shown, so there is nothing to
 * keep in sync while the rail is idle. Scrolling the navigation under a resting
 * pointer would strand it, so a scroll anywhere dismisses it.
 *
 * `when` is false in the drawer and on an expanded rail, where the label is
 * already on screen and a second copy would be a duplicate.
 */
function RailTip({
  label,
  when = true,
  children,
}: {
  label: string;
  when?: boolean;
  children: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const box = host.current?.getBoundingClientRect();
    if (box) setAt({ top: box.top + box.height / 2, left: box.right + 8 });
  }, []);
  const hide = useCallback(() => setAt(null), []);

  useEffect(() => {
    if (at === null) return;
    // Capture, because the scroller is the navigation rather than the window.
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [at, hide]);

  if (!when) return <>{children}</>;

  return (
    <div
      ref={host}
      // A tap on a touch screen fires pointerenter and never pointerleave, so
      // the label would stay on screen until something else moved. A finger has
      // already pressed the control it would have described.
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show();
      }}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {at && (
        <span
          aria-hidden="true"
          style={{ top: at.top, left: at.left }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-teal-900 px-2 py-1 text-[11.5px] leading-none text-white shadow-soft"
        >
          {label}
        </span>
      )}
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
    <div className="console fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-teal-950/45 backdrop-blur-[2px]"
      />
      <div
        ref={drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace menu"
        tabIndex={-1}
        className="absolute left-0 top-0 h-full w-[268px] rounded-r-2xl border-r border-line bg-white shadow-float outline-none"
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
