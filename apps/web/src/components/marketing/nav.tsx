"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { marketingNav } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Two looks, both from the reference set:
 *   "pill" a floating dark pill on light pages
 *   "bar"  a transparent bar on dark heroes
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
            "flex items-center justify-between gap-4",
            isPill
              ? "rounded-full bg-teal-800 text-white pl-6 pr-2.5 py-2.5 shadow-float"
              : "text-white",
          )}
        >
          <Logo tone="light" size="lg" />

          <nav className="hidden lg:flex items-center gap-9 text-[0.95rem]">
            {marketingNav.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "transition-colors hover:text-orange-300",
                    active ? "text-white" : "text-white/90",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/contact"
              className={cn(
                "inline-flex items-center justify-center rounded-full bg-orange-500 text-white whitespace-nowrap",
                "px-5 sm:px-7 py-3 text-[0.95rem] font-normal transition-colors hover:bg-orange-600",
              )}
            >
              <span className="sm:hidden">Demo</span>
              <span className="hidden sm:inline">Request a Demo</span>
            </Link>
            <button
              type="button"
              aria-label="Toggle menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "lg:hidden inline-flex items-center justify-center rounded-full w-11 h-11",
                isPill ? "text-white" : "text-white",
              )}
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="lg:hidden mt-3 rounded-3xl bg-teal-800 text-white p-6 shadow-float">
            <div className="flex flex-col">
              {marketingNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className="py-3 text-lg border-b border-white/10"
                >
                  {item.label}
                </Link>
              ))}
              <Link href="/careers" onClick={close} className="py-3 text-lg border-b border-white/10">
                Careers
              </Link>
              <Link href="/contact" onClick={close} className="py-3 text-lg text-orange-300">
                Request a Demo
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
