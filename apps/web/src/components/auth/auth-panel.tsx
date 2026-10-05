import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { HeroField } from "@/components/three";
import { site } from "@/lib/site";

/**
 * A focused auth surface built from the same sheet, navigation, typography and
 * scientific artwork as the public landing page. The form remains independent
 * of the decorative WebGL layer, so slow graphics never delay sign-in.
 */
export function AuthPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-peach p-2 sm:p-3 md:p-5">
      <section
        data-testid="auth-frame"
        className="relative flex min-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[1.5rem] bg-white sm:min-h-[calc(100dvh-1.5rem)] sm:rounded-[2rem] md:min-h-[calc(100dvh-2.5rem)]"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
          <HeroField className="absolute inset-0 h-full w-full" />
        </div>

        <header className="relative z-20 px-3 pt-3 sm:px-5 sm:pt-5">
          <nav
            aria-label="Sign-in navigation"
            className="mx-auto flex h-14 max-w-[1360px] items-center justify-between rounded-full bg-teal-800 px-5 text-white shadow-soft sm:h-16 sm:px-7"
          >
            <Logo tone="light" size="sm" />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[13px] font-normal text-white/85 transition-colors duration-[var(--dur-1)] hover:text-white motion-reduce:transition-none"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to site
            </Link>
          </nav>
        </header>

        <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:px-8 sm:py-10 md:py-12">
          <div
            data-testid="auth-card"
            className="w-full max-w-[460px] rounded-2xl border border-line bg-white p-5 shadow-float sm:p-8 md:p-10"
          >
            {children}
          </div>
        </main>

        <footer className="relative z-10 px-6 pb-6 text-center text-[11px] text-muted sm:px-8 sm:pb-8">
          &copy; {new Date().getFullYear()} {site.name}. All rights reserved.
        </footer>
      </section>
    </div>
  );
}
