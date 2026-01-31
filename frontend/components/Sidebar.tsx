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
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "My Analyses", href: "/analyses", icon: FileText },
  { name: "Upload New", href: "/upload", icon: Upload },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("Researcher");
  const [email, setEmail] = useState("user@example.com");
  const [hasAuth, setHasAuth] = useState(false);

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
          // Try to get display name from user metadata
          const fullName = user.user_metadata?.full_name;
          const displayNameMeta = user.user_metadata?.display_name;
          setDisplayName(
            fullName || displayNameMeta || user.email?.split("@")[0] || "Researcher"
          );
          return;
        }
      } catch (_) {
        // Supabase not configured or error, fall through to localStorage
      }

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
  }, [pathname]);

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[260px] bg-surface border-r border-border z-40">
      <div className="flex flex-col h-full">
        <div className="h-20 flex items-center px-6 border-b border-border">
          <Link href="/dashboard" className="flex items-center hover:opacity-90 transition-opacity">
            <Image src="/logo.jpeg" alt="SplicR" width={120} height={40} className="h-10 w-auto object-contain" priority />
          </Link>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href === "/upload" && pathname === "/upload");
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-serif transition-all duration-200",
                  isActive
                    ? "bg-accent text-text-primary"
                    : "text-text-secondary hover:bg-background hover:text-text-primary"
                )}
              >
                <Icon className="w-5 h-5" strokeWidth={1.5} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-6 border-t border-border">
          <Link
            href={hasAuth ? "/settings" : "/auth/sign-in"}
            className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-background transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center shrink-0">
              <span className="text-sm font-serif text-text-primary">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-serif text-text-primary truncate">{displayName}</p>
              <p className="text-xs text-text-tertiary truncate">{email}</p>
            </div>
          </Link>
        </div>
      </div>
    </aside>
  );
}
