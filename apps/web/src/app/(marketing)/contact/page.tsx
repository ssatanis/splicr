import { marketingMetadata } from "@/lib/marketing-metadata";

import { ContactForm } from "@/components/marketing/contact-form";
import { MarketingNav } from "@/components/marketing/nav";
import { AccentCoil } from "@/components/three";
import { Orb } from "@/components/ui/orb";
import { Reveal } from "@/components/ui/reveal";
import { site } from "@/lib/site";

export const metadata = marketingMetadata("/contact", {
  title: "Contact",
  description: "Request a blind test, ask about the Atlas, or talk to us about a pharma pilot.",
});

const contactCards = [
  { label: "Blind test", q: "Have a finished screen we can score blind?", email: site.email },
  { label: "Pilots", q: "Prefer to email us directly?", email: site.email },
  { label: "Partners", q: "Are you a core, vendor or AI platform?", email: site.email },
];

export default function ContactPage() {
  return (
    <main className="sheet">
      <MarketingNav variant="pill" />

      <section className="relative overflow-hidden">
        <AccentCoil className="absolute -right-16 top-20 w-[560px] h-[720px] hidden lg:block" />

        <div className="container-x pt-14 pb-24 relative">
          <Reveal>
            <h1 className="display text-ink text-5xl md:text-6xl lg:text-7xl">Interested in SplicR?</h1>
          </Reveal>

          <Reveal delay={0.1} className="mt-12">
            <div className="rounded-[1.75rem] border border-line bg-white/90 backdrop-blur p-6 md:p-8 grid md:grid-cols-3 gap-8 max-w-4xl">
              {contactCards.map((c) => (
                <div key={c.label}>
                  <span className="chip text-xs">{c.label}</span>
                  <div className="mt-4 text-xl text-ink leading-snug">{c.q}</div>
                  <a href={`mailto:${c.email}`} className="mt-4 inline-block text-orange-500 hover:text-orange-600">
                    {c.email}
                  </a>
                </div>
              ))}
            </div>
          </Reveal>

          <div className="mt-20 grid lg:grid-cols-[1fr_1fr] gap-16 items-start">
            <div>
              <Reveal>
                <h2 className="display text-ink text-4xl md:text-5xl">Prepare an email</h2>
              </Reveal>
              <Reveal delay={0.1} className="mt-10 max-w-md">
                <ContactForm />
              </Reveal>
            </div>

            <Reveal delay={0.15}>
              <div className="rounded-[1.75rem] bg-orange-500 text-white p-8 md:p-10 max-w-lg">
                <h3 className="text-3xl md:text-4xl font-medium text-white">A proposed blinded evaluation</h3>
                <div className="mt-8 flex items-end gap-8">
                  <Orb size={96} />
                  <Orb size={140} tone="cyan" />
                </div>
                <div className="mt-10 grid grid-cols-2 gap-8">
                  <div>
                    <div className="text-4xl font-medium">1. Freeze</div>
                    <div className="text-white/85 mt-1">Predictions and outcome definitions</div>
                  </div>
                  <div>
                    <div className="text-4xl font-medium">2. Reveal</div>
                    <div className="text-white/85 mt-1">Independent outcomes after scoring</div>
                  </div>
                </div>
                <p className="mt-8 text-white/90 leading-relaxed">
                  Discuss a study whose validation outcomes can be withheld from model development. Agree on eligibility, timing and the analysis plan before sharing data. No completed independent pilot result is claimed here.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </main>
  );
}
