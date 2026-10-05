/** Extract supporting content as data. No embedded script, macro or instruction is executed. */
import { Unzip, UnzipInflate } from "fflate";
import { XMLParser } from "fast-xml-parser";

export const CONTEXT_BYTES = 16 * 1024 * 1024;
const PREVIEW_CHARACTERS = 6000;
const DOCUMENT_XML_BYTES = 32 * 1024 * 1024;

export interface ContextContent {
  kind: "context";
  format: string;
  inspection: "read" | "partial" | "retained";
  note: string;
  text?: string;
  characters?: number;
  pages?: number;
  warnings: string[];
}

function retained(format: string, note: string): ContextContent {
  return { kind: "context", format, inspection: "retained", note, warnings: [note] };
}

function content(format: string, text: string, partial = false, warnings: string[] = []): ContextContent {
  const cleaned = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return retained(format, "No readable text found. The original file is retained; images and scans require OCR.");
  return {
    kind: "context", format, inspection: partial ? "partial" : "read",
    note: partial ? "Text was read from part of this file." : "Readable text extracted. Supporting content is not used as screen counts.",
    text: cleaned.slice(0, PREVIEW_CHARACTERS), characters: cleaned.length,
    warnings: [...warnings, ...(cleaned.length > PREVIEW_CHARACTERS ? ["The preview shows the first 6,000 characters of extracted text."] : [])],
  };
}

/** Inflate only document XML, with an aggregate decompression bound. */
function documentXml(bytes: Uint8Array, include: (name: string) => boolean): Map<string, string> {
  const files = new Map<string, string>();
  let inflated = 0;
  let count = 0;
  const unzip = new Unzip((entry) => {
    if (!include(entry.name)) return;
    count += 1;
    if (count > 2048) throw new Error("This document has too many sections to preview.");
    const chunks: Uint8Array[] = [];
    entry.ondata = (error, data, final) => {
      if (error) throw error;
      inflated += data.length;
      if (inflated > DOCUMENT_XML_BYTES) { entry.terminate(); throw new Error("The expanded document exceeds the preview limit."); }
      chunks.push(data);
      if (final) {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
        files.set(entry.name, new TextDecoder().decode(joined));
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(bytes, true);
  return files;
}

function xmlText(xml: string, openDocument = false): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Document entities are not supported in previews.");
  const parsed: unknown = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: false, parseTagValue: false }).parse(xml);
  const fragments: string[] = [];
  function visit(value: unknown, insideText = false) {
    if (Array.isArray(value)) { value.forEach((child) => visit(child, insideText)); return; }
    if (!value || typeof value !== "object") return;
    for (const [tag, child] of Object.entries(value)) {
      if (tag === "#text" && insideText) fragments.push(String(child));
      else {
        const local = tag.split(":").pop();
        visit(child, insideText || local === "t" || (openDocument && (local === "p" || local === "h")));
        if (local === "p" || local === "h" || local === "br") fragments.push("\n");
        if (local === "tab") fragments.push("\t");
      }
    }
  }
  visit(parsed);
  return fragments.join("");
}

export async function inspectContext(bytes: Uint8Array, name: string, complete = true): Promise<ContextContent> {
  const extension = name.split(".").pop()?.toLowerCase() || "unknown";
  const format = extension.toUpperCase();
  if (/^(zip|tar|gz|bz2|xz|7z|rar)$/.test(extension)) return retained(format, "Archive retained. Files unpacked from supported ZIP bundles are inspected separately.");
  try {
    if (extension === "pdf") {
      if (!complete) return retained(format, "PDF retained. Text preview supports documents up to 16 MB.");
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false });
      try {
        const result = await parser.getText({ first: 100, pageJoiner: "\n" });
        const partial = result.total > result.pages.length;
        return { ...content(format, result.text, partial, ["Embedded images and scanned pages require OCR.", ...(partial ? ["Only the first 100 pages were read."] : [])]), pages: result.total };
      } finally { await parser.destroy(); }
    }
    if (/^(docx|docm|pptx|pptm|odt|odp)$/.test(extension)) {
      if (!complete) return retained(format, "Document retained. Text preview supports documents up to 16 MB.");
      const openDocument = /^(odt|odp)$/.test(extension);
      const files = documentXml(bytes, (file) => openDocument ? file === "content.xml" : /^(word\/(document|header\d+|footer\d+|footnotes|endnotes)|ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+))\.xml$/.test(file));
      if (!files.size) return retained(format, "The document could not be opened. It may be encrypted, damaged or mislabeled.");
      const text = [...files].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([section, xml]) => {
          const extracted = xmlText(xml, openDocument).trim();
          return extracted ? `${section}\n${extracted}` : "";
        }).filter(Boolean).join("\n\n");
      return content(format, text, false, ["Text and table cells are extracted; embedded images, charts and macros are not interpreted."]);
    }
    if (/^(png|jpe?g|gif|webp|tiff?|bmp|avif|heic)$/.test(extension)) {
      if (!complete) return retained(format, "Image retained. Metadata preview supports images up to 16 MB; image contents require visual review or OCR.");
      const { default: sharp } = await import("sharp");
      const metadata = await sharp(bytes).metadata();
      return { kind: "context", format, inspection: "partial", note: `Image dimensions: ${metadata.width ?? "?"} × ${metadata.height ?? "?"} pixels.`, warnings: ["Image content and text have not been interpreted. Visual review or OCR is required."] };
    }
    // Unknown binary formats remain attachable; do not turn random bytes into fake text.
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    let text: string;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: !complete }); }
    catch { return retained(format, "File retained. This binary format needs a dedicated reader; its contents have not been interpreted."); }
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) return retained(format, "File retained. This binary format needs a dedicated reader; its contents have not been interpreted.");
    if (extension === "html" || extension === "htm") text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ");
    return content(format, text, !complete, complete ? [] : ["Only the first 16 MB were read."]);
  } catch {
    return retained(format, "File retained, but content extraction failed. It may be encrypted, damaged or require a dedicated reader.");
  }
}
