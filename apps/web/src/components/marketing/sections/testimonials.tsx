import { Quote } from "lucide-react";

import { SectionHeading } from "@/components/ui/bits";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { testimonials } from "@/lib/content";

export function Testimonials() {
  return (
    <section className="py-16 md:py-24 bg-mist-soft">
      <div className="container-x">
        <Reveal>
          <SectionHeading
            eyebrow="What labs say"
            title={
              <>
                Trusted where the
                <br />
                validation happens.
              </>
            }
          />
        </Reveal>

        <Stagger className="mt-12 grid md:grid-cols-3 gap-5">
          {testimonials.map((t) => (
            <StaggerItem key={t.name} className="card p-8 flex flex-col">
              <Quote className="w-6 h-6 text-orange-500" />
              <p className="mt-5 text-ink text-lg leading-relaxed flex-1">&ldquo;{t.quote}&rdquo;</p>
              <div className="mt-8 flex items-center gap-4">
                <span className="w-11 h-11 rounded-full bg-teal-800 text-white flex items-center justify-center text-sm font-medium">
                  {t.initials}
                </span>
                <div>
                  <div className="text-ink font-medium">{t.name}</div>
                  <div className="text-sm text-muted">{t.role}</div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
        <p className="mt-6 text-xs text-muted">
          Design-partner quotes are illustrative placeholders until published with permission.
        </p>
      </div>
    </section>
  );
}
