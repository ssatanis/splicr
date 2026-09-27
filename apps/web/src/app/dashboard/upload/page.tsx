import { UploadWizard } from "@/components/dashboard/upload-wizard";
import { PageHeader } from "@/components/dashboard/ui";

export const metadata = { title: "New run" };

export default function UploadPage() {
  return (
    <div>
      <PageHeader eyebrow="New run" title="Upload a screen" body="Five steps. The library and design are detected for you; you only confirm." />
      <UploadWizard />
    </div>
  );
}
