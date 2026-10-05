import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { footerColumns, site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="sheet sheet-dark mt-0">
      <div className="container-x py-14 md:py-18">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Logo tone="light" size="lg" />
            <p className="mt-5 max-w-xs text-white/90 leading-relaxed">{site.tagline}</p>
            <a
              href={`mailto:${site.email}`}
              className="mt-5 inline-flex items-center gap-1.5 text-orange-300 hover:text-orange-200"
            >
              {site.email}
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>

          {footerColumns.map((col) => (
            <div key={col.title}>
              <div className="eyebrow text-cyan-400 mb-4">{col.title}</div>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-white/90 hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-white/10 text-sm text-white/80">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span className="flex flex-col gap-0.5">
              <span>&copy; {new Date().getFullYear()} {site.name}. All rights reserved.</span>
            </span>
            <span className="flex gap-5">
              <Link href="/terms" className="hover:text-white">
                Terms &amp; Conditions
              </Link>
              <Link href="/privacy" className="hover:text-white">
                Privacy Policy
              </Link>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
