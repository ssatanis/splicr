import { Marquee } from "@/components/ui/marquee";
import { marqueeRows } from "@/lib/content";

export function ServicesMarquee() {
  return (
    <section className="bg-teal-800 text-white py-14 md:py-18 overflow-hidden">
      <div className="container-x flex items-center gap-10 mb-8">
        <span className="text-xs text-white/80">01</span>
        <span className="eyebrow text-cyan-400">What SplicR does</span>
      </div>
      <div className="space-y-3">
        <Marquee items={[...marqueeRows[0]]} />
        <Marquee items={[...marqueeRows[1]]} reverse />
        <Marquee items={[...marqueeRows[2]]} />
      </div>
    </section>
  );
}
