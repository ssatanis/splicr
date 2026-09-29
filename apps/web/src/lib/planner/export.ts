/**
 * The plan as a file.
 *
 * RFC 4180 with CRLF and a UTF-8 BOM, every text field quoted, and a `#`
 * preamble that carries the model version, the inputs and the plain statement of
 * what the numbers are not. A plan pasted into a grant or a lab notebook should
 * still say it is design arithmetic after it has left the page.
 */
import { MODEL_VERSION, PLAN_COLUMNS, type PlanInputs } from "./model";

const FORMULA_START = /^[=+\-@\t\r]/;

function field(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function planCsv(inputs: PlanInputs, rows: (string | number)[][]): string {
  const preamble = [
    "# SplicR screen plan",
    `# model: ${MODEL_VERSION}`,
    "# This is design arithmetic on the inputs below. It is not a statistical power calculation, a quote or a guarantee.",
    `# inputs: ${Object.entries(inputs).map(([key, value]) => `${key}=${value}`).join("; ")}`,
    '# read in R with readr::read_csv(path, comment = "#")',
  ];
  const body = rows.map((row) => row.map(field).join(","));
  return `\uFEFF${[...preamble, PLAN_COLUMNS.join(","), ...body].join("\r\n")}\r\n`;
}
