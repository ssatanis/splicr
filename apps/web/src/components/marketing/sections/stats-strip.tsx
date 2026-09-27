import { Cite } from "@/components/ui/cite";
import { Reveal } from "@/components/ui/reveal";
import { heroStats } from "@/lib/content";

export function StatsStrip() {
  return (
    <section className="container-x pb-16 md:pb-24">
      <Reveal>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y divide-line lg:divide-y-0 lg:divide-x border-y border-line">
          {heroStats.map((s) => (
            <div key={s.label} className="px-4 sm:px-6 py-7 text-center">
              <div className="text-3xl md:text-4xl font-medium tracking-tight text-ink tabular-nums">
                {s.value}
              </div>
              <div className="mt-2 text-sm text-body leading-snug text-balance">{s.label}</div>
              <div className="mt-2 text-xs text-muted">
                <Cite cite={s.cite} />
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
