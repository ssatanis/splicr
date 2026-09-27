import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { AccentCoil } from "@/components/three";
import { site } from "@/lib/site";

/**
 * Two-column frame for login and signup. The artwork sits in its own band
 * behind a scrim so the copy below it always stays readable, at every width.
 */
export function AuthPanel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid lg:grid-cols-[1.05fr_1fr] min-h-[calc(100vh-2*var(--sheet-margin))]">
      <div className="relative bg-teal-800 text-white flex flex-col p-7 md:p-10 lg:p-12 overflow-hidden">
        <div className="relative z-20 flex items-center justify-between">
          <Logo tone="light" />
          <Link href="/" className="text-sm text-white/70 hover:text-white">
            Back to site
          </Link>
        </div>

        {/* Artwork band: fixed height, never behind the text. */}
        <div className="relative z-0 h-40 sm:h-52 lg:flex-1 lg:h-auto lg:min-h-[180px] my-6">
          <AccentCoil className="absolute inset-0" />
        </div>

        <div className="relative z-20 max-w-md">
          <h1 className="display text-white text-3xl sm:text-4xl lg:text-5xl">
            Know which
            <br />
            hits are real.
          </h1>
          <p className="mt-4 text-white/75 leading-relaxed">{site.description}</p>
          {aside}
        </div>

        <div className="relative z-20 mt-8 flex flex-wrap gap-x-8 gap-y-2 text-xs text-white/55">
          <span>SOC 2 in progress</span>
          <span>Data stays in us-east-1</span>
          <span>Free for public data</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
