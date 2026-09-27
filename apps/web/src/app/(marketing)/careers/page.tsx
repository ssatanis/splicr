import type { Metadata } from "next";
import { Search } from "lucide-react";
import Link from "next/link";

import { MarketingNav } from "@/components/marketing/nav";
import { RolesList } from "@/components/marketing/roles-list";
import { Reveal } from "@/components/ui/reveal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Careers",
  description: "Open roles at SplicR.",
};

export default function CareersPage() {
  return (
    <main className="sheet">
      <MarketingNav variant="pill" />

      <section className="container-x pt-14 pb-20 grid lg:grid-cols-[300px_1fr] gap-12">
        <div className="flex flex-col justify-between">
          <div>
            <Reveal>
              <h1 className="display text-ink text-5xl md:text-6xl">
                Our Open
                <br />
                Roles
              </h1>
            </Reveal>
            <Reveal delay={0.1} className="mt-16">
              <div className="eyebrow eyebrow-ink">Or contact us with</div>
              <a
                href={`mailto:${site.email}`}
                className="mt-3 inline-block text-xl text-orange-500 underline underline-offset-[6px] decoration-orange-300"
              >
                {site.email}
              </a>
            </Reveal>
          </div>
          <div className="hidden lg:flex flex-col gap-2 text-ink text-sm mt-24">
            <span className="inline-flex items-center gap-2">
              <Search className="w-3.5 h-3.5" /> Search
            </span>
            <Link href="/technology" className="hover:text-orange-500">
              Products
            </Link>
            <Link href="/about" className="hover:text-orange-500">
              Company
            </Link>
          </div>
        </div>

        <div>
          <RolesList />

          <div className="mt-20 grid md:grid-cols-2 gap-12">
            <div>
              <span className="chip text-xs">How it works</span>
              <p className="mt-5 text-lg text-ink leading-relaxed">
                Apply with a note and something you built. We reply within a week, do one
                technical conversation, and make a decision after a paid work trial.
              </p>
            </div>
            <div>
              <span className="chip text-xs">Where</span>
              <p className="mt-5 text-lg text-ink leading-relaxed">
                {site.location}, near the labs we serve. Hybrid within the city; a twelve-week
                stretch in San Francisco is possible in early 2027.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
