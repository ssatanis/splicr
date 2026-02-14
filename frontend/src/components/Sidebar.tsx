"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Upload,
  BarChart3,
  LineChart,
  Settings,
  PanelRightOpen,
  PanelLeftClose,
  Microscope,
  Activity,
  Dna,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Target,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useSidebar } from "@/lib/context/SidebarContext";

type NavItem = {
  name: string;
  href: string;
  icon: React.ElementType;
  children?: { name: string; href: string; icon: React.ElementType }[];
};

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    name: "CRISPR Screen Analysis",
    href: "/upload",
    icon: Dna,
    children: [
      { name: "Upload New Screen", href: "/upload", icon: Upload },
      { name: "My Analyses", href: "/analyses", icon: ListChecks },
    ],
  },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Analytics", href: "/analytics", icon: LineChart },
  { name: "Editability Atlas (TEA)", href: "/tea", icon: Activity },
  { name: "Therapeutic Translation", href: "/txscore", icon: Target },
  {
    name: "Documentation",
    href: "/docs",
    icon: BookOpen,
    children: [
      { name: "CRISPR Screen Analysis", href: "/docs/crispr-screen-analysis", icon: Dna },
      { name: "Editability Atlas (TEA)", href: "/docs/editability-atlas", icon: Activity },
      { name: "Therapeutic Translation", href: "/docs/therapeutic-translation", icon: Target },
    ],
  },
  { name: "Settings", href: "/settings", icon: Settings },
];

export interface SidebarProps {
  /** Override context when set (e.g. for tests); normally uses global context */
  minimized?: boolean;
  onMaximize?: () => void;
}

export default function Sidebar({ minimized: minimizedProp, onMaximize: onMaximizeProp }: SidebarProps) {
  const pathname = usePathname();
  const ctx = useSidebar();
  const [displayName, setDisplayName] = useState("Researcher");
  const [email, setEmail] = useState("user@example.com");
  const [hasAuth, setHasAuth] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // Use context state, but allow prop override for testing
  const minimized = minimizedProp ?? ctx.isMinimized;
  const setMinimized = ctx.setMinimized;
  const onMaximize = onMaximizeProp ?? (() => setMinimized(false));
  const onMinimize = () => setMinimized(true);

  // Auto-expand the group that contains the current route
  useEffect(() => {
    const newExpanded: Record<string, boolean> = {};
    navigation.forEach((item) => {
      if (item.children) {
        const isGroupActive =
          pathname.startsWith(item.href) ||
          item.children.some((child) => pathname === child.href || pathname.startsWith(child.href));
        if (isGroupActive) {
          newExpanded[item.name] = true;
        }
      }
    });
    setExpandedItems((prev) => ({ ...prev, ...newExpanded }));
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    async function loadUserData() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          setHasAuth(true);
          setEmail(user.email || "user@example.com");
          const fullName = user.user_metadata?.full_name;
          const displayNameMeta = user.user_metadata?.display_name;
          setDisplayName(
            fullName || displayNameMeta || user.email?.split("@")[0] || "Researcher"
          );
          const { data: profile } = await supabase
            .from("profiles")
            .select("display_name, full_name, avatar_url")
            .eq("id", user.id)
            .single();
          const profileRow = profile as { display_name?: string | null; full_name?: string | null; avatar_url?: string | null } | null;
          if (profileRow) {
            const name = profileRow.display_name || profileRow.full_name || displayName;
            if (name) setDisplayName(name);
            setAvatarUrl(profileRow.avatar_url ?? null);
          }
          return;
        }
        setAvatarUrl(null);
      } catch (_) {
        // Supabase not configured or error, fall through to localStorage
      }
      setAvatarUrl(null);

      setHasAuth(!!localStorage.getItem("splicr_auth_token"));
      const authUser = localStorage.getItem("splicr_auth_user");
      if (authUser) {
        try {
          const u = JSON.parse(authUser);
          setEmail(u.email || "user@example.com");
          setDisplayName(u.display_name || u.email?.split("@")[0] || "Researcher");
          return;
        } catch (_) { }
      }
      const name = localStorage.getItem("splicr_display_name");
      if (name) setDisplayName(name);
      try {
        const stored = localStorage.getItem("splicr_user_data");
        if (stored) {
          const data = JSON.parse(stored);
          if (data.email) setEmail(data.email);
        }
      } catch (_) { }
    }

    loadUserData();

    const onProfileUpdated = () => {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase
            .from("profiles")
            .select("display_name, full_name, avatar_url")
            .eq("id", user.id)
            .single()
            .then(({ data: profile }) => {
              const p = profile as { display_name?: string | null; full_name?: string | null; avatar_url?: string | null } | null;
              if (p) {
                const name = p.display_name || p.full_name;
                if (name) setDisplayName(name);
                setAvatarUrl(p.avatar_url ?? null);
              }
            });
        }
      });
    };
    window.addEventListener("profile-updated", onProfileUpdated);
    return () => window.removeEventListener("profile-updated", onProfileUpdated);
  }, [pathname]);

  const widthClass = minimized ? "w-sidebar-min" : "w-sidebar-max";

  const toggleExpanded = (itemName: string) => {
    setExpandedItems((prev) => ({ ...prev, [itemName]: !prev[itemName] }));
  };

  const isItemActive = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 bottom-0 bg-surface border-r border-border z-50 transition-all duration-200 ease-in-out",
        widthClass
      )}
    >
      <div className="flex flex-col h-full">
        <div className={cn("h-20 flex items-center border-b border-border shrink-0", minimized ? "justify-center px-0" : "px-6")}>
          <Link href="/dashboard" className="flex items-center hover:opacity-90 transition-opacity" title="SplicR">
            <Image
              src="/logo.jpeg"
              alt="SplicR"
              width={minimized ? 36 : 120}
              height={minimized ? 36 : 40}
              className={cn("object-contain", minimized ? "h-9 w-9 rounded" : "h-10 w-auto")}
              priority
            />
          </Link>
        </div>

        <nav className={cn("flex-1 py-4 overflow-y-auto", minimized ? "px-2 space-y-1" : "px-3 space-y-0.5")}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = expandedItems[item.name] ?? false;
            const isGroupActive = hasChildren
              ? item.children!.some((child) => isItemActive(child.href))
              : isItemActive(item.href);

            if (minimized) {
              // Minimized: just icons, no children
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  title={item.name}
                  className={cn(
                    "flex items-center justify-center rounded-xl p-3 text-sm font-serif transition-all duration-200",
                    isGroupActive
                      ? "bg-accent text-text-primary"
                      : "text-text-secondary hover:bg-background hover:text-text-primary"
                  )}
                >
                  <Icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                </Link>
              );
            }

            if (hasChildren) {
              return (
                <div key={item.name}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.name)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-serif transition-all duration-200",
                      isGroupActive
                        ? "text-text-primary"
                        : "text-text-secondary hover:bg-background hover:text-text-primary"
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                    <span className="flex-1 text-left">{item.name}</span>
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
                      {item.children!.map((child) => {
                        const ChildIcon = child.icon;
                        const isChildActive = isItemActive(child.href);
                        return (
                          <Link
                            key={child.name}
                            href={child.href}
                            title={child.name}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-serif transition-all duration-200",
                              isChildActive
                                ? "bg-accent/15 text-accent"
                                : "text-text-secondary hover:bg-background hover:text-text-primary"
                            )}
                          >
                            <ChildIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                            <span>{child.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.name}
                href={item.href}
                title={item.name}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-serif transition-all duration-200",
                  isItemActive(item.href)
                    ? "bg-accent text-text-primary"
                    : "text-text-secondary hover:bg-background hover:text-text-primary"
                )}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Collapse / Expand button */}
        <div className={cn("border-t border-border", minimized ? "px-2 py-4" : "px-4 py-2")}>
          <button
            type="button"
            onClick={minimized ? onMaximize : onMinimize}
            title={minimized ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "w-full flex items-center rounded-xl hover:bg-background transition-colors text-text-secondary hover:text-text-primary",
              minimized ? "justify-center p-3" : "gap-3 px-4 py-3"
            )}
          >
            {minimized ? (
              <PanelRightOpen className="w-5 h-5 shrink-0" strokeWidth={1.5} />
            ) : (
              <>
                <PanelLeftClose className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                <span className="text-sm font-serif">Collapse sidebar</span>
              </>
            )}
          </button>
        </div>

        {/* User profile */}
        <div className={cn("border-t border-border", minimized ? "px-2 py-4" : "px-4 py-6")}>
          <Link
            href={hasAuth ? "/settings" : "/auth/sign-in"}
            title={displayName}
            className={cn(
              "flex items-center rounded-xl hover:bg-background transition-colors",
              minimized ? "justify-center p-3" : "gap-3 px-4 py-3"
            )}
          >
            <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center shrink-0 overflow-hidden">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-serif text-text-primary">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            {!minimized && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-serif text-text-primary truncate">{displayName}</p>
              </div>
            )}
          </Link>
        </div>
      </div>
    </aside>
  );
}
