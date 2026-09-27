import { AtlasExplorer } from "@/components/dashboard/atlas-explorer";
import { PageHeader } from "@/components/dashboard/ui";

export const metadata = { title: "Atlas" };

export default function AtlasPage() {
  return (
    <div>
      <PageHeader eyebrow="Atlas" title="The answer key" body="Every public CRISPR screen, re-run through one pipeline, plus the record of which hits held up." />
      <AtlasExplorer />
    </div>
  );
}
