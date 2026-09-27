"use client";

import { LayoutGrid, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { marketingNav } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Two looks, both from the reference set:
 *  - "pill": a floating dark pill on light pages
 *  - "bar":  a transparent bar on dark heroes
 */
export function MarketingNav({ variant = "pill" }: { variant?: "pill" | "bar" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const isPill = variant === "pill";

  return (
    <header className={cn("relative z-30", isPill ? "pt-4 md:pt-6" : "pt-6 md:pt-8")}>
      <div className="container-x">
        <div
          className={cn(
            "flex items-center justify-between",
            isPill
              ? "rounded-full bg-teal-800 text-white pl-6 pr-2 py-2 shadow-float"
              : "text-white",
          )}
        >
          <Logo tone="light" />

          <nav className="hidden lg:flex items-center gap-9 text-[0.95rem]">
            {marketingNav.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "transition-colors hover:text-orange-300",
                    active ? "text-white" : "text-white/85",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className={cn(
                "hidden md:inline-flex items-center rounded-full px-5 py-2.5 text-sm transition-colors",
                isPill ? "text-white/90 hover:text-white" : "border border-white/30 hover:bg-white/10",
              )}
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              aria-label="Open dashboard"
              className={cn(
                "inline-flex items-center justify-center rounded-full w-11 h-11 transition-transform hover:scale-105",
                isPill ? "bg-orange-500 text-white" : "border border-white/40 text-white",
              )}
            >
              <LayoutGrid className="w-4.5 h-4.5" strokeWidth={1.8} />
            </Link>
            <button
              type="button"
              aria-label="Toggle menu"
              onClick={() => setOpen((v) => !v)}
              className="lg:hidden inline-flex items-center justify-center rounded-full w-11 h-11 text-white"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="lg:hidden mt-3 rounded-3xl bg-teal-800 text-white p-6 shadow-float">
            <div className="flex flex-col gap-1">
              {marketingNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className="py-3 text-lg border-b border-white/10 last:border-0"
                >
                  {item.label}
                </Link>
              ))}
              <Link href="/careers" onClick={close} className="py-3 text-lg border-b border-white/10">
                Careers
              </Link>
              <Link href="/login" onClick={close} className="py-3 text-lg">
                Sign in
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
