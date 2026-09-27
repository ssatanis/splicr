/**
 * A small PDF 1.7 writer: pages, text, rules and filled rectangles.
 *
 * WHY THERE IS NO DEPENDENCY HERE.
 * The obvious candidates all cost something this route cannot pay. pdfkit needs
 * its AFM metric files resolved at runtime, which a bundled route handler does
 * not give it without an external-package escape hatch in next.config, a shared
 * file other agents are editing. @react-pdf/renderer pulls a Yoga wasm layout
 * engine and a second React reconciler into a server bundle to lay out a report
 * that is a single column of blocks. pdf-lib would fit, and it was the fallback,
 * but it would still add a dependency to a shared package.json and lockfile for
 * roughly what is written here: the fourteen standard fonts need no embedding, so
 * a report of headings, paragraphs and tables is text positioning, rectangles and
 * a cross-reference table.
 *
 * What that buys: the route has no native binding, nothing to resolve from disk,
 * and it runs identically in `next dev`, a standalone build and a serverless
 * function. What it costs: only Helvetica and Helvetica-Bold, WinAnsi encoding,
 * and no images. The report needs none of those.
 *
 * Coordinates are top-down here (y grows downward from the top edge) because
 * that is how the layout reads, and are flipped once on the way into the content
 * stream, which is bottom-up as the PDF specification requires.
 */
import { deflateSync } from "node:zlib";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export type FontName = "regular" | "bold";

/**
 * Helvetica and Helvetica-Bold advance widths in 1/1000 em, codes 32 to 126,
 * from the Adobe core font metrics. Without these, wrapping and right alignment
 * are guesses, and a table of numbers with guessed widths is unreadable.
 */
const WIDTHS: Record<FontName, number[]> = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
};

/** A handful of high-range widths that matter; the rest default close enough. */
const HIGH_WIDTHS: Record<number, number> = { 0xb0: 400, 0xb1: 584, 0xb7: 278, 0xd7: 584 };

/**
 * WinAnsi cannot represent Greek or the typographic dashes, and a screen called
 * "Jurkat IFN-γ resistance" must not lose its phenotype to a dropped glyph. So
 * the characters that actually turn up in this data are transliterated rather
 * than silently discarded.
 */
const TRANSLITERATE: Record<string, string> = {
  "—": "-",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "≥": ">=",
  "≤": "<=",
  "−": "-",
  "×": "x",
  "α": "alpha",
  "β": "beta",
  "γ": "gamma",
  "δ": "delta",
  "μ": "u",
  "′": "'",
  " ": " ",
};

export function toWinAnsi(input: string): string {
  let out = "";
  for (const ch of input) {
    const mapped = TRANSLITERATE[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    out += code <= 0xff ? ch : "?";
  }
  return out;
}

function charWidth(code: number, font: FontName): number {
  if (code >= 32 && code <= 126) return WIDTHS[font][code - 32];
  return HIGH_WIDTHS[code] ?? 556;
}

function escapeString(value: string): string {
  return value.replace(/[\\()]/g, (m) => `\\${m}`);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function color(c: Rgb): string {
  return `${fmt(c.r / 255)} ${fmt(c.g / 255)} ${fmt(c.b / 255)}`;
}

export interface TextOptions {
  size?: number;
  font?: FontName;
  color?: Rgb;
  align?: "left" | "right" | "center";
  /** Extra space between characters, for the small letterspaced labels. */
  tracking?: number;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export class PdfDocument {
  readonly width: number;
  readonly height: number;
  private readonly pages: string[][] = [];
  private current: string[] = [];

  constructor(width = 595.28, height = 841.89) {
    this.width = width;
    this.height = height;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  newPage(): void {
    this.current = [];
    this.pages.push(this.current);
  }

  /** Width of a run in points, tracking included. */
  measure(text: string, size: number, font: FontName = "regular", tracking = 0): number {
    const encoded = toWinAnsi(text);
    let total = 0;
    for (let i = 0; i < encoded.length; i++) {
      total += charWidth(encoded.charCodeAt(i), font);
    }
    return (total * size) / 1000 + tracking * Math.max(0, encoded.length - 1);
  }

  /** Greedy wrap on spaces. Long unbroken tokens are left to overflow rather than cut. */
  wrap(text: string, size: number, font: FontName, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (this.measure(candidate, size, font) <= maxWidth || line === "") {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line !== "") lines.push(line);
    return lines;
  }

  /** Truncates to fit, with a trailing ellipsis rendered as three dots. */
  clip(text: string, size: number, font: FontName, maxWidth: number): string {
    if (this.measure(text, size, font) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 1 && this.measure(`${cut}...`, size, font) > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return `${cut}...`;
  }

  text(value: string, x: number, yTop: number, options: TextOptions = {}): void {
    const { size = 10, font = "regular", color: fill = BLACK, align = "left", tracking = 0 } = options;
    const encoded = toWinAnsi(value);
    if (encoded === "") return;
    const w = this.measure(value, size, font, tracking);
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    const y = this.height - yTop;
    const ops = [
      "BT",
      `${color(fill)} rg`,
      `/${font === "bold" ? "F2" : "F1"} ${fmt(size)} Tf`,
    ];
    if (tracking !== 0) ops.push(`${fmt(tracking)} Tc`);
    ops.push(`1 0 0 1 ${fmt(left)} ${fmt(y)} Tm`, `(${escapeString(encoded)}) Tj`);
    if (tracking !== 0) ops.push("0 Tc");
    ops.push("ET");
    this.current.push(ops.join("\n"));
  }

  rect(x: number, yTop: number, w: number, h: number, fill: Rgb): void {
    this.current.push(`${color(fill)} rg`, `${fmt(x)} ${fmt(this.height - yTop - h)} ${fmt(w)} ${fmt(h)} re f`);
  }

  hairline(x: number, yTop: number, w: number, stroke: Rgb, thickness = 0.6): void {
    const y = this.height - yTop;
    this.current.push(
      `${color(stroke)} RG`,
      `${fmt(thickness)} w`,
      `${fmt(x)} ${fmt(y)} m ${fmt(x + w)} ${fmt(y)} l S`,
    );
  }

  /**
   * Re-enters each page once every page exists, so running heads and "page 2 of
   * 4" can be drawn with the total known.
   */
  eachPage(draw: (pageNumber: number, total: number) => void): void {
    const total = this.pages.length;
    const previous = this.current;
    this.pages.forEach((ops, index) => {
      this.current = ops;
      draw(index + 1, total);
    });
    this.current = previous;
  }

  /**
   * Serialises to a PDF. Object numbers are assigned up front so page objects can
   * reference their content streams before those streams exist: 1 catalog,
   * 2 page tree, 3 and 4 the two fonts, 5 the document information dictionary,
   * then a page object and a content stream per page.
   */
  toBuffer(info: { title: string; subject: string; author: string; createdAt: Date; id: string }): Buffer {
    const pageObjectNumber = (index: number) => 6 + index * 2;
    const contentObjectNumber = (index: number) => 7 + index * 2;
    const totalObjects = 5 + this.pages.length * 2;

    const bodies: Buffer[] = [];
    const push = (num: number, content: string | Buffer) => {
      const head = Buffer.from(`${num} 0 obj\n`, "latin1");
      const body = typeof content === "string" ? Buffer.from(content, "latin1") : content;
      bodies[num - 1] = Buffer.concat([head, body, Buffer.from("\nendobj\n", "latin1")]);
    };

    push(1, "<< /Type /Catalog /Pages 2 0 R >>");
    push(
      2,
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages
        .map((_, i) => `${pageObjectNumber(i)} 0 R`)
        .join(" ")}] >>`,
    );
    push(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    push(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    const stamp = pdfDate(info.createdAt);
    push(
      5,
      `<< /Title (${escapeString(toWinAnsi(info.title))}) /Author (${escapeString(toWinAnsi(info.author))}) ` +
        `/Subject (${escapeString(toWinAnsi(info.subject))}) /Creator (SplicR) /Producer (splicr.report) ` +
        `/CreationDate (${stamp}) /ModDate (${stamp}) >>`,
    );

    this.pages.forEach((ops, index) => {
      push(
        pageObjectNumber(index),
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(this.height)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber(index)} 0 R >>`,
      );
      const stream = deflateSync(Buffer.from(ops.join("\n"), "latin1"));
      push(
        contentObjectNumber(index),
        Buffer.concat([
          Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
          stream,
          Buffer.from("\nendstream", "latin1"),
        ]),
      );
    });

    // A binary comment on line two tells any transport that this is not text.
    const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    const offsets: number[] = [];
    let cursor = chunks[0].length;
    for (let num = 1; num <= totalObjects; num++) {
      offsets[num] = cursor;
      const body = bodies[num - 1];
      chunks.push(body);
      cursor += body.length;
    }

    const xrefOffset = cursor;
    const xref = [`xref\n0 ${totalObjects + 1}\n`, "0000000000 65535 f \n"];
    for (let num = 1; num <= totalObjects; num++) {
      xref.push(`${String(offsets[num]).padStart(10, "0")} 00000 n \n`);
    }
    chunks.push(Buffer.from(xref.join(""), "latin1"));
    chunks.push(
      Buffer.from(
        `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info 5 0 R /ID [<${info.id}> <${info.id}>] >>\n` +
          `startxref\n${xrefOffset}\n%%EOF\n`,
        "latin1",
      ),
    );

    return Buffer.concat(chunks);
  }
}

function pdfDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}
