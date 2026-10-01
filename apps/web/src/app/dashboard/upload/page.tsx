import { Card, PageHeader } from "@/components/dashboard/ui";
import { getCurrentContext } from "@/lib/data/org";

export const metadata = { title: "New screen" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const context = await getCurrentContext();
  if (context.isDemo) {
    const { UploadWizard } = await import("@/components/dashboard/upload-wizard");
    return <div><PageHeader eyebrow="Demonstration" title="Upload preview" body="Illustrative files and run progress. No files are uploaded or analyzed." /><UploadWizard /></div>;
  }
  return <div className="flex flex-col gap-4">
    <PageHeader dense title="Upload a screen" body="New analysis" />
    <Card title="Browser analysis is not connected">
      <p className="text-sm">This workspace cannot upload files or start analysis jobs from the browser yet. No run has been queued. The local analysis engine can process FASTQ and count tables; persisted results appear in your workspace after an authorized engine run.</p>
    </Card>
  </div>;
}
