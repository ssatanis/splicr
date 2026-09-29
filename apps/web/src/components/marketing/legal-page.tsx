import Link from "next/link";

import { MarketingNav } from "@/components/marketing/nav";
import { Reveal } from "@/components/ui/reveal";
import { site } from "@/lib/site";

export type LegalSection = {
  id: string;
  title: string;
  /** Paragraphs render in order; a string starting with "- " groups into a list. */
  body: string[];
};

/**
 * Shared frame for the privacy policy and the terms. Same sheet, nav and
 * two-column rhythm as the careers page, so a legal page does not look like it
 * was bolted on: title and contact on the left, numbered sections on the right.
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
  other,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  other: { href: string; label: string };
}) {
  return (
    <main className="sheet">
      <MarketingNav variant="pill" />

      <section className="container-x pt-14 pb-24 grid lg:grid-cols-[300px_1fr] gap-12">
        <aside className="lg:sticky lg:top-8 self-start">
          <Reveal>
            <div className="eyebrow eyebrow-ink">Last updated {updated}</div>
            <h1 className="display mt-4 text-ink text-5xl md:text-6xl">{title}</h1>
          </Reveal>
          <Reveal delay={0.1} className="mt-10">
            <nav aria-label="Sections" className="hidden lg:flex flex-col gap-2 text-sm">
              {sections.map((section, index) => (
                <a key={section.id} href={`#${section.id}`} className="text-body hover:text-ink">
                  {index + 1}. {section.title}
                </a>
              ))}
            </nav>
            <div className="mt-10 text-sm text-body">
              Questions?{" "}
              <a className="text-ink underline underline-offset-4" href={`mailto:${site.email}`}>
                {site.email}
              </a>
            </div>
          </Reveal>
        </aside>

        <div className="max-w-3xl">
          <Reveal>
            <p className="text-lg text-ink leading-relaxed">{intro}</p>
          </Reveal>

          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className="mt-12 scroll-mt-8">
              <h2 className="text-2xl md:text-3xl font-medium text-ink tracking-tight">
                {index + 1}. {section.title}
              </h2>
              <div className="mt-4 space-y-4 text-body leading-relaxed">
                {group(section.body).map((block, i) =>
                  Array.isArray(block) ? (
                    <ul key={i} className="list-disc pl-5 space-y-2">
                      {block.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={i}>{block}</p>
                  ),
                )}
              </div>
            </section>
          ))}

          <div className="mt-16 pt-6 border-t border-line text-sm text-body">
            See also our{" "}
            <Link href={other.href} className="text-ink underline underline-offset-4">
              {other.label}
            </Link>
            .
          </div>
        </div>
      </section>
    </main>
  );
}

/** Consecutive "- " lines become one list. */
function group(lines: string[]) {
  const out: Array<string | string[]> = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      const last = out[out.length - 1];
      if (Array.isArray(last)) last.push(line.slice(2));
      else out.push([line.slice(2)]);
    } else out.push(line);
  }
  return out;
}
