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
  Box,
  PanelRightOpen,
  PanelLeftClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useSidebar } from "@/lib/context/SidebarContext";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "My Analyses", href: "/analyses", icon: FileText },
  { name: "Upload New", href: "/upload", icon: Upload },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Analytics", href: "/analytics", icon: LineChart },
  // { name: "Structure Viewer", href: "/structure-viewer", icon: Box }, // Hidden - can be restored by uncommenting
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

  // Use context state, but allow prop override for testing
  const minimized = minimizedProp ?? ctx.isMinimized;
  const setMinimized = ctx.setMinimized;
  const onMaximize = onMaximizeProp ?? (() => setMinimized(false));
  const onMinimize = () => setMinimized(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    async function loadUserData() {
      // First, try Supabase session
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

      // Fallback to legacy localStorage auth
      setHasAuth(!!localStorage.getItem("splicr_auth_token"));
      const authUser = localStorage.getItem("splicr_auth_user");
      if (authUser) {
        try {
          const u = JSON.parse(authUser);
          setEmail(u.email || "user@example.com");
          setDisplayName(u.display_name || u.email?.split("@")[0] || "Researcher");
          return;
        } catch (_) {}
      }
      const name = localStorage.getItem("splicr_display_name");
      if (name) setDisplayName(name);
      try {
        const stored = localStorage.getItem("splicr_user_data");
        if (stored) {
          const data = JSON.parse(stored);
          if (data.email) setEmail(data.email);
        }
      } catch (_) {}
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

        <nav className={cn("flex-1 py-6 space-y-1", minimized ? "px-2" : "px-4")}>
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href === "/upload" && pathname === "/upload");
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                title={item.name}
                className={cn(
                  "flex items-center rounded-xl text-sm font-serif transition-all duration-200",
                  minimized ? "justify-center p-3" : "gap-3 px-4 py-3",
                  isActive
                    ? "bg-accent text-text-primary"
                    : "text-text-secondary hover:bg-background hover:text-text-primary"
                )}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                {!minimized && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Minimize when expanded / Maximize when minimized — available on all pages */}
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
