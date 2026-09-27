import type { Metadata } from "next";

import { ContactForm } from "@/components/marketing/contact-form";
import { MarketingNav } from "@/components/marketing/nav";
import { AccentCoil } from "@/components/three";
import { Orb } from "@/components/ui/orb";
import { Reveal } from "@/components/ui/reveal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Request a blind test, ask about the Atlas, or talk to us about a pharma pilot.",
};

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
                <h2 className="display text-ink text-4xl md:text-5xl">Send a Request</h2>
              </Reveal>
              <Reveal delay={0.1} className="mt-10 max-w-md">
                <ContactForm />
              </Reveal>
            </div>

            <Reveal delay={0.15}>
              <div className="rounded-[1.75rem] bg-orange-500 text-white p-8 md:p-10 max-w-lg">
                <h3 className="text-3xl md:text-4xl font-medium text-white">The blind test</h3>
                <div className="mt-8 flex items-end gap-8">
                  <Orb size={96} />
                  <Orb size={140} tone="cyan" />
                </div>
                <div className="mt-10 grid grid-cols-2 gap-8">
                  <div>
                    <div className="text-4xl font-medium">3 labs</div>
                    <div className="text-white/85 mt-1">To start the pilot</div>
                  </div>
                  <div>
                    <div className="text-4xl font-medium">2 wks</div>
                    <div className="text-white/85 mt-1">From upload to reveal</div>
                  </div>
                </div>
                <p className="mt-8 text-white/90 leading-relaxed">
                  Send a screen you finished a year or two ago. Do not tell us which hits worked.
                  SplicR makes its calls first, then you reveal the truth and we score it on the
                  spot.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </main>
  );
}
