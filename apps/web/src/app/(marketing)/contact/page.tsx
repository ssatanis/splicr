import { marketingMetadata } from "@/lib/marketing-metadata";

import { CalendlyInline } from "@/components/marketing/calendly";
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

/** The three reasons a lab writes to us. All of them land in the same inbox, so
    the address is stated once underneath rather than three times across. */
const contactRoutes = [
  { label: "Blind test", q: "Have a finished screen we can score blind?" },
  { label: "Pilots", q: "Want to run your own data through it?" },
  { label: "Partners", q: "Are you a core, vendor or AI platform?" },
];

export default function ContactPage() {
  return (
    <main className="sheet">
      <MarketingNav variant="pill" />

      <section className="relative overflow-hidden">
        <AccentCoil className="absolute -right-16 top-20 w-[560px] h-[720px] hidden lg:block" />

        <div className="container-x pt-14 pb-24 relative">
          <div className="grid lg:grid-cols-[0.72fr_1.28fr] gap-10 lg:gap-14 items-center">
            <div>
              <Reveal>
                <h1 className="display text-ink text-4xl md:text-5xl lg:text-6xl">Interested in SplicR?</h1>
              </Reveal>
              <Reveal delay={0.08}>
                <p className="mt-5 text-lg text-body leading-relaxed">
                  Book fifteen minutes and we will set your lab up on SplicR, using one of your own
                  screens if you have one to hand. No slides.
                </p>
              </Reveal>
              <Reveal delay={0.14}>
                <div className="mt-8 border-t border-line">
                  {contactRoutes.map((route) => (
                    <div key={route.label} className="py-3.5 border-b border-line flex items-baseline gap-3">
                      <span className="chip text-xs shrink-0">{route.label}</span>
                      <span className="text-ink leading-snug">{route.q}</span>
                    </div>
                  ))}
                </div>
              </Reveal>
              <Reveal delay={0.2}>
                <p className="mt-5 text-sm text-body">
                  Any of those, or nothing in the calendar that works?{" "}
                  <a href={`mailto:${site.email}`} className="text-orange-500 hover:text-orange-600">
                    {site.email}
                  </a>
                </p>
              </Reveal>
            </div>

            <Reveal delay={0.1}>
              <div className="rounded-[1.75rem] border border-line bg-white/90 backdrop-blur overflow-hidden">
                <CalendlyInline url={site.calendly} className="h-[680px] md:h-[640px]" />
                <noscript>
                  <div className="p-8">
                    <a href={site.calendly} className="text-orange-500 hover:text-orange-600">
                      Open the booking calendar
                    </a>
                  </div>
                </noscript>
              </div>
            </Reveal>
          </div>

          <div className="mt-24 grid lg:grid-cols-[1fr_1fr] gap-16 items-start">
            <div>
              <Reveal>
                <h2 className="display text-ink text-4xl md:text-5xl">Request access</h2>
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
