/**
 * The printable Hit Report.
 *
 * A4 because supplementary material is read and printed on A4 almost everywhere
 * outside the United States, and an A4 layout prints on Letter with a margin to
 * spare while the reverse clips. One column, generous leading, brand colours from
 * globals.css, and no element that depends on colour alone to carry meaning, so
 * it survives a greyscale office printer.
 *
 * Page 1 is the report: what the screen says and how it was produced. Page 2 is
 * the provenance record. The remaining pages are the ranked hit table, truncated
 * with the truncation stated, because the complete table belongs in the CSV.
 */
import { formatNumber, formatPercent } from "@/lib/utils";

import { excelAmbiguousSymbols, VERDICT_ORDER, type ReportDocument } from "./document";
import { PdfDocument, type FontName, type Rgb } from "./pdf-writer";

// Brand tokens, taken from globals.css rather than picked again by eye.
const INK: Rgb = { r: 23, g: 79, b: 98 };
const BODY: Rgb = { r: 79, g: 100, b: 112 };
const MUTED: Rgb = { r: 98, g: 107, b: 120 };
const ORANGE: Rgb = { r: 194, g: 86, b: 10 };
const ORANGE_DEEP: Rgb = { r: 143, g: 61, b: 7 };
const ORANGE_TINT: Rgb = { r: 255, g: 243, b: 232 };
const CYAN: Rgb = { r: 11, g: 114, b: 133 };
const LINE: Rgb = { r: 214, g: 222, b: 228 };
const MIST: Rgb = { r: 238, g: 241, b: 245 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

const MARGIN = 48;
const MAX_TABLE_ROWS = 60;

interface Cell {
  text: string;
  width: number;
  align?: "left" | "right";
  font?: FontName;
  color?: Rgb;
  size?: number;
}

/** Exponent notation only where a fixed decimal would print as zero. */
function small(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value === 0) return "0";
  return Math.abs(value) < 1e-3 ? value.toExponential(1) : value.toFixed(3);
}

function seconds(total: number): string {
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function stamp(iso: string | null): string {
  if (!iso) return "not recorded";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function toPdf(doc: ReportDocument, generatedAt: Date): Buffer {
  const pdf = new PdfDocument();
  const contentWidth = pdf.width - MARGIN * 2;
  const bottom = pdf.height - 62;
  let y = 0;

  const startPage = () => {
    pdf.newPage();
    pdf.text("SPLICR", MARGIN, 46, { size: 8.5, font: "bold", tracking: 2.2, color: INK });
    pdf.text("HIT REPORT", pdf.width - MARGIN, 46, {
      size: 8.5,
      font: "bold",
      tracking: 2,
      color: MUTED,
      align: "right",
    });
    pdf.hairline(MARGIN, 56, contentWidth, LINE);
    y = 84;
  };

  const ensure = (space: number) => {
    if (y + space > bottom) startPage();
  };

  const heading = (label: string) => {
    ensure(46);
    y += 10;
    pdf.text(label.toUpperCase(), MARGIN, y, { size: 7.5, font: "bold", tracking: 1.6, color: CYAN });
    y += 7;
    pdf.hairline(MARGIN, y, contentWidth, LINE);
    y += 18;
  };

  const paragraph = (
    text: string,
    options: { size?: number; leading?: number; color?: Rgb; font?: FontName; width?: number; x?: number } = {},
  ) => {
    const { size = 9.3, leading = 13.4, color = BODY, font = "regular", width = contentWidth, x = MARGIN } = options;
    for (const line of pdf.wrap(text, size, font, width)) {
      ensure(leading);
      pdf.text(line, x, y, { size, font, color });
      y += leading;
    }
  };

  const tableRow = (cells: Cell[], options: { height?: number; fill?: Rgb; rule?: boolean } = {}) => {
    const { height = 15, fill, rule = true } = options;
    ensure(height);
    if (fill) pdf.rect(MARGIN, y - 10.5, contentWidth, height, fill);
    let x = MARGIN;
    for (const cell of cells) {
      const size = cell.size ?? 8.4;
      const font = cell.font ?? "regular";
      const text = pdf.clip(cell.text, size, font, cell.width - 6);
      pdf.text(text, cell.align === "right" ? x + cell.width - 6 : x, y, {
        size,
        font,
        color: cell.color ?? INK,
        align: cell.align ?? "left",
      });
      x += cell.width;
    }
    y += height;
    if (rule) pdf.hairline(MARGIN, y - 10.5, contentWidth, LINE, 0.4);
  };

  /** label / value pairs, wrapped in the value column. */
  const pairs = (rows: { label: string; value: string; note?: string }[]) => {
    const labelWidth = 148;
    const valueWidth = contentWidth - labelWidth;
    const measured = rows.map((row) => {
      const valueLines = pdf.wrap(row.value, 8.8, "regular", valueWidth);
      const noteLines = row.note ? pdf.wrap(row.note, 7.8, "regular", valueWidth) : [];
      return { row, valueLines, noteLines, height: Math.max(14, valueLines.length * 12 + noteLines.length * 10 + 5) };
    });

    measured.forEach((entry, index) => {
      // Widow control. Without it a group can end with one lone row stranded at
      // the top of an otherwise blank page, which is the tell of a generated
      // document nobody looked at.
      const next = measured[index + 1];
      const needed = next && index === measured.length - 2 ? entry.height + next.height : entry.height;
      if (y + needed > bottom) startPage();

      const top = y;
      pdf.text(entry.row.label, MARGIN, top, { size: 8.8, font: "bold", color: INK });
      entry.valueLines.forEach((line, i) => {
        pdf.text(line, MARGIN + labelWidth, top + i * 12, { size: 8.8, color: BODY });
      });
      let cursor = top + entry.valueLines.length * 12;
      entry.noteLines.forEach((line, i) => {
        pdf.text(line, MARGIN + labelWidth, cursor + i * 10, { size: 7.8, color: MUTED });
      });
      cursor += entry.noteLines.length * 10;
      y = Math.max(top + 14, cursor + 5);
      pdf.hairline(MARGIN, y - 9, contentWidth, LINE, 0.4);
    });
  };

  // ---------------------------------------------------------------- page 1
  startPage();

  if (doc.notice) {
    // The band already says SAMPLE DATA, so the sentence does not say it twice.
    const noticeLines = pdf.wrap(doc.notice.replace(/^Sample data\.\s*/, ""), 8.4, "regular", contentWidth - 28);
    const boxHeight = 24 + noticeLines.length * 11;
    pdf.rect(MARGIN, y - 12, contentWidth, boxHeight, ORANGE_TINT);
    pdf.rect(MARGIN, y - 12, 3.5, boxHeight, ORANGE);
    pdf.text("SAMPLE DATA", MARGIN + 14, y, { size: 7.5, font: "bold", tracking: 1.4, color: ORANGE_DEEP });
    noticeLines.forEach((line, i) => {
      pdf.text(line, MARGIN + 14, y + 13 + i * 11, { size: 8.4, color: INK });
    });
    y += boxHeight + 14;
  }

  for (const line of pdf.wrap(doc.screen.name, 23, "bold", contentWidth)) {
    pdf.text(line, MARGIN, y, { size: 23, font: "bold", color: INK });
    y += 27;
  }
  y += 2;
  paragraph(
    [
      doc.screen.cellLine,
      doc.screen.organism,
      doc.screen.modality,
      doc.library.label,
      doc.screen.phenotype,
    ].join("   "),
    { size: 9, color: MUTED, leading: 12.5 },
  );
  paragraph(`${doc.screen.id} ,  ${doc.reportId} ,  generated ${stamp(generatedAt.toISOString())}`, {
    size: 8.2,
    color: MUTED,
    leading: 12,
  });

  // Four figures, the same four the workspace shows, so the file and the screen
  // cannot disagree.
  y += 12;
  const tiles: { label: string; value: string; hint: string; color: Rgb }[] = [
    // The tile hint is clipped to the tile width, so the multiple-testing
    // denominator goes in the summary paragraph below rather than being cut off
    // mid-number here.
    { label: "Candidate hits", value: formatNumber(doc.counts.candidates), hint: "BH FDR below 0.10", color: INK },
    { label: "Demo score >=0.60", value: formatNumber(doc.counts.likelyReal), hint: "Illustrative, not a probability", color: ORANGE },
    { label: "Real and new", value: formatNumber(doc.counts.byVerdict["Real and new"]), hint: "new in this context", color: CYAN },
    { label: "Flagged", value: formatNumber(doc.counts.flagged), hint: "at least one artifact flag", color: INK },
  ];
  const gap = 9;
  const tileWidth = (contentWidth - gap * 3) / 4;
  ensure(66);
  tiles.forEach((tile, i) => {
    const x = MARGIN + i * (tileWidth + gap);
    pdf.rect(x, y - 12, tileWidth, 62, MIST);
    pdf.text(tile.label.toUpperCase(), x + 10, y, { size: 6.6, font: "bold", tracking: 1.1, color: MUTED });
    pdf.text(tile.value, x + 10, y + 22, { size: 19, font: "bold", color: tile.color });
    pdf.text(pdf.clip(tile.hint, 6.8, "regular", tileWidth - 20), x + 10, y + 38, { size: 6.8, color: MUTED });
  });
  y += 62;

  heading("Summary");
  paragraph(doc.summary, { size: 9.6, leading: 14 });

  heading("Verdict breakdown");
  tableRow(
    [
      { text: "Verdict", width: 190, font: "bold", color: MUTED, size: 7.4 },
      { text: "Genes", width: 60, align: "right", font: "bold", color: MUTED, size: 7.4 },
      { text: "Share", width: 60, align: "right", font: "bold", color: MUTED, size: 7.4 },
      { text: "What it means for the bench", width: contentWidth - 310, font: "bold", color: MUTED, size: 7.4 },
    ],
    { height: 14 },
  );
  const meaning: Record<string, string> = {
    "Real and new": "Validate these first",
    "Real and known": "Positive controls, not a finding",
    "Real but generic": "Real, but not specific to this condition",
    Artifact: "Do not pursue; evidence is in the table",
    Uncertain: "Needs more guides or a comparable screen",
  };
  VERDICT_ORDER.forEach((verdict, index) => {
    const count = doc.counts.byVerdict[verdict];
    tableRow(
      [
        { text: verdict, width: 190 },
        { text: formatNumber(count), width: 60, align: "right" },
        {
          text: doc.counts.candidates > 0 ? formatPercent(count / doc.counts.candidates, 1) : "n/a",
          width: 60,
          align: "right",
          color: MUTED,
        },
        { text: meaning[verdict] ?? "", width: contentWidth - 310, color: MUTED },
      ],
      { fill: index % 2 === 0 ? WHITE : MIST },
    );
  });

  heading("Methods");
  for (const section of doc.methods) {
    ensure(30);
    pdf.text(section.heading, MARGIN, y, { size: 9.4, font: "bold", color: INK });
    y += 14;
    paragraph(section.body, { size: 9, leading: 13 });
    y += 6;
  }

  // ------------------------------------------------------------- provenance
  startPage();
  heading("Provenance");
  paragraph(
    "Everything below is read from the run record. A report that cannot name its pipeline version, its tool versions, its thresholds and its reference releases cannot be reproduced, and a number without those four is not a result.",
    { size: 9, leading: 13, color: MUTED },
  );
  y += 8;
  pairs([
    { label: "Pipeline", value: `${doc.run.pipeline} ${doc.run.pipelineVersion}` },
    { label: "Analysis schema", value: doc.run.analysisSchema, note: "Bumped whenever a stage changes a number, so two reports are comparable" },
    { label: "Run id", value: doc.run.id },
    { label: "Report id", value: doc.reportId },
    { label: "Data source", value: doc.source === "sample" ? "SplicR sample dataset" : "SplicR workspace" },
    { label: "Run started", value: stamp(doc.run.startedAt) },
    { label: "Run completed", value: stamp(doc.run.completedAt) },
    {
      label: "Compute time",
      value: seconds(doc.run.wallClockSec),
      note: `Sum of the ${doc.run.stages.length} stage durations. Elapsed time between the first and last stage is longer, because it includes queueing.`,
    },
  ]);

  heading("Tool versions");
  tableRow(
    [
      { text: "Stage", width: 74, font: "bold", color: MUTED, size: 7.4 },
      { text: "Tool", width: 130, font: "bold", color: MUTED, size: 7.4 },
      { text: "Version", width: 56, font: "bold", color: MUTED, size: 7.4 },
      { text: "Role", width: contentWidth - 260, font: "bold", color: MUTED, size: 7.4 },
    ],
    { height: 14 },
  );
  doc.tools.forEach((tool, index) => {
    tableRow(
      [
        { text: tool.stage, width: 74, color: MUTED },
        { text: tool.name, width: 130, font: "bold" },
        { text: tool.version ?? "not pinned", width: 56 },
        { text: tool.role, width: contentWidth - 260, color: MUTED },
      ],
      { fill: index % 2 === 0 ? WHITE : MIST },
    );
  });

  heading("Stage timings");
  tableRow(
    [
      { text: "Stage", width: 110, font: "bold", color: MUTED, size: 7.4 },
      { text: "Started", width: 140, font: "bold", color: MUTED, size: 7.4 },
      { text: "Duration", width: 70, align: "right", font: "bold", color: MUTED, size: 7.4 },
      { text: "Tool invoked", width: contentWidth - 320, font: "bold", color: MUTED, size: 7.4 },
    ],
    { height: 14 },
  );
  doc.run.stages.forEach((stage, index) => {
    tableRow(
      [
        { text: stage.title, width: 110, font: "bold" },
        { text: stamp(stage.startedAt), width: 140, color: MUTED },
        { text: stage.durationSec === null ? "n/a" : seconds(stage.durationSec), width: 70, align: "right" },
        { text: stage.tool ?? "internal", width: contentWidth - 320, color: MUTED },
      ],
      { fill: index % 2 === 0 ? WHITE : MIST },
    );
  });

  heading("Parameters");
  pairs(doc.parameters.map((p) => ({ label: p.label, value: p.value, note: p.note })));

  heading("Reference data");
  pairs(doc.references.map((r) => ({ label: r.name, value: r.release, note: r.detail })));

  heading("Quality control");
  if (doc.qc) {
    pairs([
      { label: "Samples sequenced", value: `${doc.qc.samples.length} (${formatNumber(doc.qc.totalReads)} reads)` },
      { label: "Mean mapping rate", value: formatPercent(doc.qc.meanMapped, 1) },
      { label: "Gini index range", value: `${doc.qc.giniRange[0].toFixed(2)} to ${doc.qc.giniRange[1].toFixed(2)}`, note: "Ceiling 0.30 at the endpoint, 0.10 for plasmid and T0" },
      {
        label: "Zero-count guides",
        value: `${formatPercent(doc.qc.zeroGuideRange[0], 1)} to ${formatPercent(doc.qc.zeroGuideRange[1], 1)}`,
      },
      {
        label: "Control separation",
        value: `AUROC ${doc.qc.auroc.toFixed(2)}, NNMD ${doc.qc.nnmd.toFixed(2)}`,
        note: `CEGv2 ${formatNumber(doc.qc.essentialGenes)} genes against NEGv1 ${formatNumber(doc.qc.nonEssentialGenes)} genes`,
      },
      {
        label: "Lowest replicate r",
        value: doc.qc.worstReplicateCorr.toFixed(2),
        note: "Raw-count correlation is a weak check on a context-specific screen; control separation carries the verdict",
      },
      {
        label: "Down-weighted samples",
        value:
          doc.qc.flagged.length === 0
            ? "none"
            : doc.qc.flagged
                .map((s) => `${s.label} (Gini ${s.gini.toFixed(2)}, ${formatPercent(s.zeroGuides, 1)} zero-count)`)
                .join("; "),
      },
    ]);
  } else {
    paragraph(
      `Per-sample distribution metrics, replicate correlations and control separation are not recorded for this screen in the dataset the console is reading. None are reported here, and none should be inferred. The run carries an overall QC verdict of "${doc.screen.qcVerdict}".`,
      { size: 9, leading: 13 },
    );
  }

  // -------------------------------------------------------------- hit table
  // Enough room for the heading, the note and a few rows, or the table opens on
  // a fresh page rather than as four stranded lines.
  ensure(170);
  const shown = doc.hits.slice(0, MAX_TABLE_ROWS);
  heading("Ranked hits");
  paragraph(
    shown.length < doc.hits.length
      ? `Rows 1 to ${shown.length} of ${formatNumber(doc.hits.length)}, ranked by gene-level p-value. The complete table, with every statistic and the evidence behind every flag, is in the CSV and JSON exports of this report.`
      : `All ${formatNumber(doc.hits.length)} candidates, ranked by gene-level p-value. Every statistic and the evidence behind every flag is also in the CSV and JSON exports.`,
    { size: 8.8, leading: 12.5, color: MUTED },
  );
  const excelRisk = excelAmbiguousSymbols(doc.hits);
  if (excelRisk.length > 0) {
    paragraph(
      `${excelRisk.length} symbol(s) in this table are rewritten as dates when a CSV is opened by double-click in Excel (${excelRisk.join(", ")}). Import the CSV with Data then From Text/CSV and set gene_symbol to Text.`,
      { size: 8.2, leading: 11.5, color: ORANGE_DEEP },
    );
  }
  y += 4;

  const columns = { rank: 24, gene: 58, verdict: 70, chance: 34, dir: 42, lfc: 34, fdr: 46, bf: 28, guides: 32, novelty: 36 };
  const flagsWidth =
    contentWidth - Object.values(columns).reduce((a, b) => a + b, 0);
  const header = () =>
    tableRow(
      [
        { text: "#", width: columns.rank, font: "bold", color: MUTED, size: 7.2 },
        { text: "Gene", width: columns.gene, font: "bold", color: MUTED, size: 7.2 },
        { text: "Verdict", width: columns.verdict, font: "bold", color: MUTED, size: 7.2 },
        { text: "Score", width: columns.chance, align: "right", font: "bold", color: MUTED, size: 7.2 },
        { text: "Arm", width: columns.dir, font: "bold", color: MUTED, size: 7.2 },
        { text: "LFC", width: columns.lfc, align: "right", font: "bold", color: MUTED, size: 7.2 },
        { text: "FDR", width: columns.fdr, align: "right", font: "bold", color: MUTED, size: 7.2 },
        { text: "BF", width: columns.bf, align: "right", font: "bold", color: MUTED, size: 7.2 },
        { text: "Guides", width: columns.guides, align: "right", font: "bold", color: MUTED, size: 7.2 },
        { text: "Novelty", width: columns.novelty, align: "right", font: "bold", color: MUTED, size: 7.2 },
        { text: "Flags", width: flagsWidth, font: "bold", color: MUTED, size: 7.2 },
      ],
      { height: 14 },
    );

  header();
  shown.forEach((hit, index) => {
    // A table that breaks across pages needs its header again before the row
    // that spilled, not after it.
    if (y + 14 > bottom) {
      startPage();
      header();
    }
    tableRow(
      [
        { text: String(hit.rank), width: columns.rank, color: MUTED, size: 7.8 },
        { text: hit.gene, width: columns.gene, font: "bold", size: 8.2 },
        { text: hit.verdict, width: columns.verdict, size: 7.6, color: BODY },
        { text: hit.chance.toFixed(2), width: columns.chance, align: "right", size: 8 },
        { text: hit.direction, width: columns.dir, size: 7.4, color: BODY },
        { text: hit.lfc.toFixed(2), width: columns.lfc, align: "right", size: 8 },
        { text: small(hit.fdr), width: columns.fdr, align: "right", size: 8 },
        { text: hit.bayesFactor.toFixed(1), width: columns.bf, align: "right", size: 8 },
        { text: `${hit.guidesAgree}/${hit.guides}`, width: columns.guides, align: "right", size: 8 },
        { text: hit.novelty.toFixed(2), width: columns.novelty, align: "right", size: 8 },
        { text: hit.flags.join(", ") || "none", width: flagsWidth, size: 7.4, color: hit.flags.length > 0 ? ORANGE_DEEP : MUTED },
      ],
      { height: 14, fill: index % 2 === 0 ? WHITE : MIST },
    );
  });

  // ------------------------------------------------------------------ chrome
  pdf.eachPage((page, total) => {
    pdf.hairline(MARGIN, pdf.height - 46, contentWidth, LINE, 0.5);
    pdf.text(`SplicR hit report ,  ${doc.reportId}`, MARGIN, pdf.height - 34, { size: 7.2, color: MUTED });
    if (doc.notice) {
      pdf.text("Sample data", pdf.width / 2, pdf.height - 34, { size: 7.2, font: "bold", color: ORANGE_DEEP, align: "center" });
    }
    pdf.text(`Page ${page} of ${total}`, pdf.width - MARGIN, pdf.height - 34, {
      size: 7.2,
      color: MUTED,
      align: "right",
    });
  });

  return pdf.toBuffer({
    title: `SplicR hit report: ${doc.screen.name}${doc.notice ? " (sample data)" : ""}`,
    subject: `${doc.reportId}, ${doc.run.pipeline} ${doc.run.pipelineVersion}`,
    author: "SplicR",
    createdAt: generatedAt,
    // Deterministic from the report, so re-exporting the same run gives the same
    // document identifier rather than a fresh random one.
    id: hex32(`${doc.reportId}:${doc.run.id}`),
  });
}

/** 32 hex characters derived from the report identity, for the PDF trailer /ID. */
function hex32(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + input.charCodeAt(i) * (i + 1), 0x85ebca6b) >>> 0;
  }
  const part = (n: number) => n.toString(16).padStart(8, "0");
  return `${part(a)}${part(b)}${part(a ^ b)}${part((a + b) >>> 0)}`;
}
