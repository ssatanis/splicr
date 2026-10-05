import { FileCheck2, Info } from "lucide-react";
import type { ContextContent } from "@/lib/intake/context";

export interface ReviewedFile {
  name: string;
  purpose: string;
  context?: ContextContent;
}

export function FileInspection({ files }: { files: ReviewedFile[] }) {
  if (!files.length) return null;
  return <details className="rounded-xl border border-line bg-white" open={files.every((file) => file.context)}>
    <summary className="cursor-pointer px-4 py-3 text-[12px] font-medium text-ink">File inspection, {files.length} source{files.length === 1 ? "" : "s"}</summary>
    <ul className="divide-y divide-line border-t border-line">
      {files.map((file) => <li key={file.name} className="px-4 py-3">
        <div className="flex items-start gap-2">
          {file.context?.inspection === "retained" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true"/> : <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-navy" aria-hidden="true"/>}
          <div className="min-w-0 flex-1">
            <p className="break-words text-[12px] font-medium text-ink">{file.name}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{file.purpose}</p>
            {file.context && <>
              <p className="mt-1 text-[11px] text-muted">
                {file.context.format}, {file.context.inspection === "read" ? "Text read" : file.context.inspection === "partial" ? "Partially inspected" : "Retained for review"}
                {file.context.characters !== undefined && `, ${file.context.characters.toLocaleString()} characters`}
                {file.context.pages !== undefined && `, ${file.context.pages} pages`}
              </p>
              {file.context.text && <details className="mt-2"><summary className="cursor-pointer text-[11.5px] font-medium text-navy">View extracted text</summary><pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 font-sans text-[12px] leading-relaxed text-body">{file.context.text}</pre></details>}
              {file.context.warnings.filter((warning) => warning !== file.purpose).map((warning) => <p key={warning} className="mt-1 text-[11px] leading-relaxed text-muted">{warning}</p>)}
            </>}
          </div>
        </div>
      </li>)}
    </ul>
  </details>;
}
