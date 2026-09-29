import { marketingMetadata } from "@/lib/marketing-metadata";
import { site } from "@/lib/site";
import { AgeSection } from "@/components/marketing/sections/age";
import { CtaSection } from "@/components/marketing/sections/cta";
import { Hero } from "@/components/marketing/sections/hero";
import { HitReportPreview } from "@/components/marketing/sections/hit-report-preview";
import { PipelineSection } from "@/components/marketing/sections/pipeline";
import { RedefinedSection } from "@/components/marketing/sections/redefined";
import { ScienceSection } from "@/components/marketing/sections/science";
import { ServicesMarquee } from "@/components/marketing/sections/services";
import { StatementCard } from "@/components/marketing/sections/statement";
import { StatsStrip } from "@/components/marketing/sections/stats-strip";

export const metadata = marketingMetadata("/", {
  title: site.name,
  description: site.description,
});

export default function HomePage() {
  return (
    <main className="sheet">
      <Hero />
      <StatsStrip />
      <AgeSection />
      <ServicesMarquee />
      <ScienceSection />
      <StatementCard />
      <PipelineSection />
      <RedefinedSection />
      <HitReportPreview />
      <CtaSection />
    </main>
  );
}
