import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { site } from "@/lib/site";

/**
 * The frame every auth page renders into.
 *
 * Two columns on a wide screen, one column everywhere else. The left panel is
 * not a hero that collapses on top of the form: below `lg` it is not rendered
 * at all. Stacking it would push the sign-in fields under a screenful of
 * product copy on exactly the devices where someone is most likely to be
 * signing in one-handed, and a person who has arrived at a sign-in page is not
 * there to read about the product.
 */
export function AuthPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      {/* Desktop only. `hidden` rather than a media query on the contents, so
          nothing in here is downloaded, measured or announced on a phone. */}
      <aside className="relative hidden flex-col justify-between bg-teal-800 p-12 text-white lg:flex">
        <div className="flex items-center justify-between">
          <Logo tone="light" href="/" />
          <Link
            href="/"
            className="text-[13px] text-white/75 transition-colors duration-[var(--dur-1)] hover:text-white motion-reduce:transition-none"
          >
            Back to site
          </Link>
        </div>

        <div className="max-w-md">
          <p className="text-[26px] font-medium leading-[1.25] tracking-[-0.02em] text-white">
            Inspect the evidence behind your CRISPR hits.
          </p>
          <p className="mt-4 text-[14px] leading-relaxed text-white/70">{site.description}</p>
        </div>

        <p className="text-[12px] text-white/50">
          {site.name}
          <br />
          {site.location}
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-[380px]">
          {/* The wordmark belongs to the form column when there is no panel
              beside it, and nowhere else: two wordmarks on one screen is a
              template, not a product. */}
          <div className="mb-9 lg:hidden">
            <Logo href="/" size="sm" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
