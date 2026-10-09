/** Shared vector scenes for browser SVG and publication PDF. No inferred data. */
import type { LabReceipt } from "./evidence";
export type Mark = { type: "line"; x: number; y: number; x2: number; y2: number; color: string; width?: number; title?: string }
  | { type: "box"; x: number; y: number; w: number; h: number; color: string; title?: string }
  | { type: "text"; x: number; y: number; text: string; size?: number; color?: string; title?: string };
export interface Scene { title: string; width: number; height: number; marks: Mark[]; xLabel?: string; yLabel?: string }
const colors = ["#087f8c", "#c35b24", "#7255a0", "#3672af", "#a24670", "#617c34"];
const label = (marks: Mark[], x: number, y: number, text: string, size = 11, title?: string) => marks.push({ type: "text", x, y, text, size, title });
const line = (marks: Mark[], x: number, y: number, x2: number, y2: number, color = "#c2c7cc", width = 1, title?: string) => marks.push({ type: "line", x, y, x2, y2, color, width, title });
const short = (s: string, n = 34) => s.length > n ? s.slice(0, n - 1) + "…" : s;
export function curves(title: string, series: { name: string; points: [number, number][]; faint?: boolean }[], xLabel: string, yLabel: string): Scene {
  const marks: Mark[] = []; const points = series.flatMap(s => s.points);
  const scene: Scene = { title, width: 820, height: 405 + Math.ceil(series.length / 3) * 18, marks, xLabel, yLabel };
  label(marks, 20, 25, title, 15);
  if (!points.length) { label(marks, 20, 60, "No recorded points"); return scene; }
  const minX = points.reduce((a, p) => Math.min(a, p[0]), Infinity); const maxX = points.reduce((a, p) => Math.max(a, p[0]), -Infinity);
  const minY = points.reduce((a, p) => Math.min(a, p[1]), 0); const maxY = points.reduce((a, p) => Math.max(a, p[1]), 0);
  const dx = maxX - minX || 1; const dy = maxY - minY || 1;
  const x = (v: number) => 88 + (v - minX) / dx * 690;
  const y = (v: number) => 330 - (v - minY) / dy * 260;
  line(marks, 88, 70, 88, 330); line(marks, 88, 330, 778, 330);
  for (let i = 0; i <= 4; i++) {
    const xv = minX + dx * i / 4; const yv = minY + dy * i / 4;
    label(marks, x(xv) - 12, 350, xv.toPrecision(3)); label(marks, 20, y(yv) + 4, yv.toPrecision(3));
    line(marks, 88, y(yv), 778, y(yv), "#e5e7eb");
  }
  label(marks, 330, 375, xLabel, 12); label(marks, 88, 52, yLabel, 12);
  series.forEach((s, index) => {
    const color = s.faint ? "#c5cdd0" : colors[index % colors.length];
    s.points.forEach((p, i) => {
      if (i) line(marks, x(s.points[i - 1][0]), y(s.points[i - 1][1]), x(p[0]), y(p[1]), color, s.faint ? .7 : 2);
      marks.push({ type: "box", x: x(p[0]) - 2, y: y(p[1]) - 2, w: 4, h: 4, color, title: `${s.name}: ${p[0]} / ${p[1]}` });
    });
    const col = index % 3; const row = Math.floor(index / 3);
    line(marks, 22 + col * 265, 398 + row * 18, 34 + col * 265, 398 + row * 18, color, 2);
    label(marks, 39 + col * 265, 402 + row * 18, short(s.name), 10, s.name);
  });
  return scene;
}
export function evidenceScenes(record: LabReceipt): Scene[] {
  if (record.kind === "kinetics") {
    const trajectories = record.payload.trajectories ?? [];
    return [curves(`${record.gene} · temporal guide abundance`, trajectories.flatMap(t => [
      ...t.guides.map(g => ({ name: `${t.condition} / ${t.replicate} / ${g.guide_key}`, points: t.days.map((d, i) => [d, g.lfc[i]] as [number, number]), faint: true })),
      { name: `${t.condition} / ${t.replicate} · guide mean`, points: t.days.map((d, i) => [d, t.mean_lfc[i]] as [number, number]) },
    ]), "Days from declared origin", "Log2 relative abundance from trajectory baseline")];
  }
  if (record.kind === "drift") return [curves("Library abundance · raw-count Lorenz curves", (record.payload.samples ?? []).map(s => ({ name: `${s.sample}${s.baseline ? " · baseline" : ""}`, points: s.lorenz })), "Fraction of guides (lowest abundance first)", "Cumulative fraction of raw counts")];
  if (record.kind === "isoforms") {
    const transcripts = record.payload.transcripts ?? []; const guides = record.payload.guides ?? [];
    const marks: Mark[] = []; const height = 110 + transcripts.length * 25;
    const scene: Scene = { title: `${record.gene} · annotated transcript map`, width: 820, height, marks };
    label(marks, 20, 25, scene.title, 15);
    label(marks, 20, 47, "GRCh38 · zero-based half-open intervals · darker boxes are CDS", 11);
    const spans = transcripts.flatMap(t => t.exons);
    if (spans.length) {
      const lo = Math.min(...spans.map(e => e.start)); const hi = Math.max(...spans.map(e => e.end));
      const x = (pos: number) => 180 + (pos - lo) / (hi - lo || 1) * 605;
      label(marks, 180, 70, String(lo)); label(marks, 703, 70, String(hi));
      transcripts.forEach((t, index) => {
        const y = 85 + index * 25;
        label(marks, 10, y + 3, `${t.id} ${t.strand ?? "?"}`, 10);
        line(marks, 180, y, 785, y, "#d1d5db");
        for (const e of t.exons) marks.push({ type: "box", x: x(e.start), y: y - 5, w: Math.max(.5, x(e.end) - x(e.start)), h: 10, color: "#a6d3d5", title: `${t.id} exon ${e.number ?? "unknown"}: ${e.start}–${e.end}` });
        for (const e of t.cds) marks.push({ type: "box", x: x(e.start), y: y - 5, w: Math.max(.5, x(e.end) - x(e.start)), h: 10, color: "#087f8c", title: `${t.id} CDS ${e.start}–${e.end}` });
        for (const g of guides) if (g.cut_position !== null && g.chromosome?.replace(/^chr/, "") === t.chromosome.replace(/^chr/, "") && g.cut_position >= lo && g.cut_position < hi) {
          line(marks, x(g.cut_position), y - 10, x(g.cut_position), y + 10, g.lfc !== null && g.lfc <= -1 ? "#c35b24" : "#7255a0", 1.3, `${g.guide_key}: log2FC ${g.lfc}, Cas9 cut boundary ${g.cut_position}`);
        }
      });
    } else label(marks, 20, 80, "No compatible transcript annotation was recorded");
    const waterfall: Scene = { title: `${record.gene} · every guide`, width: 820, height: 110 + guides.length * 25, marks: [] };
    label(waterfall.marks, 20, 25, waterfall.title, 15);
    const measuredGuides = guides.filter((g): g is typeof g & { lfc: number } => g.lfc !== null);
    const lo = Math.min(-1, ...measuredGuides.map(g => g.lfc)); const hi = Math.max(1, ...measuredGuides.map(g => g.lfc));
    const x = (v: number) => 255 + (v - lo) / (hi - lo) * 520;
    label(waterfall.marks, 255, 52, lo.toPrecision(3)); label(waterfall.marks, 740, 52, hi.toPrecision(3));
    line(waterfall.marks, x(0), 60, x(0), waterfall.height - 25, "#9ca3af");
    [...measuredGuides].sort((a, b) => a.lfc - b.lfc || a.guide_key.localeCompare(b.guide_key)).forEach((g, i) => {
      const y = 75 + i * 25; label(waterfall.marks, 10, y + 4, short(g.guide_key), 11, g.guide_key);
      waterfall.marks.push({ type: "box", x: Math.min(x(0), x(g.lfc)), y: y - 6, w: Math.max(.5, Math.abs(x(0) - x(g.lfc))), h: 12, color: g.lfc < 0 ? "#087f8c" : "#c35b24", title: `${g.guide_key}: log2FC ${g.lfc}` });
      label(waterfall.marks, 190, y + 4, g.lfc.toFixed(3));
    });
    if (!measuredGuides.length) label(waterfall.marks, 20, 80, "Guide effects were not measured in this reference-only mapping");
    label(waterfall.marks, 300, waterfall.height - 7, "Recorded guide log2 fold change");
    return [waterfall, scene];
  }
  const payload = record.payload;
  const scene: Scene = { title: `${record.gene} · DepMap context`, width: 820, height: 230, marks: [] };
  label(scene.marks, 20, 25, scene.title, 15);
  const values = [{ name: `Model ${payload.model_id ?? "not matched"}`, value: payload.exact?.effect },
    { name: `Lineage median · n=${payload.lineage_reference?.n_measured_models ?? 0}`, value: payload.lineage_reference?.median_effect },
    { name: `Global median · n=${payload.global_reference?.n_measured_models ?? 0}`, value: payload.global_reference?.median_effect }];
  const lo = Math.min(-1.5, ...values.map(v => v.value ?? 0)); const hi = Math.max(.5, ...values.map(v => v.value ?? 0));
  const x = (v: number) => 290 + (v - lo) / (hi - lo) * 480;
  values.forEach((v, i) => {
    const y = 70 + i * 42; label(scene.marks, 15, y, v.name);
    if (v.value == null) label(scene.marks, 300, y, "Not measured");
    else { line(scene.marks, x(0), y - 5, x(v.value), y - 5, colors[i], 7); label(scene.marks, 238, y, v.value.toFixed(3)); }
  });
  label(scene.marks, 290, 205, `${lo.toPrecision(3)}                       Chronos gene effect                       ${hi.toPrecision(3)}`);
  return [scene];
}
export function escapeMarkup(s: string): string { return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
export function sceneSvg(scene: Scene): string {
  const e = escapeMarkup;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img"><title>${e(scene.title)}</title><rect width="100%" height="100%" fill="white"/>${scene.marks.map(m => {
    const title = m.title ? `<title>${e(m.title)}</title>` : "";
    if (m.type === "text") return `<text x="${m.x}" y="${m.y}" fill="${m.color ?? "#25313a"}" font-family="Arial,sans-serif" font-size="${m.size ?? 11}">${title}${e(m.text)}</text>`;
    if (m.type === "box") return `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="${m.color}">${title}</rect>`;
    return `<line x1="${m.x}" y1="${m.y}" x2="${m.x2}" y2="${m.y2}" stroke="${m.color}" stroke-width="${m.width ?? 1}">${title}</line>`;
  }).join("")}</svg>`;
}
/** PDF 1.4 with native vector paths and a standard font, same geometry as SVG. */
export function scenePdf(scene: Scene): Uint8Array {
  const rgb = (hex: string) => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(" ");
  const winAnsi: Record<string, number> = { "€":128, "‚":130, "ƒ":131, "„":132, "…":133, "†":134, "‡":135, "ˆ":136, "‰":137, "Š":138, "‹":139, "Œ":140, "Ž":142, "‘":145, "’":146, "“":147, "”":148, "•":149, "–":150, "—":151, "˜":152, "™":153, "š":154, "›":155, "œ":156, "ž":158, "Ÿ":159 };
  // Octal escapes keep stream lengths and xref offsets ASCII byte-exact.
  const text = (s: string) => Array.from(s, c => {
    const code = c.codePointAt(0)!;
    if (code >= 32 && code <= 126) return /[\\()]/.test(c) ? `\\${c}` : c;
    const encoded = code >= 160 && code <= 255 ? code : winAnsi[c];
    return encoded === undefined ? "?" : `\\${encoded.toString(8).padStart(3, "0")}`;
  }).join("");
  const n = (v: number) => v.toFixed(3);
  const content = scene.marks.map(m => m.type === "text"
    ? `BT /F1 ${m.size ?? 11} Tf ${rgb(m.color ?? "#25313a")} rg 1 0 0 1 ${n(m.x)} ${n(scene.height - m.y)} Tm (${text(m.text)}) Tj ET`
    : m.type === "box" ? `${rgb(m.color)} rg ${n(m.x)} ${n(scene.height - m.y - m.h)} ${n(m.w)} ${n(m.h)} re f`
    : `${rgb(m.color)} RG ${m.width ?? 1} w ${n(m.x)} ${n(scene.height - m.y)} m ${n(m.x2)} ${n(scene.height - m.y2)} l S`).join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${scene.width} ${scene.height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
