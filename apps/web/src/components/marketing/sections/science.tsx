import { Cite } from "@/components/ui/cite";
import { LinkButton } from "@/components/ui/bits";
import { Orb } from "@/components/ui/orb";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { pipelineStages } from "@/lib/content";

const orbSizes = [76, 100, 126, 152, 182];

const facts = [
  {
    value: "0.26",
    label: "Precision when one gold-standard screen checks another",
    cite: {
      text: "Dempster et al., Nat Commun 2019",
      href: "https://doi.org/10.1038/s41467-019-13805-y",
      note: "Precision 0.255 at recall 0.781 across 147 shared cell lines",
    },
  },
  {
    value: "5.4%",
    label: "Of Avana guides perfectly target more than one gene",
    cite: {
      text: "Fortin et al., Genome Biology 2019",
      href: "https://doi.org/10.1186/s13059-019-1621-7",
      note: "3,959 of 73,782 guides, affecting 2,023 genes",
    },
  },
] as const;

export function ScienceSection() {
  return (
    <section className="bg-orange-500 text-teal-950 py-18 md:py-24 overflow-hidden">
      <div className="container-x">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <Reveal>
            <h2 className="display text-white text-3xl md:text-4xl lg:text-5xl">
              The science
              <br />
              behind the score
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <LinkButton href="/pipeline" tone="teal" size="sm" icon="none">
              See the pipeline
            </LinkButton>
          </Reveal>
        </div>

        <Stagger className="mt-14 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-10 items-end">
          {pipelineStages.map((s, i) => (
            <StaggerItem key={s.n} className="flex flex-col items-center text-center gap-4">
              <Orb size={orbSizes[i]} tone={i === 4 ? "cyan" : "orange"} />
              <div>
                <div className="text-white/85 text-xs tracking-[0.18em]">{s.n}</div>
                <div className="mt-1 text-base font-normal">{s.title}</div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <div className="mt-18 grid md:grid-cols-3 gap-8 md:gap-10 items-start">
          {facts.map((f) => (
            <Reveal key={f.value}>
              <div className="text-5xl font-medium tracking-tight tabular-nums">{f.value}</div>
              <div className="mt-2 text-white/90 leading-snug">{f.label}</div>
              <div className="mt-2 text-xs text-white/85">
                <Cite cite={f.cite} />
              </div>
            </Reveal>
          ))}
          <Reveal delay={0.1}>
            <p className="text-white/90 leading-relaxed">
              SplicR does not replace these statistics. It measures how often they were right,
              and reports that number with every hit.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
